// Instant commands — the zero-token fast path.
//
// Some requests need no model at all: "run the tests", "what changed",
// "show the diff", "typecheck". Sending them to an LLM costs a round trip
// and free quota for nothing. When the WHOLE message is one of these (strict
// grammar — "run the tests and fix them" is not), XYRO runs it locally in
// milliseconds and adds the result to the conversation, so a follow-up like
// "fix the first failure" still has the context.
//
// Turn off with XYRO_INSTANT=off.

import { execa } from "execa";
import { workspaceRoot } from "./workspace.js";
import { runTests, diagnostics, repoMap } from "../tools/power.js";
import { runIntents, formatIntentResults } from "./intents.js";

export interface InstantCommand {
  /** Shown as the tool line, e.g. "run tests" */
  label: string;
  /** Tool name for display (matches what the model would have called) */
  tool: string;
  run: () => Promise<string>;
}

async function gitText(args: string[]): Promise<string> {
  const r = await execa("git", args, { cwd: workspaceRoot(), reject: false, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  return r.exitCode === 0 ? String(r.stdout) : `❌ ${String(r.stderr || "not a git repository").trim()}`;
}

async function whatChanged(): Promise<string> {
  const status = (await gitText(["status", "--short"])).trimEnd();
  if (status.startsWith("❌")) return status;
  if (!status) return "No changes: the working tree is clean.";
  const stat = (await gitText(["diff", "HEAD", "--stat"])).trimEnd();
  return `${status}${stat && !stat.startsWith("❌") ? `\n\n${stat}` : ""}`;
}

async function showDiff(): Promise<string> {
  const d = await gitText(["diff", "HEAD"]);
  if (d.startsWith("❌")) return d;
  if (!d.trim()) return "No changes: the working tree matches HEAD.";
  return d.length > 20_000 ? `${d.slice(0, 20_000)}\n… (diff truncated, ${d.length} chars)` : d;
}

const POLITE = /^(?:please|pls|plz|can you|could you|now)\s+|\s+(?:please|pls|plz|now)$/gi;

const RULES: { re: RegExp; cmd: Omit<InstantCommand, "run">; run: () => Promise<string> }[] = [
  { re: /^(?:re-?run|run|start)?\s*(?:the\s+|all\s+(?:the\s+)?)?(?:tests?|test suite|specs?)$/, cmd: { label: "run tests", tool: "run_tests" }, run: () => runTests({}) },
  { re: /^(?:(?:git\s+)?status|what(?:'s| has| have)?\s+changed|what did (?:you|we) change|show (?:me )?(?:the )?changes)$/, cmd: { label: "what changed", tool: "git_status" }, run: whatChanged },
  { re: /^(?:show\s+(?:me\s+)?)?(?:the\s+)?(?:git\s+)?diff$/, cmd: { label: "diff", tool: "git_diff" }, run: showDiff },
  { re: /^(?:run\s+)?(?:the\s+)?(?:typecheck|type-check|type check|check (?:the )?types|lint|linter|diagnostics)$/, cmd: { label: "typecheck & lint", tool: "diagnostics" }, run: () => diagnostics({}) },
  { re: /^(?:show\s+(?:me\s+)?)?(?:the\s+)?(?:repo|repository|project|code)\s*(?:map|structure|overview)$/, cmd: { label: "repo map", tool: "repo_map" }, run: () => repoMap({}) },
  { re: /^(?:check|run|verify)\s+(?:the\s+|my\s+)?intents$/, cmd: { label: "intent checks", tool: "intent_check" }, run: async () => formatIntentResults(await runIntents()) },
];

/** The instant command for this message, or null when it needs the model. */
export function matchInstant(text: string): InstantCommand | null {
  if (/^(off|0|false|no)$/i.test(process.env.XYRO_INSTANT ?? "")) return null;
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(POLITE, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return null;
  for (const r of RULES) if (r.re.test(t)) return { ...r.cmd, run: r.run };
  return null;
}
