/**
 * end_turn / task_completed — Explicit end-of-turn tool.
 *
 * The agent calls this tool to signal that it has finished its work for this
 * turn. The main loop stops iterating (no further LLM round trips) but keeps
 * the tool result in the conversation history for the record.
 */

export const END_TURN_TOOL_NAMES = new Set(["end_turn", "task_completed"]);

export async function endTurn(args: { reason?: string; summary?: string }): Promise<string> {
  const notes = [args.summary, args.reason].filter(Boolean).join(" — ");
  return `✅ End of turn${notes ? `: ${notes}` : ""}`;
}