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
import { mcpNeedsApproval } from "../mcp/approvals.js";

/** Tools that never prompt (pure reads, planning, bookkeeping). */
const ALLOW_ALWAYS = new Set([
  "read_file",
  "load_tools",
  "skill_load",
  "council",
  "assign_workers",
  "skill_search",
  "intent_check",
  "list_files",
  "glob",
  "search_code",
  "find_files",
  "write_todos",
  "propose_plan",
  // Experts are gated per tool inside their own run
  "delegate",
  "delegate_team",
  "spawn_agent",
  "spawn_agents",
  "run_workflow",
  "team_note",
  "team_notes",
  "bg_output",
  "bg_list",
  "glob",
  "find_files",
  "repo_map",
  "end_turn",
  "task_completed",
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "git_pr_view",
]);

/** Tools that prompt for approval in an interactive terminal. */
const ASK_ALWAYS = new Set([
  "write_file",
  "git_init",
  "skill_install",
  "skill_find_online",
  "web_search",
  "skill_forge",
  "tournament",
  "intent_save",
  "intent_remove",
  "edit_file",
  "fetch_url",
  "run_command",
  "revert_file",
  "multi_edit",
  "run_tests",
  "propose_write_file",
  // Runs the project's own tsc/eslint (eslint configs are code) — ask first
  "diagnostics",
  "bg_start",
  "bg_stop",
  "heal",
  "git_commit",
  "git_push",
  "git_create_pr",
  "git_stash",
  "git_stash_pop",
  "git_checkout",
  "git_add",
  "git_reset",
  "git_create_branch",
  "git_pull",
  "git_fetch",
  "git_rebase",
]);

export function shouldAskPermission(name: string): boolean {
  if (process.env.XYRO_NO_APPROVE) return false;
  if (ALLOW_ALWAYS.has(name)) return false;
  // MCP tools can act on the outside world (push, write a DB…): ask unless auto-approved
  if (name.startsWith("mcp__")) return mcpNeedsApproval(name);
  return ASK_ALWAYS.has(name);
}

export function canPromptUser(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && !isJsonMode();
}

export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const detail = previewArgs(name, args);
  return `${name}${detail ? ` (${detail})` : ""}`;
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

  try {
    const ok = await confirmAction(describeToolCall(name, args));
    return ok ? "allow" : "deny";
  } catch {
    return "deny";
  }
}

export const PERMISSION_DENIED_RESULT =
  "⛔ Permission denied by user. Do NOT retry this tool call unchanged. Adjust your approach or ask the user for confirmation.";