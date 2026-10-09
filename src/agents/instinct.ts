// Instinct — experts recognise their own kind of work, no trigger words.
//
// Whatever XYRO is doing right now belongs to some specialist's trade:
// reading and searching is the scout's, editing is the builder's, running
// tests is the tester's. The side panel shows that specialist waking up and
// working, so you always see who is "on".
//
// Known tools map to their natural owner. Anything else (a new tool, an MCP
// or plugin tool) goes to the most specialised expert whose own tool list
// contains it — the one with the fewest tools, i.e. the narrowest trade.

import { getExperts } from "./experts.js";

const OWNER: Record<string, string> = {
  read_file: "scout", list_files: "scout", glob: "scout", search_code: "scout", find_files: "scout", repo_map: "scout",
  ast_inspect_file: "scout", ast_find_symbol: "scout", skill_search: "scout", skill_load: "scout",
  write_file: "builder", edit_file: "builder", multi_edit: "builder", propose_write_file: "builder", revert_file: "refactorer",
  run_tests: "tester", heal: "healer", diagnostics: "reviewer",
  run_command: "devops", bg_start: "devops", bg_output: "devops", bg_stop: "devops", bg_list: "devops",
  web_search: "researcher", fetch_url: "researcher", skill_find_online: "researcher", skill_install: "dependencies",
  write_todos: "architect", propose_plan: "architect", council: "architect",
  intent_save: "verifier", intent_check: "verifier", intent_remove: "verifier", tournament: "verifier",
  skill_forge: "memory-keeper", team_note: "memory-keeper",
};

/** The expert whose trade this tool belongs to (null for bookkeeping tools). */
export function instinctExpert(tool: string): string | null {
  if (OWNER[tool]) return OWNER[tool];
  if (tool.startsWith("git_")) return "git";
  if (["end_turn", "task_completed", "team_notes", "delegate", "delegate_team", "spawn_agent", "spawn_agents", "run_workflow", "assign_workers"].includes(tool)) return null;
  const owners = getExperts().filter((e) => e.tools.includes(tool) || e.mcp.some((m) => tool.startsWith(`mcp__${m.toLowerCase().replace(/[^a-z0-9]+/g, "_")}__`)));
  if (!owners.length) return null;
  return owners.reduce((best, e) => (e.tools.length < best.tools.length ? e : best)).name;
}
