// Expert runtime — runs one specialist on one task with its own context,
// tools, skills and plugins, under the same approval rules as XYRO itself.

import { requestBudget, providerIdForBaseURL } from "../providers/pool.js";
import { isStopped } from "../agent/cancel.js";
import OpenAI from "openai";
import { createClient, callLLMStream } from "../providers/llm.js";
import { executeTool, getAllToolDefinitions } from "../tools/registry.js";
import { shouldAskPermission, requestPermission, describeToolCall, PERMISSION_DENIED_RESULT } from "../tools/permissions.js";
import { loadPersistedConfig } from "../config/persist.js";
import { getPluginToolNames, listLoadedPlugins } from "../config/plugins.js";
import { getMcpToolNames } from "../mcp/manager.js";
import { getEnvironmentContext } from "../config/platform.js";
import { emitAgentActivity, getToolApprover, AgentActivity } from "../agent/ui-bridge.js";
import { Expert } from "./experts.js";
import { findSkill, loadSkillBody, matchSkills } from "./skills-catalog.js";
import { rememberOutcome } from "./router.js";
import { expertModel, expertBudget } from "./team-config.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { getProviderKey } from "../config/persist.js";

const EXPERT_TIMEOUT_MS = 4 * 60_000;
const FRUGAL_EXPERT_STEPS = 6;
const MAX_TOOL_RESULT = 6000;
/** Tools only the coordinator may use (no recursion, no plan approvals from experts). */
const COORDINATOR_ONLY = new Set(["council", "skill_forge", "tournament", "delegate", "delegate_team", "spawn_agent", "spawn_agents", "propose_plan", "heal", "run_workflow"]);

export interface LLMSession {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

let sessionProvider: (() => LLMSession) | null = null;

/** The UI layer tells experts which model/key the live session is using. */
export function setExpertSession(fn: (() => LLMSession) | null): void {
  sessionProvider = fn;
}

export function resolveSession(expert: Expert): LLMSession {
  const live = sessionProvider?.() ?? {};
  const saved = loadPersistedConfig();
  const session: LLMSession = {
    baseURL: live.baseURL || process.env.XYRO_BASE_URL || saved.baseURL,
    apiKey: live.apiKey || process.env.XYRO_API_KEY || process.env.OPENAI_API_KEY || saved.apiKey,
    model: expert.model || live.model || process.env.XYRO_MODEL || saved.model,
  };
  // Per-expert model from experts.json — possibly on another provider
  const assigned = expertModel(expert.name);
  if (assigned?.model) {
    session.model = assigned.model;
    if (assigned.providerId) {
      const prov = FREE_PROVIDERS.find((p) => p.id === assigned.providerId);
      const key = assigned.providerId === "local" ? "ollama" : getProviderKey(assigned.providerId);
      if (prov && key) {
        session.baseURL = prov.baseURL;
        session.apiKey = key;
      }
    }
  }
  return session;
}

/** Tokens for one LLM step: provider usage when reported, else a ~4 chars/token estimate. */
function stepTokens(usage: unknown, messages: { content: string | null }[], reply: string): number {
  const u = usage as { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | null | undefined;
  if (u?.total_tokens) return u.total_tokens;
  if (u?.prompt_tokens || u?.completion_tokens) return (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
  const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) + reply.length;
  return Math.ceil(chars / 4);
}

export interface ExpertReport {
  expert: string;
  ok: boolean;
  output: string;
  steps: number;
  toolCalls: number;
  toolErrors: number;
  skills: string[];
  timedOut: boolean;
  tokens: number;
  model: string;
  budgetHit: boolean;
  /** Successful file changes made during this run (drives verification) */
  writes: number;
}

const WRITE_TOOLS = new Set(["write_file", "edit_file", "multi_edit", "revert_file"]);

let nextId = 1;

/** Skills for this run: the expert's own (when installed) plus up to 2 matched to the task. */
function skillsFor(expert: Expert, task: string, extra: string[] = []): string[] {
  const names = [...extra, ...expert.skills].filter((n) => findSkill(n));
  for (const s of matchSkills(task, 2)) if (!names.includes(s.name)) names.push(s.name);
  return [...new Set(names)].slice(0, 3);
}

function toolsFor(expert: Expert, opts: RunExpertOptions = {}): OpenAI.ChatCompletionTool[] {
  const allowed = new Set(expert.tools);
  // Every expert can lead workers; workers (and the verifier) can't
  if (!opts.worker && expert.name !== "verifier") allowed.add("assign_workers");
  for (const p of expert.plugins) getPluginToolNames(p).forEach((t) => allowed.add(t));
  for (const m of expert.mcp) getMcpToolNames(m).forEach((t) => allowed.add(t));
  // Every expert can talk to the rest of the team
  allowed.add("team_note");
  allowed.add("team_notes");
  // …and reach every skill and plugin whenever its task needs one
  for (const t of ["skill_search", "skill_load", "skill_find_online"]) allowed.add(t);
  for (const p of listLoadedPlugins()) p.tools.forEach((t) => allowed.add(t));
  return getAllToolDefinitions().filter(
    (t) => allowed.has(t.function.name) && !COORDINATOR_ONLY.has(t.function.name) && (!opts.toolFilter || opts.toolFilter(t.function.name))
  );
}

async function approve(name: string, args: Record<string, unknown>, autoApprove?: RunExpertOptions["autoApprove"]): Promise<boolean> {
  if (!shouldAskPermission(name) || (await autoApprove?.(name, args))) return true;
  const ui = getToolApprover();
  if (ui) return ui(describeToolCall(name, args));
  return (await requestPermission(name, args)) === "allow";
}

/** Run one expert on one task and return its report. */
export interface RunExpertOptions {
  context?: string;
  skills?: string[];
  /** Run on this model/provider instead of the expert's usual one (tournaments) */
  session?: LLMSession;
  /** Tools that need no approval in this run (file edits inside a throwaway worktree) */
  autoApprove?: (name: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Shown in the side panel after the expert's title */
  label?: string;
  /** Limit the tools for this run (council phases are read-only or talk-only) */
  toolFilter?: (name: string) => boolean;
  /** Set when this run is a worker under a lead expert (workers can't lead) */
  worker?: boolean;
}

/** Experts lead; workers obey. Lead → workers is one level deep. */
const MAX_WORKERS = 3;
const WORKER_MAX_STEPS = 10;

/**
 * A lead expert hands sub-tasks to workers. Each worker carries the lead's
 * rules and guidelines, can only use tools the lead has (optionally fewer),
 * and reports back to the lead — not to the coordinator.
 */
async function runWorkers(lead: Expert, session: LLMSession, args: Record<string, unknown>, opts: RunExpertOptions): Promise<{ text: string; writes: number }> {
  const tasks = (Array.isArray(args.tasks) ? (args.tasks as { task?: string; rules?: string; tools?: string[] }[]) : []).filter((t) => t?.task).slice(0, MAX_WORKERS);
  if (!tasks.length) return { text: "❌ assign_workers: give `tasks` (1-3), each with a `task`.", writes: 0 };
  const shared = typeof args.rules === "string" ? args.rules : "";
  const reports = await Promise.all(
    tasks.map((t, i) => {
      const allowed = Array.isArray(t.tools) && t.tools.length ? lead.tools.filter((x) => t.tools!.includes(x)) : lead.tools;
      const rules = [shared, t.rules].filter(Boolean).join("\n");
      const worker: Expert = {
        ...lead,
        name: `${lead.name}-worker`,
        title: `${lead.title} worker ${i + 1}`,
        persona: `You are worker ${i + 1} on the ${lead.title}'s team. Your lead assigned you ONE task. Obey the lead's rules exactly, do only what was assigned, and report back concisely: what you did, files you changed, anything the lead must decide.\n\nRules from your lead:\n${rules || "(none beyond the task)"}\n\nYour lead's own guidelines (follow them too):\n${lead.persona.slice(0, 1500)}`,
        tools: allowed,
        maxSteps: Math.min(lead.maxSteps, WORKER_MAX_STEPS),
      };
      return runExpert(worker, t.task!, { session, worker: true, autoApprove: opts.autoApprove, label: `for ${lead.title}` });
    })
  );
  const writes = reports.reduce((n, r) => n + r.writes, 0);
  const text = reports.map((r, i) => `── worker ${i + 1}: ${tasks[i].task!.slice(0, 80)} [${r.ok ? "done" : "incomplete"}]\n${r.output.slice(0, 3000)}`).join("\n\n");
  return { text: `${text}${writes ? `\n(workers changed ${writes} file${writes === 1 ? "" : "s"})` : ""}`, writes };
}

export async function runExpert(expert: Expert, task: string, opts: RunExpertOptions = {}): Promise<ExpertReport> {
  const session = opts.session ?? resolveSession(expert);
  const skills = skillsFor(expert, task, opts.skills);
  const budget = expertBudget(expert.name);
  const base: Omit<ExpertReport, "ok" | "output" | "timedOut"> = {
    expert: expert.name,
    steps: 0,
    toolCalls: 0,
    toolErrors: 0,
    skills,
    tokens: 0,
    model: session.model ?? "",
    budgetHit: false,
    writes: 0,
  };

  if (!session.apiKey || !session.model) {
    return { ...base, ok: false, timedOut: false, output: `❌ ${expert.title} could not start: no ${!session.apiKey ? "API key" : "model"} configured (use /provider or /model).` };
  }

  const tools = toolsFor(expert, opts);
  const skillText = skills
    .map((n) => {
      const body = loadSkillBody(n);
      return body ? `### Skill: ${n}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const system = [
    expert.persona,
    getEnvironmentContext(),
    `## Your tools\n${tools.map((t) => t.function.name).join(", ") || "none (answer from reasoning)"}`,
    skillText ? `## Skills to apply\n${skillText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[] = [
    { role: "system", content: system },
    { role: "user", content: opts.context ? `${task}\n\nContext from the coordinator:\n${opts.context}` : task },
  ];

  const activity: AgentActivity = {
    id: nextId++,
    expert: expert.name,
    title: opts.label ? `${expert.title} · ${opts.label}` : expert.title,
    task,
    status: "running",
    step: 0,
    maxSteps: expert.maxSteps,
    skills,
    startedAt: Date.now(),
    tokens: 0,
    budget,
    model: session.model,
  };
  emitAgentActivity(activity);

  const client = createClient(session.baseURL, session.apiKey);
  const deadline = Date.now() + EXPERT_TIMEOUT_MS;
  let lastContent = "";
  let finished = false;
  let error = "";

  // A tight daily request budget: each expert step is a request, so keep experts short
  const maxSteps = requestBudget(providerIdForBaseURL(session.baseURL)).frugal ? Math.min(expert.maxSteps, FRUGAL_EXPERT_STEPS) : expert.maxSteps;
  activity.maxSteps = maxSteps;
  while (activity.step < maxSteps && Date.now() < deadline) {
    if (isStopped()) {
      error = "stopped by the user";
      break;
    }
    if (base.tokens >= budget) {
      base.budgetHit = true;
      break;
    }
    activity.step++;
    activity.tool = undefined;
    emitAgentActivity(activity);

    let response;
    try {
      response = await callLLMStream(client, session.model, messages as never, () => {}, tools);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }

    base.tokens += stepTokens(response.usage, messages, response.content ?? JSON.stringify(response.tool_calls ?? []));
    activity.tokens = base.tokens;
    const msg: { role: string; content: string | null; tool_calls?: unknown[] } = { role: "assistant", content: response.content || null };
    if (response.tool_calls?.length) msg.tool_calls = response.tool_calls;
    messages.push(msg);
    if (response.content) lastContent = response.content;

    if (!response.tool_calls?.length) {
      finished = true;
      break;
    }

    for (const tc of response.tool_calls) {
      if (isStopped()) {
        messages.push({ role: "tool", content: "⛔ Not run: the user stopped this turn.", tool_call_id: tc.id } as never);
        continue;
      }
      base.toolCalls++;
      activity.tool = tc.function.name;
      emitAgentActivity(activity);
      let result: string;
      try {
        const args = JSON.parse(tc.function.arguments || "{}");
        if (tc.function.name === "team_note") args.author = expert.title; // notes are signed by the expert
        if (COORDINATOR_ONLY.has(tc.function.name) || !tools.some((t) => t.function.name === tc.function.name)) {
          result = `❌ ${tc.function.name} is not available to the ${expert.title}.`;
        } else if (tc.function.name === "assign_workers") {
          const w = await runWorkers(expert, session, args, opts);
          base.writes += w.writes;
          result = w.text;
        } else if (!(await approve(tc.function.name, args, opts.autoApprove))) {
          result = PERMISSION_DENIED_RESULT;
        } else {
          result = await executeTool(tc.function.name, args);
        }
      } catch (e) {
        result = `❌ Tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (result.startsWith("❌")) base.toolErrors++;
      else if (WRITE_TOOLS.has(tc.function.name) && !result.startsWith("⛔")) base.writes++;
      messages.push({ role: "tool", content: result.length > MAX_TOOL_RESULT ? result.slice(0, MAX_TOOL_RESULT) + "\n… (truncated)" : result, tool_call_id: tc.id } as never);
    }
  }

  const timedOut = !finished && !error && !base.budgetHit;
  const ok = finished && Boolean(lastContent) && base.toolErrors <= Math.max(1, Math.floor(base.toolCalls / 2));
  activity.status = ok ? "done" : "failed";
  activity.tool = undefined;
  activity.endedAt = Date.now();
  emitAgentActivity(activity);
  rememberOutcome(expert.name, task, ok);

  base.steps = activity.step;
  const output = error
    ? `❌ ${expert.title} stopped: ${error.slice(0, 300)}${lastContent ? `\n\nPartial report:\n${lastContent}` : ""}`
    : base.budgetHit
      ? `⚠ ${expert.title} reached its token budget (${Math.round(budget / 1000)}k) before finishing.${lastContent ? `\n\nProgress so far:\n${lastContent}` : ""}`
      : lastContent || `${expert.title} finished without a report.`;
  return { ...base, ok, output, timedOut };
}
