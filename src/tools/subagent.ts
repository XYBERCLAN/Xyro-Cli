/**
 * spawn_agent / spawn_agents — compatibility wrappers over the expert system
 * (see tools/delegate.ts). Old sub-agent types map onto experts:
 *
 *   file_finder → scout · code_reviewer → reviewer · task_planner → architect
 *   summarizer → docs · generic → auto-routed by task
 */

import { delegate, delegateTeam } from "./delegate.js";

type SubAgentType = "file_finder" | "code_reviewer" | "task_planner" | "summarizer" | "generic";

const TYPE_TO_EXPERT: Record<SubAgentType, string | undefined> = {
  file_finder: "scout",
  code_reviewer: "reviewer",
  task_planner: "architect",
  summarizer: "docs",
  generic: undefined,
};

function toTask(job: { type?: SubAgentType; prompt: string; context_files?: string[] }) {
  const type: SubAgentType = job.type && job.type in TYPE_TO_EXPERT ? job.type : "generic";
  const context = job.context_files?.length ? `Files to consider:\n${job.context_files.map((f) => `- ${f}`).join("\n")}` : undefined;
  return { task: job.prompt, expert: TYPE_TO_EXPERT[type], context };
}

export async function spawnAgent(args: { type?: SubAgentType; prompt: string; context_files?: string[] }): Promise<string> {
  if (args.type && !(args.type in TYPE_TO_EXPERT)) {
    return `❌ Unknown sub-agent type "${args.type}". Valid types: ${Object.keys(TYPE_TO_EXPERT).join(", ")}`;
  }
  return delegate(toTask(args));
}

export async function spawnAgents(args: { agents: { type?: SubAgentType; prompt: string; context_files?: string[] }[] }): Promise<string> {
  const jobs = Array.isArray(args.agents) ? args.agents : [];
  if (jobs.length === 0) return "❌ spawn_agents: agents[] is required";
  return delegateTeam({ tasks: jobs.map(toTask) });
}
