// Intent regression guard — what you asked for stays done.
//
// When you state a lasting requirement ("the login must reject empty
// passwords", "never print the API key"), XYRO saves it as an executable check
// in .xyro/intents.json. After every turn that changed files, the checks run
// again; anything that broke is reported and fixed before the turn ends.
//
//   { "intents": [
//     { "id": "i1", "said": "login rejects empty passwords",
//       "command": "npm test -- --test-name-pattern='empty password'" },
//     { "id": "i2", "said": "never log the API key",
//       "file": "src/index.ts", "pattern": "console\\.log\\(.*apiKey", "absent": true }
//   ]}
//
// Command checks run only once you trusted that exact file content (XYRO
// trusts what it saved itself after your approval; a file that arrived via
// git needs `/intents trust`). Pattern checks never execute anything.

import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { workspaceRoot } from "./workspace.js";
import { projectFileTrust, trustProjectFile, ProjectHookStatus } from "./hooks.js";
import { isDangerousCommand } from "../tools/shell.js";
import { resolveProjectPath } from "../tools/safety.js";

export interface Intent {
  id: string;
  /** What the user asked for, in their words */
  said: string;
  /** Shell check: passes when it exits 0 */
  command?: string;
  /** Pattern check: regex over a project file */
  file?: string;
  pattern?: string;
  /** Pattern check passes when the pattern is NOT found */
  absent?: boolean;
  added: string;
}

export interface IntentResult {
  intent: Intent;
  ok: boolean;
  /** Skipped: command check in an untrusted file */
  skipped?: boolean;
  detail: string;
}

const CHECK_TIMEOUT_MS = 120_000;

export function intentsPath(root = workspaceRoot()): string {
  return join(root, ".xyro", "intents.json");
}

export function listIntents(root = workspaceRoot()): Intent[] {
  try {
    const j = JSON.parse(fs.readFileSync(intentsPath(root), "utf-8")) as { intents?: Intent[] };
    return (j.intents ?? []).filter((i) => i && typeof i.said === "string" && (typeof i.command === "string" || (typeof i.file === "string" && typeof i.pattern === "string")));
  } catch {
    return [];
  }
}

export function intentsTrust(root = workspaceRoot()): ProjectHookStatus {
  return projectFileTrust(intentsPath(root));
}

export function trustIntents(root = workspaceRoot()): boolean {
  return trustProjectFile(intentsPath(root));
}

function write(intents: Intent[], root: string): void {
  const p = intentsPath(root);
  // Never silently re-trust a file someone else changed: keep its status
  const wasUntrusted = intentsTrust(root) === "untrusted";
  fs.mkdirSync(dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ intents }, null, 2) + "\n");
  if (!wasUntrusted) trustProjectFile(p);
}

function nextId(intents: Intent[]): string {
  const n = intents.reduce((m, i) => Math.max(m, Number(i.id.replace(/\D/g, "")) || 0), 0);
  return `i${n + 1}`;
}

/** Validate and save a new intent. Returns a message for the model. */
export function saveIntent(args: { said: string; command?: string; file?: string; pattern?: string; absent?: boolean }, root = workspaceRoot()): string {
  const said = (args.said ?? "").trim();
  if (!said) return "❌ intent_save: `said` (the user's requirement) is required.";
  const hasCmd = typeof args.command === "string" && args.command.trim() !== "";
  const hasPat = typeof args.file === "string" && typeof args.pattern === "string";
  if (hasCmd === hasPat) return "❌ intent_save: give either `command`, or `file` + `pattern`.";
  if (hasCmd && isDangerousCommand(args.command!)) return "❌ intent_save: refused, that check command is dangerous.";
  if (hasPat) {
    if (!resolveProjectPath(args.file!).ok) return `❌ intent_save: ${args.file} is outside the project.`;
    try {
      new RegExp(args.pattern!);
    } catch {
      return "❌ intent_save: `pattern` is not a valid regular expression.";
    }
  }
  const intents = listIntents(root);
  const intent: Intent = {
    id: nextId(intents),
    said,
    ...(hasCmd ? { command: args.command!.trim() } : { file: args.file, pattern: args.pattern, ...(args.absent ? { absent: true } : {}) }),
    added: new Date().toISOString(),
  };
  write([...intents, intent], root);
  return `✅ Saved intent ${intent.id}: "${said}". It is re-checked after every change.`;
}

export function removeIntent(id: string, root = workspaceRoot()): string {
  const intents = listIntents(root);
  const left = intents.filter((i) => i.id !== id);
  if (left.length === intents.length) return `❌ No intent with id ${id}.`;
  write(left, root);
  return `✅ Removed intent ${id}.`;
}

async function runOne(intent: Intent, root: string, trusted: boolean): Promise<IntentResult> {
  if (intent.command) {
    if (!trusted) return { intent, ok: true, skipped: true, detail: "not trusted yet (/intents trust)" };
    if (isDangerousCommand(intent.command)) return { intent, ok: false, detail: "check command refused as dangerous" };
    const res = await execa({ shell: true, cwd: root, timeout: CHECK_TIMEOUT_MS, reject: false, maxBuffer: 4 * 1024 * 1024 })(intent.command);
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
    if (res.exitCode === 0) return { intent, ok: true, detail: "passed" };
    return { intent, ok: false, detail: (res.timedOut ? "timed out. " : `exit ${res.exitCode}. `) + out.split("\n").slice(-15).join("\n").slice(-1500) };
  }
  const r = resolveProjectPath(intent.file!);
  if (!r.ok) return { intent, ok: false, detail: r.message };
  let text = "";
  try {
    text = fs.readFileSync(r.path, "utf-8");
  } catch {
    return { intent, ok: Boolean(intent.absent), detail: `${intent.file} does not exist` };
  }
  let found: boolean;
  try {
    found = new RegExp(intent.pattern!, "m").test(text);
  } catch {
    return { intent, ok: false, detail: "invalid pattern" };
  }
  const ok = intent.absent ? !found : found;
  return { intent, ok, detail: ok ? "passed" : intent.absent ? `forbidden pattern found in ${intent.file}` : `expected pattern missing from ${intent.file}` };
}

/** Run every intent check (sequentially: checks may share build output). */
export async function runIntents(root = workspaceRoot(), definitionsFrom = root): Promise<IntentResult[]> {
  // Checks come from (and are trusted by) `definitionsFrom`; they run in `root`
  // — so a worktree is judged by the user's real intents, not a copy it edited.
  const intents = listIntents(definitionsFrom);
  const trusted = intentsTrust(definitionsFrom) === "trusted";
  const out: IntentResult[] = [];
  for (const i of intents) out.push(await runOne(i, root, trusted));
  return out;
}

export function formatIntentResults(results: IntentResult[]): string {
  if (!results.length) return "No saved intents. Save lasting requirements with intent_save.";
  const broken = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"} ${r.intent.id} "${r.intent.said}"${r.ok && !r.skipped ? "" : `\n     ${r.detail.replace(/\n/g, "\n     ")}`}`);
  return `${broken.length ? `${broken.length} of ${results.length} intents broken` : `All ${results.length} intents hold`}\n${lines.join("\n")}`;
}

/** Short block for the system prompt so the model knows what must keep holding. */
export function intentsPrompt(root = workspaceRoot()): string {
  const intents = listIntents(root);
  const head =
    "## Intent guard\nWhen the user states a lasting requirement (must, always, never, should keep), save it with intent_save as a check: prefer a precise test command, or a file + regex pattern. Checks re-run after every change; never weaken or delete a check to make it pass.";
  if (!intents.length) return head;
  return `${head}\nRequirements that must keep holding:\n${intents.map((i) => `- ${i.id}: ${i.said}`).join("\n").slice(0, 3000)}`;
}
