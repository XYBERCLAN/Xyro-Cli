// Tournament — several free models solve the same task, the code decides.
//
// Why: one free model is weaker than a paid frontier model, but models from
// different families make different mistakes. Run 2–4 of them in parallel,
// each in its own git worktree, judge every result LOCALLY with something
// objective (your check command / tests, your saved intents, the type
// checker), and merge only the winner. Paid tools can't make this the
// default because it multiplies the bill; on free quotas it costs nothing.
//
// Rules that keep it honest:
//   - no objective judge → no tournament (picking at random is not a feature)
//   - a winner is merged only if it passes the check; otherwise the best
//     attempt is kept aside for you to look at
//   - contestants may run the judge's check themselves without asking, so
//     they can iterate until it passes; file edits stay inside their worktree
//   - results are remembered: models that win get picked first next time

import { isStopped } from "../agent/cancel.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { getExpert } from "./experts.js";
import { pickExpert } from "./router.js";
import { runExpert, resolveSession, ExpertReport } from "./runtime.js";
import { isGitRepo, createWorktree, mergeWorktree, removeWorktree, Worktree } from "./worktree.js";
import { runInWorkspace, workspaceRoot } from "../agent/workspace.js";
import { listIntents, runIntents } from "../agent/intents.js";
import { detectTestCommand, parseTestOutput, diagnostics } from "../tools/power.js";
import { isDangerousCommand } from "../tools/shell.js";
import { runShell } from "../tools/proc.js";
import { recordSkillOutcome } from "./skill-stats.js";
import { pickContestants, recordTournament, Contestant } from "../providers/pool.js";

const CHECK_TIMEOUT_MS = 10 * 60_000;

/**
 * Files that decide WHAT runs when tests run (scripts, runners, hooks). A
 * contestant's edits are never reviewed by you, so once it touches one of
 * these nothing is executed in its worktree automatically — not by the
 * contestant, not by the judge.
 */
const CONTROL_FILE = /(^|\/)(package\.json|\.npmrc|[^/]*\.config\.[cm]?[jt]s|\.mocharc[^/]*|jest\.setup[^/]*|vitest\.setup[^/]*|pytest\.ini|pyproject\.toml|setup\.cfg|setup\.py|tox\.ini|conftest\.py|Makefile|Cargo\.toml|build\.rs|go\.mod|Rakefile|Gemfile|\.envrc)$|(^|\/)\.xyro\/|(^|\/)\.husky\//;

export function touchesControlFiles(files: string[]): string[] {
  return files.filter((f) => CONTROL_FILE.test(f));
}

async function changedFiles(wt: Worktree): Promise<string[]> {
  await git(wt.path, ["add", "-A"]);
  return String((await git(wt.path, ["diff", "--cached", "--name-only", wt.base])).stdout).split("\n").filter(Boolean);
}
const EDIT_TOOLS = new Set(["write_file", "edit_file", "multi_edit", "propose_write_file", "revert_file"]);

export interface TournamentArgs {
  task: string;
  /** How many models compete (2–4, default 3) */
  contestants?: number;
  /** Command that exits 0 when the task is done (default: the project's tests) */
  check?: string;
  expert?: string;
}

export interface Score {
  contestant: Contestant;
  report?: ExpertReport;
  error?: string;
  changed: string[];
  diffLines: number;
  checkPassed: boolean | null;
  testsPassed: number | null;
  testsFailed: number | null;
  intentsBroken: number;
  typeErrors: number | null;
  checkTail: string;
}

/** Lower is better, compared left to right. */
export function rankKey(s: Score): number[] {
  return [
    s.changed.length === 0 || s.error ? 1 : 0,
    s.checkPassed === false ? 1 : 0,
    s.intentsBroken,
    s.testsFailed ?? 0,
    s.typeErrors ?? 0,
    -(s.testsPassed ?? 0),
    s.diffLines,
  ];
}

export function rank(scores: Score[]): Score[] {
  return [...scores].sort((a, b) => {
    const ka = rankKey(a);
    const kb = rankKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
}

async function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd, reject: false, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
}

async function judge(wt: Worktree, c: Contestant, root: string, check: string | null, report?: ExpertReport, error?: string): Promise<Score> {
  const score: Score = { contestant: c, report, error, changed: [], diffLines: 0, checkPassed: null, testsPassed: null, testsFailed: null, intentsBroken: 0, typeErrors: null, checkTail: "" };
  await git(wt.path, ["add", "-A"]);
  const numstat = String((await git(wt.path, ["diff", "--cached", "--numstat", wt.base])).stdout).split("\n").filter(Boolean);
  for (const line of numstat) {
    const [a, d, file] = line.split("\t");
    score.changed.push(file);
    score.diffLines += (Number(a) || 0) + (Number(d) || 0);
  }
  if (!score.changed.length) return score;

  const control = touchesControlFiles(score.changed);
  if (control.length) {
    score.error = `changed ${control.slice(0, 3).join(", ")}, which controls what runs; not executed automatically, review by hand`;
    return score;
  }

  if (check) {
    const res = await runShell(check, { cwd: wt.path, timeoutMs: CHECK_TIMEOUT_MS, env: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" } });
    const out = String(res.all ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    const t = parseTestOutput(out, detectTestCommand(wt.path)?.runner ?? "");
    score.checkPassed = res.exitCode === 0 && !res.timedOut;
    score.testsPassed = t.passed;
    score.testsFailed = t.failed;
    if (!score.checkPassed) score.checkTail = (t.failures.length ? `failing: ${t.failures.slice(0, 5).join(", ")}` : out.split("\n").filter(Boolean).slice(-3).join(" | ")).slice(0, 300);
  }
  await runInWorkspace(wt.path, async () => {
    if (listIntents(root).length) score.intentsBroken = (await runIntents(wt.path, root)).filter((r) => !r.ok).length;
    if (existsSync(join(wt.path, "tsconfig.json"))) {
      const d = await diagnostics({});
      const m = d.match(/^❌ (\d+) problem/);
      score.typeErrors = m ? Number(m[1]) : d.startsWith("✅") ? 0 : null;
    }
  });
  return score;
}

function row(s: Score, i: number, winner: Score | null): string {
  const c = s.contestant;
  const parts: string[] = [];
  if (s.error) parts.push(`failed: ${s.error.slice(0, 120)}`);
  else if (!s.changed.length) parts.push("made no changes");
  else {
    if (s.checkPassed !== null) parts.push(s.checkPassed ? "check passed" : "check FAILED");
    if (s.testsPassed !== null || s.testsFailed !== null) parts.push(`tests ${s.testsPassed ?? "?"} passed / ${s.testsFailed ?? "?"} failed`);
    if (s.intentsBroken) parts.push(`${s.intentsBroken} intent${s.intentsBroken === 1 ? "" : "s"} broken`);
    if (s.typeErrors !== null) parts.push(`${s.typeErrors} type error${s.typeErrors === 1 ? "" : "s"}`);
    parts.push(`${s.changed.length} file${s.changed.length === 1 ? "" : "s"}, ${s.diffLines} lines changed`);
  }
  const tag = s === winner ? "WINNER " : "";
  return `${i + 1}. ${tag}${c.model} (${c.providerId || "current provider"}) — ${parts.join(" · ")}${s.checkTail ? `\n     ${s.checkTail}` : ""}`;
}

export async function tournament(args: TournamentArgs): Promise<string> {
  const task = (args.task || "").trim();
  if (!task) return "❌ tournament: `task` is required.";
  const root = workspaceRoot();
  if (!(await isGitRepo(root))) return "❌ tournament needs a git repository (each contestant works in its own worktree).";

  const check = args.check?.trim() || detectTestCommand(root)?.command || null;
  if (check && isDangerousCommand(check)) return "❌ tournament: refused, the check command is dangerous.";
  const hasTypes = existsSync(join(root, "tsconfig.json")) && existsSync(join(root, "node_modules", ".bin", "tsc"));
  if (!check && !listIntents(root).length && !hasTypes) {
    return "❌ tournament needs an objective judge, otherwise the pick is random. Pass `check` (a command that exits 0 when the task is done), add tests, or save intents.";
  }

  let expert = args.expert ? getExpert(args.expert) : pickExpert(task).expert;
  if (!expert || !expert.tools.some((t) => EDIT_TOOLS.has(t))) expert = getExpert("builder");
  if (!expert) return "❌ tournament: no expert that can edit files.";

  const n = Math.max(2, Math.min(args.contestants ?? 3, 4));
  const base = resolveSession(expert);
  if (!base.model || !base.apiKey) return "❌ tournament: no model or API key configured (use /provider or /model).";
  const contestants = pickContestants(n, { baseURL: base.baseURL, apiKey: base.apiKey, model: base.model });
  if (contestants.length < 2) return "❌ tournament needs at least 2 models: connect another provider (/provider) or pick a provider with several free models.";

  const trees: Worktree[] = [];
  for (const c of contestants) {
    const wt = await createWorktree(`t-${c.model.split("/").pop()}`, root);
    if (!wt) {
      for (const t of trees) await removeWorktree(t, root);
      return "❌ tournament: could not create git worktrees.";
    }
    trees.push(wt);
  }

  const brief = [
    "You are one of several contestants solving this task independently. Only the best verified solution is kept.",
    check ? `Your work is judged by running: ${check}\nRun it yourself with run_tests (no command argument needed) and keep going until it passes.` : "",
    listIntents(root).length ? "The user's saved intents (requirements) must keep holding." : "",
    "Make the smallest correct change. Do not weaken, skip or delete tests.",
    "Do not edit package.json, test or build configuration: an attempt that does is not run or judged automatically.",
  ]
    .filter(Boolean)
    .join("\n");

  // Inside a contestant's worktree, edits stay in the worktree (symlink escapes are refused).
  // It may run the judge's own check without asking, only while it hasn't touched what that check runs.
  const autoApprove = (i: number) => async (name: string, a: Record<string, unknown>) => {
    if (EDIT_TOOLS.has(name)) return true;
    if (name !== "run_tests" || (a.command && a.command !== check) || a.filter) return false;
    return touchesControlFiles(await changedFiles(trees[i])).length === 0;
  };

  const runs = await Promise.all(
    contestants.map((c, i) =>
      runInWorkspace(trees[i].path, () =>
        runExpert(expert!, task, { context: brief, session: { baseURL: c.baseURL, apiKey: c.apiKey, model: c.model }, autoApprove: autoApprove(i), label: c.model })
      ).then(
        (report) => ({ report, error: report.output.startsWith("❌") ? report.output.slice(2) : undefined }),
        (e: unknown) => ({ report: undefined, error: e instanceof Error ? e.message : String(e) })
      )
    )
  );

  if (isStopped()) {
    for (const t of trees) await removeWorktree(t, root);
    return "⛔ Tournament stopped by the user. No changes were merged.";
  }

  // Judge one at a time: checks may be heavy and share caches
  const scores: Score[] = [];
  for (let i = 0; i < contestants.length; i++) scores.push(await judge(trees[i], contestants[i], root, check, runs[i].report, runs[i].error));

  const ranked = rank(scores);
  const best = ranked[0];
  const bestValid = best.changed.length > 0 && !best.error;
  const passes = bestValid && best.checkPassed !== false && best.intentsBroken === 0;
  const winner = passes ? best : null;
  recordTournament(contestants.map((c) => c.model), winner?.contestant.model ?? null);
  // Contestants that produced work are evidence for their skills; API failures are not
  for (const sc of scores) if (sc.report && sc.changed.length && !sc.error) recordSkillOutcome(sc.report.skills, sc === winner);

  const lines = [`Tournament: ${contestants.length} models on "${task.slice(0, 80)}"${check ? ` · judged by \`${check}\`` : ""}`];
  lines.push(...ranked.map((s, i) => row(s, i, winner)));

  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    const wt = trees[i];
    if (s === winner) {
      const m = await mergeWorktree(wt, root);
      lines.push(
        m.applied
          ? `\nMerged the winner (${s.contestant.model}): ${m.files.join(", ")}. /rewind undoes it.`
          : `\n⚠ The winner could not be merged automatically (${m.conflict}). It is kept in ${m.keptAt}.`
      );
    } else if (!winner && s === best && bestValid) {
      lines.push(`\nNo attempt passed every check, so nothing was merged. The closest one (${s.contestant.model}) is kept in ${wt.path}\nSee it with: git -C "${wt.path}" diff ${wt.base}`);
    } else {
      await removeWorktree(wt, root);
    }
  }
  if (!bestValid) lines.push("\nNo contestant produced a change. Try a more specific task, or a stronger model.");
  return lines.join("\n");
}
