/**
 * delegate / delegate_team — XYRO's immune response.
 *
 * The coordinator (main agent) hands specialised work to experts. With no
 * expert named, the router recognises the kind of task and activates the best
 * specialist. delegate_team runs several experts in parallel, each with its own
 * context, tools, skills and plugins, and returns one combined report.
 */

import { isStopped } from "../agent/cancel.js";
import { getExpert, getExperts } from "../agents/experts.js";
import { pickExpert } from "../agents/router.js";
import { runExpert, ExpertReport } from "../agents/runtime.js";
import { runTests } from "./power.js";
import { recordSkillOutcome } from "../agents/skill-stats.js";
import { getWorkflows, getWorkflow, describeWorkflow } from "../agents/workflows.js";
import { isGitRepo, createWorktree, mergeWorktree, Worktree } from "../agents/worktree.js";
import { runInWorkspace } from "../agent/workspace.js";

const MAX_PARALLEL = 4;

export interface DelegateArgs {
  task: string;
  expert?: string;
  context?: string;
  skills?: string[];
  /** Independent verification after experts that change code (default true) */
  verify?: boolean;
  /** Escalate to the next specialist when the work fails (default true) */
  escalate?: boolean;
}

/** Who takes over when an expert fails (the immune escalation chain). */
const ESCALATE_TO: Record<string, string> = {
  builder: "debugger", refactorer: "debugger", frontend: "debugger", api: "debugger", database: "debugger",
  performance: "debugger", migrator: "debugger", devops: "debugger", dependencies: "debugger",
  tester: "debugger", healer: "debugger", designer: "debugger", debugger: "architect",
};
const MAX_ESCALATIONS = 2;

function header(r: ExpertReport, title: string, why: string): string {
  const tok = r.tokens >= 1000 ? `${(r.tokens / 1000).toFixed(1)}k tokens` : `${r.tokens} tokens`;
  const parts = [`${title}`, `${r.steps} step${r.steps === 1 ? "" : "s"}`, `${r.toolCalls} tool call${r.toolCalls === 1 ? "" : "s"}`, tok];
  if (r.model) parts.push(r.model);
  if (r.skills.length) parts.push(`skills: ${r.skills.join(", ")}`);
  if (why) parts.push(why);
  return `[${parts.join(" · ")}] ${r.ok ? "✓ done" : r.timedOut ? "⏱ ran out of steps/time" : "✗ incomplete"}`;
}

async function runOne(job: DelegateArgs, depth = 0, history: string[] = []): Promise<string> {
  const task = (job.task || "").trim();
  if (!task) return "❌ delegate: `task` is required.";
  let why = "";
  let expert = job.expert ? getExpert(job.expert) : undefined;
  if (job.expert && !expert) {
    return `❌ Unknown expert "${job.expert}". Available: ${getExperts().map((e) => e.name).join(", ")}`;
  }
  if (!expert) {
    const pick = pickExpert(task);
    expert = pick.expert;
    why = `auto-routed: ${pick.reasons.join("; ") || "best match"}`;
  }
  if (depth > 0) why = `escalated (level ${depth})`;

  const context = [job.context, ...history].filter(Boolean).join("\n\n") || undefined;
  const report = await runExpert(expert, task, { context, skills: job.skills });
  const lines = [`${header(report, expert.title, why)}\n${report.output}`];
  let ok = report.ok;

  if (isStopped()) return `${lines.join("\n\n")}\n\n⛔ Stopped by the user.`;

  // Immune check: an independent verifier confirms work that actually changed files
  if (ok && report.writes > 0 && job.verify !== false) {
    const verifier = getExpert("verifier");
    if (verifier) {
      const v = await runExpert(verifier, `Verify this work.\n\nOriginal task: ${task}`, {
        context: `Report from the ${expert.title}:\n${report.output.slice(0, 4000)}`,
      });
      const verdict = /^\s*VERIFIED\b/i.test(v.output) && !/^\s*NOT VERIFIED/i.test(v.output);
      ok = v.ok && verdict;
      // The verifier's ruling is evidence for (or against) the skills that were used
      recordSkillOutcome(report.skills, ok);
      lines.push(`${header(v, verifier.title, ok ? "independent check" : "found a problem")}\n${v.output}`);
    }
  }

  // Escalate failures to the next specialist, carrying everything learned so far
  const next = ESCALATE_TO[expert.name];
  if (!ok && job.escalate !== false && next && depth < MAX_ESCALATIONS) {
    const carried = [...history, `Previous attempt by the ${expert.title} did not succeed:\n${lines.join("\n\n").slice(0, 6000)}`];
    const escalated = await runOne({ ...job, expert: next }, depth + 1, carried);
    lines.push(escalated);
  }
  return lines.join("\n\n");
}

export async function delegate(args: DelegateArgs): Promise<string> {
  return runOne(args);
}

/** Can this job's expert change files? (decides whether it needs its own worktree) */
function canWrite(job: DelegateArgs): boolean {
  const e = job.expert ? getExpert(job.expert) : pickExpert(job.task).expert;
  return Boolean(e?.tools.some((t) => ["write_file", "edit_file", "multi_edit", "run_command"].includes(t)));
}

/**
 * Run up to MAX_PARALLEL experts at a time; one failure never blocks the rest.
 * When two or more of them can write, each writer gets its own git worktree
 * and its changes are merged back afterwards, so parallel edits never collide.
 */
export async function delegateTeam(args: { tasks: DelegateArgs[]; isolate?: boolean }): Promise<string> {
  const jobs = Array.isArray(args.tasks) ? args.tasks.filter((t) => t?.task) : [];
  if (!jobs.length) return "❌ delegate_team: `tasks` must list at least one task.";

  const writers = jobs.map(canWrite);
  const isolate = args.isolate !== false && writers.filter(Boolean).length >= 2 && (await isGitRepo());
  const trees: (Worktree | null)[] = new Array(jobs.length).fill(null);
  if (isolate) {
    for (let i = 0; i < jobs.length; i++) if (writers[i]) trees[i] = await createWorktree(jobs[i].expert || `task-${i + 1}`);
  }

  const results: string[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        const tree = trees[i];
        results[i] = tree ? await runInWorkspace(tree.path, () => runOne(jobs[i])) : await runOne(jobs[i]);
      } catch (err) {
        results[i] = `❌ ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, jobs.length) }, worker));

  // Merge isolated work back, one worktree at a time
  for (let i = 0; i < jobs.length; i++) {
    const tree = trees[i];
    if (!tree) continue;
    const m = await mergeWorktree(tree);
    results[i] += m.applied
      ? m.files.length
        ? `\n[merged ${m.files.length} file${m.files.length === 1 ? "" : "s"} from its worktree: ${m.files.slice(0, 8).join(", ")}]`
        : "\n[no file changes]"
      : `\n[⚠ could not merge automatically: ${m.conflict}. The work is kept in ${m.keptAt} — merge it by hand.]`;
  }

  const note = isolate ? " — writers worked in separate git worktrees" : "";
  return `Team report (${jobs.length} expert${jobs.length === 1 ? "" : "s"}${note}):\n\n${results.map((r, i) => `── ${i + 1}. ${jobs[i].task.slice(0, 80)}\n${r}`).join("\n\n")}`;
}

/**
 * heal — run the tests; while they fail, send the failures to the healer
 * expert and run them again (up to `max_rounds`). Never weakens tests.
 */
export async function heal(args: { command?: string; max_rounds?: number }): Promise<string> {
  const rounds = Math.max(1, Math.min(args.max_rounds ?? 3, 5));
  const healer = getExpert("healer");
  if (!healer) return "❌ heal: no healer expert available.";
  const log: string[] = [];
  let result = await runTests({ command: args.command });
  for (let round = 1; round <= rounds; round++) {
    if (isStopped()) return `⛔ Healing stopped by the user after ${round - 1} round${round === 2 ? "" : "s"}.\n${log.join("\n\n")}`;
    if (result.startsWith("✅")) {
      return `${round === 1 ? "Tests already pass." : `Healed in ${round - 1} round${round === 2 ? "" : "s"}.`}\n${result.split("\n").slice(0, 3).join("\n")}${log.length ? `\n\n${log.join("\n\n")}` : ""}`;
    }
    const report = await runExpert(healer, "Make the failing tests pass by fixing the root cause. Do not skip, delete or weaken tests.", {
      context: `Test run (round ${round}):\n${result.slice(0, 6000)}`,
    });
    log.push(`${header(report, healer.title, `round ${round}`)}\n${report.output.slice(0, 1500)}`);
    result = await runTests({ command: args.command });
  }
  const passed = result.startsWith("✅");
  return `${passed ? `Healed after ${rounds} rounds.` : `Still failing after ${rounds} rounds — needs a human look.`}\n${result.slice(0, 3000)}\n\n${log.join("\n\n")}`;
}

/**
 * run_workflow — run a saved team play (see agents/workflows.ts). Stages run
 * in order; steps inside a stage run in parallel; each stage sees the reports
 * of the stages before it. `name: "list"` lists the available workflows.
 */
export async function runWorkflow(args: { name: string; goal?: string }): Promise<string> {
  const name = (args.name || "").trim().toLowerCase();
  if (!name || name === "list") {
    return `Workflows:\n${getWorkflows()
      .map((w) => `- ${w.name}${w.source !== "builtin" ? ` (${w.source})` : ""}: ${w.description}\n    ${describeWorkflow(w)}`)
      .join("\n")}`;
  }
  const w = getWorkflow(name);
  if (!w) return `❌ Unknown workflow "${args.name}". Available: ${getWorkflows().map((x) => x.name).join(", ")}`;
  const goal = (args.goal || "").trim();
  if (!goal) return `❌ run_workflow "${w.name}" needs a goal.`;

  const sections: string[] = [`Workflow "${w.name}" — ${describeWorkflow(w)}`];
  const previous: string[] = [];
  for (let i = 0; i < w.stages.length; i++) {
    const stage = w.stages[i];
    const context = previous.length ? `Reports from earlier stages:\n${previous.join("\n\n").slice(-8000)}` : undefined;
    const results = await Promise.all(
      stage.map((step) => runOne({ task: step.task.replace(/\{\{\s*goal\s*\}\}/g, goal), expert: step.expert, context }))
    );
    const failedAll = results.every((r) => /✗ incomplete|⏱ ran out|❌/.test(r.split("\n")[0]) && !/✓ done/.test(r));
    sections.push(`── Stage ${i + 1}: ${stage.map((s) => s.expert).join(" + ")}\n${results.join("\n\n")}`);
    previous.push(...results.map((r, k) => `[${stage[k].expert}] ${r.slice(0, 3000)}`));
    if (failedAll) {
      sections.push(`Workflow stopped at stage ${i + 1}: every step failed.`);
      break;
    }
  }
  return sections.join("\n\n");
}
