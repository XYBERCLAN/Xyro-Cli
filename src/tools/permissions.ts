/**
 * permissions — Per-tool user approval gate.
 *
 * A permission system (allow / ask / deny per tool) with confirm-before-act
 * behaviour. Tools fall into two buckets:
 *
 *   ALLOW_ALWAYS  — read-only / bookkeeping tools run without prompting.
 *   ASK_ALWAYS    — mutating or networked tools prompt the user in interactive
 *                   terminals before execution.
 *
 * Behaviour outside an interactive terminal (piped stdin / --json) defaults to
 * "allow" so scripts and CI keep working — the hard safety net (path
 * confinement, dangerous-command filter, SSRF guard) still applies.
 * Set XYRO_NO_APPROVE=1 to skip prompts entirely even in interactive mode.
 */

import { confirmAction } from "../ui/prompts.js";
import { isJsonMode } from "../ui/render.js";

/** Tools that never prompt (pure reads, planning, bookkeeping). */
const ALLOW_ALWAYS = new Set([
  "read_file",
  "list_files",
  "glob",
  "search_code",
  "find_files",
  "write_todos",
  "end_turn",
  "task_completed",
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "git_init",
  "git_pr_view",
  "revert_file",
]);

/** Tools that prompt for approval in an interactive terminal. */
const ASK_ALWAYS = new Set([
  "write_file",
  "edit_file",
  "fetch_url",
  "run_command",
  "spawn_agent",
  "spawn_agents",
  "git_commit",
  "git_push",
  "git_create_pr",
  "git_stash",
  "git_stash_pop",
  "git_checkout",
]);

export function shouldAskPermission(name: string): boolean {
  if (process.env.XYRO_NO_APPROVE) return false;
  if (ALLOW_ALWAYS.has(name)) return false;
  return ASK_ALWAYS.has(name);
}

export function canPromptUser(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && !isJsonMode();
}

function previewArgs(name: string, args: Record<string, unknown>): string {
  if (name === "run_command") {
    return `executing command: ${String(args.command || "").slice(0, 80)}`;
  }
  if (typeof args.path === "string") return `path: ${args.path}`;
  if (typeof args.url === "string") return `url: ${args.url.slice(0, 80)}`;
  if (typeof args.message === "string") return `message: ${args.message.slice(0, 80)}`;
  return "";
}

/**
 * Prompt the user (or auto-allow outside TTY). Returns the verdict.
 * The caller is responsible for NOT executing the tool when the verdict
 * is "deny" (continue_loop_on_deny keeps the loop alive so the assistant
 * can react gracefully instead of burning more round-trips blindly).
 */
export async function requestPermission(
  name: string,
  args: Record<string, unknown>
): Promise<"allow" | "deny"> {
  if (!shouldAskPermission(name)) return "allow";
  if (!canPromptUser()) return "allow";

  const detail = previewArgs(name, args);
  try {
    const ok = await confirmAction(`${name}${detail ? ` (${detail})` : ""}`);
    return ok ? "allow" : "deny";
  } catch {
    return "allow";
  }
}

export const PERMISSION_DENIED_RESULT =
  "⛔ Permission denied by user. Do NOT retry this tool call unchanged. Adjust your approach or ask the user for confirmation.";