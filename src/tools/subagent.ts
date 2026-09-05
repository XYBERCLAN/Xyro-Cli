/**
 * spawn_agent — Run a focused sub-agent with a fresh, isolated context.
 *
 * This is Xyro's equivalent of Freebuff's spawn_agents, adapted for a
 * single-process CLI. Each call spins up a lightweight LLM loop with:
 *   - A fresh message history (no parent context pollution)
 *   - A focused system prompt for the specific sub-task
 *   - Access to a curated subset of tools
 *   - A strict max-steps cap to prevent runaway costs
 *
 * Because Xyro is sequential (not parallel), sub-agents run one at a time.
 * The result is returned as a plain string to the parent agent.
 *
 * Sub-agent types:
 *   - "file_finder"  : Find relevant files for a task (uses list_files + search_code)
 *   - "code_reviewer": Review code quality and flag issues (read-only)
 *   - "task_planner" : Break a complex task into numbered steps
 *   - "summarizer"   : Summarize a large body of text/code
 *   - "generic"      : A general-purpose mini agent with all tools
 */

import OpenAI from "openai";
import pc from "picocolors";
import { createClient, callLLMStream } from "../providers/llm.js";
import { executeTool, getToolDefinitions } from "./registry.js";
import { truncateToolResult } from "../agent/loop.js";
import { loadPersistedConfig } from "../config/persist.js";

const SUB_AGENT_MAX_STEPS = 6;
const SUB_AGENT_TIMEOUT_MS = 60_000;

type SubAgentType = "file_finder" | "code_reviewer" | "task_planner" | "summarizer" | "generic";

const SYSTEM_PROMPTS: Record<SubAgentType, string> = {
  file_finder: `You are a file-finding sub-agent. Your only job is to find which files in the project are relevant to the user's request.
Use list_files to explore the directory structure, and search_code to find pattern matches.
Return ONLY a concise list of relevant file paths with a one-line description of why each is relevant.
Do NOT read file contents. Do NOT make changes. Stop after finding the files.`,

  code_reviewer: `You are a code review sub-agent. Your only job is to review code for quality, bugs, and improvements.
Read the files specified and provide a clear, numbered list of issues found.
Format: [SEVERITY: LOW|MED|HIGH] Description of the issue and suggested fix.
Do NOT make any changes. Read only.`,

  task_planner: `You are a task planning sub-agent. Break the given task into a clear numbered list of steps.
Each step should be actionable and specific. Identify dependencies between steps.
Output format:
1. [step description]
2. [step description]
...
Keep it concise. Do NOT execute any steps — only plan.`,

  summarizer: `You are a summarization sub-agent. Your job is to read the provided content and produce a concise summary.
Focus on: key decisions made, files changed, errors encountered, and final outcomes.
Be brief — aim for under 300 words.`,

  generic: `You are XYRO, a focused sub-agent working on a specific sub-task.
Complete ONLY the task described. Do not go beyond the scope.
When done, provide a clear summary of what you did and what you found.`,
};

/** Curated tool subsets per sub-agent type (by tool name) */
const ALLOWED_TOOLS: Record<SubAgentType, string[] | "all"> = {
  file_finder: ["list_files", "search_code", "glob"],
  code_reviewer: ["read_file", "list_files", "search_code"],
  task_planner: ["list_files", "read_file", "search_code"],
  summarizer: ["read_file"],
  generic: "all",
};

interface SubAgentResult {
  output: string;
  steps: number;
  timedOut: boolean;
}

async function runSubAgent(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  prompt: string,
  allowedToolNames: string[] | "all"
): Promise<SubAgentResult> {
  const allDefs = getToolDefinitions();
  const tools =
    allowedToolNames === "all"
      ? allDefs
      : allDefs.filter((t) => allowedToolNames.includes(t.function.name));

  const messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let steps = 0;
  const deadline = Date.now() + SUB_AGENT_TIMEOUT_MS;
  let lastContent = "";

  while (steps < SUB_AGENT_MAX_STEPS && Date.now() < deadline) {
    steps++;

    let response;
    try {
      response = await callLLMStream(client, model, messages as any, () => {}, tools);
    } catch {
      break;
    }

    const msg: { role: string; content: string | null; tool_calls?: unknown[] } = {
      role: "assistant",
      content: response.content || null,
    };
    if (response.tool_calls && response.tool_calls.length > 0) {
      msg.tool_calls = response.tool_calls;
    }
    messages.push(msg);

    if (response.content) lastContent = response.content;

    if (!response.tool_calls || response.tool_calls.length === 0) {
      break; // Agent is done
    }

    // Execute tool calls
    for (const tc of response.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(tc.function.arguments);
        result = await executeTool(tc.function.name, args);
      } catch (e) {
        result = `❌ Tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({
        role: "tool",
        content: truncateToolResult(result),
        tool_call_id: tc.id,
      } as any);
    }
  }

  return {
    output: lastContent || "Sub-agent completed without producing output.",
    steps,
    timedOut: Date.now() >= deadline,
  };
}

export async function spawnAgent(args: {
  type?: SubAgentType;
  prompt: string;
  /** Inject these file paths as extra context to the sub-agent */
  context_files?: string[];
}): Promise<string> {
  const type: SubAgentType = (args.type as SubAgentType) || "generic";

  if (!SYSTEM_PROMPTS[type]) {
    return `❌ Unknown sub-agent type "${type}". Valid types: ${Object.keys(SYSTEM_PROMPTS).join(", ")}`;
  }

  // Inherit model / credentials / base URL from the persisted session config
  // so the sub-agent uses the same provider as the main agent. Fall back to
  // explicit env vars, but never a silent OpenAI-only default that would hang
  // with an empty key on a random provider.
  const saved = loadPersistedConfig();
  const baseURL = process.env.XYRO_BASE_URL || saved.baseURL;
  const apiKey = process.env.XYRO_API_KEY || process.env.OPENAI_API_KEY || saved.apiKey;
  const model = process.env.XYRO_MODEL || saved.model;

  if (!apiKey) {
    return `❌ spawn_agent: no API key configured. Run /provider first (or pass --api-key / set OPENAI_API_KEY).`;
  }
  if (!model) {
    return `❌ spawn_agent: no model configured. Run /model to pick a model for your provider.`;
  }

  const client = createClient(baseURL, apiKey);

  let prompt = args.prompt;
  if (args.context_files && args.context_files.length > 0) {
    prompt += `\n\nContext files to consider:\n${args.context_files.map((f) => `- ${f}`).join("\n")}`;
  }

  process.stdout.write(`  ${pc.cyan("◆")} Spawning ${type} sub-agent...\n`);

  const result = await runSubAgent(
    client,
    model,
    SYSTEM_PROMPTS[type],
    prompt,
    ALLOWED_TOOLS[type]
  );

  const suffix = result.timedOut
    ? `\n[Sub-agent timed out after ${result.steps} steps]`
    : `\n[Sub-agent completed in ${result.steps} step(s)]`;

  return result.output + suffix;
}
