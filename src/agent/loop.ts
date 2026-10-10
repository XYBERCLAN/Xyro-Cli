import { requestBudget, providerIdForBaseURL } from "../providers/pool.js";
import { dispatchFor } from "./dispatch.js";
import { beginTurn, cancelTurn, isStopped } from "./cancel.js";
import { recordEvent, classifyMessage, reflect, reflectionDue, formatReflection } from "./learning.js";
import { pickExpert } from "../agents/router.js";
import { listIntents, runIntents, formatIntentResults } from "./intents.js";
import OpenAI from "openai";
import pc from "picocolors";
import { Message, AgentOptions } from "./types.js";
import { HistoryManager } from "./history.js";
import { createClient, callLLM, callLLMStream, summarizeHistory, LLMResponse, ModelSwitch, describeError } from "../providers/llm.js";
import { executeTool, getPlanModeToolDefinitions } from "../tools/registry.js";
import { END_TURN_TOOL_NAMES } from "../tools/end_turn.js";
import { requestPermission, shouldAskPermission, describeToolCall, PERMISSION_DENIED_RESULT } from "../tools/permissions.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOOL_CALLS, CONTEXT_WINDOW_WARN_TOKENS, POST_TURN_COMPACT_TOKENS } from "../config/constants.js";
import {
  renderAssistant,
  renderUserMessage,
  renderToolCall,
  renderToolResult,
  renderStreamStart,
  renderStreamChunk,
  renderThinking,
  renderThinkingDone,
  renderToolRunning,
  renderToolRunningDone,
  renderStreamEnd,
  isJsonMode,
} from "../ui/render.js";

export type ResponseHandler = (usage: unknown) => void;

// Output adapter: line-printing (default) or TUI sink — when set, all
// terminal rendering routes here so the full-screen TUI owns the screen.
export interface AgentOutput {
  onUserMessage?(text: string): void;
  onAssistantText?(content: string): void;
  onAssistantDone?(durationSec: number): void;
  onToolStart?(name: string, summary: string): void;
  onToolResult?(name: string, summary: string, elapsed: string, failed: boolean): void;
  onError?(message: string): void;
  /** The free-quota pool moved this request to another model/provider. */
  onModelSwitched?(s: ModelSwitch): void;
  /** The experts recognised for this request, ready before any work starts */
  onDispatch?(team: { name: string; title: string; why: string }[]): void;
  /** A short status line (intent guard, privacy shield…) */
  onNotice?(text: string, kind: "info" | "warn"): void;
  /** Ask the user to approve a mutating/exec tool call (TUI modal). */
  requestPermission?(label: string): Promise<boolean>;
}

/** Human-readable target for a tool call: the path, command, pattern, … */
export function summarizeToolArgs(args: Record<string, unknown>): string {
  for (const key of ["path", "command", "pattern", "url", "symbol", "query", "revision", "branch", "message", "pr", "type"]) {
    const v = args?.[key];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  if (Array.isArray(args?.files)) return (args.files as unknown[]).join(" ").slice(0, 120);
  const json = JSON.stringify(args ?? {});
  return json === "{}" ? "" : json.slice(0, 80);
}

/** Calling any of these counts as having a plan for the turn. */
const PLANNING_TOOLS = new Set(["write_todos", "propose_plan", "council", "run_workflow", "delegate_team"]);

/** Tools after which the intent guard re-checks saved requirements. */
const FILE_CHANGING_TOOLS = new Set([
  "write_file", "edit_file", "multi_edit", "propose_write_file", "revert_file", "run_command",
  "delegate", "delegate_team", "spawn_agent", "spawn_agents", "run_workflow", "heal",
]);

/** Upper bound for a background history compaction (a slow model must never block the next turn). */
const COMPACT_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Max characters for tool results before truncation */
export const MAX_TOOL_RESULT_CHARS = 4000;

/** Max estimated tokens for conversation history before trimming */
export const MAX_HISTORY_TOKENS = 20000;

/** Sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Truncate large tool results to avoid exceeding token limits */
export function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  return result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n... (truncated, ${result.length} chars total)`;
}

/** Estimate token count from character count (rough: 1 token ≈ 4 chars) */
export function estimateTokens(msgs: Message[]): number {
  let chars = 0;
  for (const m of msgs) {
    chars += (m.content || "").length;
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        chars += (tc.function?.arguments || "").length;
        chars += (tc.function?.name || "").length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

/** Group messages into atomic turns to prevent splitting assistant tool_calls from tool results */
function groupIntoTurns(msgs: Message[]): Message[][] {
  const turns: Message[][] = [];
  let currentTurn: Message[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (msg.role === "user") {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
    } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      if (currentTurn.length > 0 && currentTurn[0].role === "user") {
        currentTurn.push(msg);
      } else {
        if (currentTurn.length > 0) turns.push(currentTurn);
        currentTurn = [msg];
      }
    } else if (msg.role === "tool") {
      currentTurn.push(msg);
    } else {
      // Normal assistant message or system summary
      if (currentTurn.length > 0 && currentTurn[0].role === "user") {
        currentTurn.push(msg);
        turns.push(currentTurn);
        currentTurn = [];
      } else {
        if (currentTurn.length > 0) turns.push(currentTurn);
        currentTurn = [msg];
      }
    }
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

/**
 * Doom-loop guard:
 * if the exact same tool call (name + arguments) fires N times consecutively,
 * we stop the turn instead of burning tokens indefinitely.
 */
export const DOOM_LOOP_THRESHOLD = 3;

/** Max consecutive "thought-only" LLM rounds before forcing a stop. */
export const MAX_THINK_ROUNDS = 5;

/**
 * Track a tool-call signature and detect a doom loop: the same signature
 * repeated DOOM_LOOP_THRESHOLD times consecutively.
 */
export function isRepeatedToolCall(
  signature: string,
  lastRun: { sig: string; run: number } | null
): { sig: string; run: number; isDoom: boolean } {
  const run = lastRun && lastRun.sig === signature ? lastRun.run + 1 : 1;
  return { sig: signature, run, isDoom: run >= DOOM_LOOP_THRESHOLD };
}

/**
 * Detect a "thought-only" LLM response:
 * the model only emitted reasoning/thinking text with no tool call and no
 * real answer — we should keep going instead of ending the turn.
 */
export function isThinkOnlyResponse(content: string | null): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (/^<thinking>|^thinking[:\-]|^let me think|^i(n)? need to think/i.test(trimmed)) {
    return true;
  }
  const withoutTags = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();
  return withoutTags === "";
}

/**
 * Split history for compaction v2: isolate the previous system/user/assistant
 * turns from the most recent (atomic) turn, which is kept verbatim so the
 * model retains its immediate working state after compaction.
 */
export function splitForCompact(msgs: Message[]): { older: Message[]; recent: Message[] } | null {
  if (msgs.length <= 2) return null;
  const systemMsg = msgs[0];
  const rest = msgs.slice(1);
  const turns = groupIntoTurns(rest);
  if (turns.length <= 1) return null;
  const pruned = prunePastToolResults(turns);
  const recentTurns = pruned[pruned.length - 1];
  const olderTurns = pruned.slice(0, -1);
  return {
    older: [systemMsg as Message, ...olderTurns.flat()],
    recent: recentTurns,
  };
}

/** Canonical signpost prefix for compaction summaries. */
export function canonicalSummaryHeader(): string {
  return "What did we do so far?";
}

/**
 * Prune verbose tool results from past completed turns to keep prompt payloads lean.
 * The active turn (last turn) is kept completely intact so the assistant can read full outputs.
 */
export function prunePastToolResults(turns: Message[][]): Message[][] {
  if (turns.length <= 1) return turns;

  return turns.map((turn, index) => {
    // Active turn: keep full output for current turn reasoning
    if (index === turns.length - 1) return turn;

    return turn.map((msg) => {
      if (msg.role === "tool" && msg.content && msg.content.length > 120) {
        const isErr = msg.content.startsWith("❌");
        const brief = isErr
          ? msg.content.slice(0, 100)
          : `[output processed by assistant: ${msg.content.slice(0, 60).replace(/\s+/g, " ")}...]`;
        return {
          ...msg,
          content: brief,
        };
      }
      return msg;
    });
  });
}

/** Get safe max history tokens based on provider limits */
/** Context windows learned from "maximum context length is N tokens" errors (per model). */
const learnedContext = new Map<string, number>();

/** Read the model's real context limit out of a provider's 400 message. */
export function noteContextLimit(model: string, err: unknown): number | null {
  const msg = String((err as { message?: string })?.message ?? err);
  const m = msg.match(/(?:maximum context length|context(?: window| length)?(?: is| of)?|max(?:imum)? tokens?)[^\d]{0,40}(\d{4,7})/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 1024) learnedContext.set(model, n);
  return n;
}

export function getMaxHistoryTokens(baseURL?: string, model?: string): number {
  const url = baseURL || "";
  const m = (model || "").toLowerCase();
  // A model that told us its window: leave room for the reply (4096) and the fixed prompt + tools (~5k)
  const learned = learnedContext.get(model ?? "");
  if (learned) return Math.max(1500, Math.min(MAX_HISTORY_TOKENS, learned - 4096 - 5000));
  // Groq free tier has strict TPM limits (~6K-8K tokens/min)
  if (url.includes("groq.com") || m.startsWith("qwen/")) {
    return 3000;
  }
  return MAX_HISTORY_TOKENS;
}

/**
 * Build a structured local context summary without making an LLM API call.
 * Avoids burning tokens or triggering 429 rate limits during compact.
 */
export function buildLocalContextSummary(msgs: Message[]): string {
  const userQueries: string[] = [];
  const referencedItems = new Set<string>();
  const actions: string[] = [];

  for (const m of msgs) {
    if (m.role === "user" && m.content) {
      userQueries.push(m.content.trim().slice(0, 120));
    }
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        const name = tc.function?.name;
        if (name) actions.push(name);
        try {
          const args = JSON.parse(tc.function?.arguments || "{}");
          if (args.path) referencedItems.add(String(args.path));
          if (args.url) referencedItems.add(String(args.url));
        } catch {
          // ignore
        }
      }
    }
  }

  const sections: string[] = [];
  if (userQueries.length > 0) {
    sections.push(`User queries:\n${userQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  }
  if (referencedItems.size > 0) {
    sections.push(`Referenced files/URLs:\n${Array.from(referencedItems).map((item) => `- ${item}`).join("\n")}`);
  }
  if (actions.length > 0) {
    const unique = Array.from(new Set(actions));
    sections.push(`Tools executed: ${unique.join(", ")}`);
  }

  const body = sections.join("\n\n") || "Previous conversation context retained.";
  return `${canonicalSummaryHeader()}\n\n${body}`;
}

/** Trim history to fit within token limits while preserving schema validity and pruning old tool outputs */
/**
 * Make a conversation acceptable to strict providers (a 400 otherwise):
 * every assistant tool call has its result, no result without its call, no
 * empty assistant turns. Returns the fixed list and whether anything changed.
 */
export function repairHistory(msgs: Message[]): { messages: Message[]; changed: boolean } {
  const out: Message[] = [];
  let changed = false;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "tool") {
      // A result must answer a call in the closest assistant message before it
      const prev = [...out].reverse().find((x) => x.role === "assistant");
      if (!prev?.tool_calls?.some((tc: { id?: string }) => tc.id === m.tool_call_id)) {
        changed = true;
        continue;
      }
      out.push(m);
      continue;
    }
    if (m.role === "assistant" && !m.tool_calls?.length && !String(m.content ?? "").trim()) {
      changed = true;
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      out.push(m);
      // Every call needs a result right after it
      const results = new Set<string>();
      for (let j = i + 1; j < msgs.length && msgs[j].role === "tool"; j++) results.add(String(msgs[j].tool_call_id));
      for (const tc of m.tool_calls as { id: string }[]) {
        if (!results.has(tc.id)) {
          changed = true;
          // placed right after the assistant message, before the existing results
          out.push({ role: "tool", tool_call_id: tc.id, content: "(no result was recorded)" });
        }
      }
      continue;
    }
    out.push(m);
  }
  return { messages: out, changed };
}

export function trimHistory(msgs: Message[], maxTokens: number = MAX_HISTORY_TOKENS): Message[] {
  if (msgs.length <= 2) return msgs;

  // Always keep the first message (system context)
  const systemMsg = msgs[0];
  const rest = msgs.slice(1);

  // Group into atomic turns and prune verbose tool outputs from completed past turns
  let turns = prunePastToolResults(groupIntoTurns(rest));

  // Keep dropping oldest turns until under token limit, leaving at least the last turn
  while (turns.length > 1) {
    const flattened = [systemMsg, ...turns.flat()];
    if (estimateTokens(flattened) <= maxTokens) {
      break;
    }
    turns.shift();
  }

  const result = [systemMsg, ...turns.flat()];

  // Final sanity check: ensure no orphaned tool results at the beginning of non-system messages
  let firstNonSystemIdx = 1;
  while (firstNonSystemIdx < result.length && result[firstNonSystemIdx].role === "tool") {
    result.splice(firstNonSystemIdx, 1);
  }

  return result;
}

export class Agent {
  private client: OpenAI;
  private model: string;
  private history: HistoryManager;
  private maxToolCalls: number;
  private output: AgentOutput | null = null;
  /** Background post-turn compaction; abandoned if the user sends a new message first. */
  private pendingCompact: Promise<void> | null = null;
  private compactGen = 0;

  setOutputAdapter(out: AgentOutput): void {
    this.output = out;
  }

  constructor(opts: AgentOptions = {}) {
    this.client = createClient(opts.baseURL, opts.apiKey);
    this.model = opts.model || DEFAULT_MODEL;
    this.maxToolCalls = opts.maxToolCalls || DEFAULT_MAX_TOOL_CALLS;
    this.history = new HistoryManager();
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  updateClient(baseURL: string, apiKey: string): void {
    this.client = createClient(baseURL, apiKey);
  }

  getMaxToolCalls(): number {
    return this.maxToolCalls;
  }

  getHistory(): Message[] {
    return this.history.getAll();
  }

  exportMarkdown(): string {
    return this.history.toMarkdown();
  }

  onLLMResponse(handler: ResponseHandler): void {
    this.history.onResponse(handler);
  }

  /** Plan mode: read-only tools only, and plan-first instructions in the system prompt. */
  setPlanMode(enabled: boolean): void {
    this.history.setPlanMode(enabled);
    this.history.refreshSystemMessage();
  }

  /** Rebuild the system prompt (after learning or forgetting something about the user). */
  refreshSystemPrompt(): void {
    this.history.refreshSystemMessage();
  }

  /** Record a turn that was answered locally (instant commands) so follow-ups have the context. */
  recordLocalExchange(user: string, result: string): void {
    this.history.add({ role: "user", content: user });
    this.history.add({ role: "assistant", content: `Ran locally, no model call:\n${result.slice(0, 12_000)}` });
  }

  historyLength(): number {
    return this.history.getAll().length;
  }

  /** Rewind the conversation to `length` messages and drop any pending compaction. */
  truncateHistory(length: number): void {
    this.compactGen++;
    this.pendingCompact = null;
    this.history.truncate(length);
  }

  async compact(): Promise<string | null> {
    const msgs = this.history.getAll();
    if (msgs.length <= 1) return null;
    const summary = await summarizeHistory(this.client, this.model, msgs);
    if (!summary) return null;
    this.history.resetWithSummary(summary);
    return summary;
  }

  async run(input: string): Promise<void> {
    // Never make the user wait on a background compaction: abandon it
    // (its summary would be stale now) and let a later turn compact again.
    if (this.pendingCompact) {
      this.compactGen++;
      this.pendingCompact = null;
    }
    // Dispatch: the experts for this request get ready now; multi-step work is planned first
    const dispatch = dispatchFor(input, requestBudget(providerIdForBaseURL(this.client.baseURL)));
    this.history.add({ role: "user", content: dispatch?.note ? `${input}\n\n${dispatch.note}` : input });
    if (!process.stdin.isTTY && !this.output) renderUserMessage(input);
    this.output?.onUserMessage?.(input);
    if (dispatch?.team.length) this.output?.onDispatch?.(dispatch.team);
    this.observeUserMessage(input);
    let planned = false;
    let planNudged = false;

    beginTurn(); // Esc stops everything this turn starts
    let toolCallCount = 0;
    let recoveredThisTurn = false;
    let partial = ""; // text streamed so far in the current model call (kept if the user stops)
    let lastToolRun: { sig: string; run: number } | null = null;
    let doomDetected = false;
    // Intent guard: re-check saved requirements once per turn after file changes
    let changedFiles = false;
    let intentsChecked = false;
    // Learning: failed tool calls waiting to see whether a later attempt recovers
    const pendingErrors = new Map<string, string>();
    const toolsUsed: string[] = [];
    const turnStart = Date.now();

    while (true) {
      if (isStopped()) {
        this.finishStopped("", turnStart);
        break;
      }
      // Auto-compact: check if context is getting too large
      const msgs = this.history.getAll();
      const estimatedTokens = estimateTokens(msgs);
      if (estimatedTokens > CONTEXT_WINDOW_WARN_TOKENS) {
        if (!isJsonMode() && !this.output) {
          console.log(`  ${pc.yellow("...")} context window large, summarizing...`);
          try {
            await this.compact();
            console.log(`  ${pc.green("OK")} compacted`);
          } catch {
            console.log(`  ${pc.red("FAIL")} compact failed, continuing`);
          }
        } else {
          try {
            await this.compact();
          } catch {
            // continue anyway
          }
        }
      }

      const useTTY = !isJsonMode() && !this.output && Boolean(process.stdout.isTTY);
      if (useTTY) renderThinking();

      let response: LLMResponse;
      const llmStart = performance.now();
      try {
        // Use streaming for real-time output
        const msgs = trimHistory(this.history.getAll(), getMaxHistoryTokens(this.client.baseURL, this.model));
        if (this.output) {
          response = await callLLMStream(
            this.client,
            this.model,
            msgs,
            (chunk) => {
              partial += chunk;
              this.output?.onAssistantText?.(chunk);
            },
            this.history.isPlanMode() ? getPlanModeToolDefinitions() : undefined,
            { onSwitch: (sw) => this.output?.onModelSwitched?.(sw), hedge: true }
          );
        } else if (process.stdout.isTTY && !isJsonMode()) {
          renderThinkingDone();
          response = await callLLMStream(
            this.client,
            this.model,
            msgs,
            (chunk) => renderStreamChunk(chunk)
          );
        } else {
          response = await callLLMStream(
            this.client,
            this.model,
            msgs,
            () => {} // no-op for non-TTY / JSON mode
          );
        }
      } catch (err) {
        if (isStopped()) {
          this.finishStopped(partial, turnStart);
          break;
        }
        // A 400 is usually a conversation the model can't take (too long for its window, or a
        // malformed history after a stop or a crash): repair it, shorten it, and try once more
        const status = (err as { status?: number }).status;
        if (status === 400 && !recoveredThisTurn && !partial) {
          recoveredThisTurn = true;
          const limit = noteContextLimit(this.model, err);
          const fixed = repairHistory(this.history.getAll());
          if (fixed.changed) this.history.replaceAll(fixed.messages);
          this.output?.onNotice?.(
            limit
              ? `${this.model} takes at most ${limit.toLocaleString()} tokens: XYRO shortened the conversation and retried`
              : `The provider rejected the request (400): XYRO ${fixed.changed ? "repaired the conversation" : "shortened the conversation"} and retried`,
            "info"
          );
          if (!limit && !fixed.changed) learnedContext.set(this.model, Math.max(8000, Math.round(estimateTokens(this.history.getAll()) * 0.6)));
          continue;
        }
        if (this.output?.onError) {
          this.output.onError(describeError(err));
          break;
        }
        throw err;
      }
      partial = "";
      const llmElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);

      this.history.emitResponse(response);
      if (response.actualModel) this.answeredBy = { model: response.actualModel, providerId: response.providerId ?? "" };

      const msg: Message = { role: "assistant", content: response.content || "" };
      if (response.tool_calls.length > 0) {
        msg.tool_calls = response.tool_calls;
      }
      this.history.add(msg);

      if (response.content) {
        if (this.output) {
          // TUI streams chunks live; nothing extra at end of text
        } else if (process.stdout.isTTY && !isJsonMode()) {
          renderStreamEnd(llmElapsed);
        } else {
          // Non-TTY: streaming was a no-op, render the full response now
          renderAssistant(response.content, llmElapsed);
        }
      }

      if (!response.tool_calls || response.tool_calls.length === 0) {
        if (changedFiles && !intentsChecked && listIntents().length) {
          intentsChecked = true;
          const results = await runIntents();
          const broken = results.filter((r) => !r.ok);
          this.output?.onNotice?.(
            broken.length ? `Intent guard: ${broken.length} requirement${broken.length === 1 ? "" : "s"} broke, fixing` : `Intent guard: all ${results.filter((r) => !r.skipped).length} requirements hold`,
            broken.length ? "warn" : "info"
          );
          if (broken.length) {
            this.history.add({
              role: "user",
              content: `[intent guard] Your changes broke requirements I asked for earlier. Fix them while keeping the current request working. Do not weaken or remove the checks.\n\n${formatIntentResults(broken)}`,
            });
            continue;
          }
        }
        this.output?.onAssistantDone?.((Date.now() - turnStart) / 1000);
        // Post-turn rate-limit guard: if history grew large during this turn,
        // compact it so the NEXT request starts lean and avoids TPM limits.
        // Runs in the background (bounded) so the turn ends right away.
        // Count the conversation only — the fixed system prompt is not compactable
        const postTurnTokens = estimateTokens(this.history.getAll().filter((m) => m.role !== "system"));
        if (postTurnTokens > POST_TURN_COMPACT_TOKENS) {
          if (!isJsonMode() && !this.output) {
            console.log(`  ${pc.dim("...")} context grew to ~${postTurnTokens} tokens, compacting in the background...`);
          }
          const gen = ++this.compactGen;
          const snapshot = this.history.getAll();
          const job: Promise<void> = withTimeout(summarizeHistory(this.client, this.model, snapshot), COMPACT_TIMEOUT_MS)
            .then((summary) => {
              // Apply only if nothing happened since (no newer turn, no newer job)
              if (summary && gen === this.compactGen) this.history.resetWithSummary(summary);
            })
            .catch(() => undefined)
            .finally(() => {
              if (this.pendingCompact === job) this.pendingCompact = null;
            });
          this.pendingCompact = job;
        }
        break;
      }

      // Show progress indicator for multiple tool calls
      const totalTools = response.tool_calls.length;
      if (totalTools > 1 && !isJsonMode() && !this.output && process.stdout.isTTY) {
        console.log(`  ${pc.dim("┃")} ${pc.dim(`executing ${totalTools} tool calls...`)}`);
      }

      for (const tc of response.tool_calls) {
        // Stopped mid-way: every remaining call still gets a result, so the conversation stays valid
        if (isStopped()) {
          this.history.add({ role: "tool", tool_call_id: tc.id, content: "⛔ Not run: the user stopped this turn." });
          continue;
        }
        toolCallCount++;
        const name = tc.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          // Malformed arguments from the model: report it instead of crashing the turn
          this.history.add({ role: "tool", tool_call_id: tc.id, content: `❌ Invalid JSON arguments for ${name}. Send valid JSON.` });
          continue;
        }

        // Doom-loop guard: the exact same call repeated back-to-back means the model is stuck
        const track = isRepeatedToolCall(`${name}(${JSON.stringify(args)})`, lastToolRun);
        lastToolRun = track;
        if (track.isDoom) {
          doomDetected = true;
          this.history.add({ role: "tool", tool_call_id: tc.id, content: `⛔ Stopped: ${name} was called with the same arguments ${DOOM_LOOP_THRESHOLD} times in a row. Change approach or explain what is blocking you.` });
          break;
        }

        // Permission gate: mutating/exec tools need user approval
        let allowed = true;
        if (shouldAskPermission(name)) {
          allowed = this.output
            ? this.output.requestPermission
              ? await this.output.requestPermission(describeToolCall(name, args))
              : false
            : (await requestPermission(name, args)) === "allow";
        }

        const start = performance.now();
        const argsSummary = summarizeToolArgs(args);
        if (this.output) {
          this.output.onToolStart?.(name, argsSummary);
        } else {
          renderToolCall(name, args, toolCallCount);
          if (useTTY) renderToolRunning(name);
        }

        const result = allowed ? await executeTool(name, args) : PERMISSION_DENIED_RESULT;
        if (allowed && FILE_CHANGING_TOOLS.has(name) && !result.startsWith("❌")) changedFiles = true;
        toolsUsed.push(name);
        if (!allowed) {
          recordEvent({ kind: "denied", tool: name, detail: argsSummary });
        } else if (result.startsWith("❌") || result.startsWith("⛔")) {
          if (!pendingErrors.has(name)) pendingErrors.set(name, `${result.split("\n")[0].slice(0, 160)} (with: ${argsSummary})`);
        } else if (pendingErrors.has(name)) {
          recordEvent({ kind: "recovered", tool: name, detail: `failed: ${pendingErrors.get(name)} → worked with: ${argsSummary}` });
          pendingErrors.delete(name);
        }
        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
        if (this.output) {
          const failed = result.startsWith("❌") || result.includes("Error");
          this.output.onToolResult?.(name, result.split("\n")[0].slice(0, 70), elapsed, failed);
        } else {
          if (useTTY) renderToolRunningDone();
          renderToolResult(result, elapsed);
        }

        this.history.add({
          role: "tool",
          tool_call_id: tc.id,
          content: truncateToolResult(result),
        });
      }

      if (isStopped()) {
        this.finishStopped("", turnStart);
        break;
      }

      // Plan first: a multi-step request that started without a plan gets one reminder
      if (response.tool_calls.some((tc) => PLANNING_TOOLS.has(tc.function.name))) planned = true;
      if (dispatch?.multiStep && !dispatch.frugal && !planned && !planNudged) {
        planNudged = true;
        this.history.add({ role: "user", content: "[coordinator] Plan before going further: call write_todos with the remaining steps (each with its expert, one in_progress), then continue and delegate the specialised steps." });
      }

      // The model explicitly ended its turn
      if (response.tool_calls.some((tc) => END_TURN_TOOL_NAMES.has(tc.function.name))) {
        this.output?.onAssistantDone?.((Date.now() - turnStart) / 1000);
        break;
      }

      if (doomDetected) {
        const note = `⚠️ Stopped a loop: the same tool call repeated ${DOOM_LOOP_THRESHOLD} times. Tell me how you'd like to proceed.`;
        this.history.add({ role: "assistant", content: note });
        this.output?.onAssistantText?.(note);
        this.output?.onAssistantDone?.((Date.now() - turnStart) / 1000);
        break;
      }

      if (toolCallCount >= this.maxToolCalls) {
        this.history.add({
          role: "assistant",
          content: `⚠️ Reached max tool calls (${this.maxToolCalls}). Stopping.`,
        });
        break;
      }

      // Small pacing delay between multi-step tool iterations to avoid RPM burst rate limits
      await sleep(600);
    }

    for (const [tool, err] of pendingErrors) recordEvent({ kind: "tool_error", tool, detail: err });
    const uniq = [...new Set(toolsUsed)];
    this.lastTurn = { request: input.slice(0, 200), tools: uniq, changedFiles };
    recordEvent({ kind: "turn", detail: `${toolsUsed.length} tool calls (${uniq.slice(0, 8).join(", ") || "none"})${changedFiles ? ", changed files" : ""}, ${Math.round((Date.now() - turnStart) / 1000)}s` });
    if (reflectionDue()) void this.reflect();
  }

  private lastTurn: { request: string; tools: string[]; changedFiles: boolean } | null = null;
  private answeredBy: { model: string; providerId: string } | null = null;

  /** Which model actually answered last (the free-quota pool may have switched). */
  lastAnsweredBy(): { model: string; providerId: string } | null {
    return this.answeredBy;
  }

  /** Esc: stop whatever this turn is doing. Returns false if nothing was running. */
  stop(): boolean {
    return cancelTurn();
  }

  /** Close a stopped turn: keep what was said, mark it stopped, hand control back. */
  private finishStopped(partial: string, turnStart: number): void {
    this.history.add({ role: "assistant", content: `${partial ? `${partial}\n\n` : ""}(stopped by the user)` });
    this.output?.onNotice?.("Stopped. Tell XYRO how to continue.", "warn");
    this.output?.onAssistantDone?.((Date.now() - turnStart) / 1000);
  }
  private reflecting: Promise<string> | null = null;

  /** Learning: what the user asks for, and how they react to the previous turn. */
  private observeUserMessage(input: string): void {
    if (input.startsWith("[intent guard]")) return;
    const reaction = this.lastTurn ? classifyMessage(input) : null;
    if (reaction && this.lastTurn) {
      recordEvent({ kind: reaction, text: input, detail: `previous request: ${this.lastTurn.request} · tools: ${this.lastTurn.tools.join(", ") || "none"}` });
    }
    if (input.trim().length >= 4) {
      let category: string | undefined;
      try {
        category = pickExpert(input).expert.name;
      } catch {
        category = undefined;
      }
      recordEvent({ kind: "request", text: input, category });
    }
  }

  /** The user rewound a turn: strong evidence the approach was wrong. */
  noteRewind(prompt: string): void {
    recordEvent({ kind: "rewind", text: prompt, detail: this.lastTurn ? `tools: ${this.lastTurn.tools.join(", ")}` : undefined });
    this.lastTurn = null;
  }

  /**
   * Reflect on the learning journal with the session's model (through the
   * privacy shield). Runs one at a time; returns a short report.
   */
  reflect(force = false): Promise<string> {
    if (this.reflecting) return this.reflecting;
    const ask = async (system: string, user: string) => {
      const res = await callLLM(this.client, this.model, [{ role: "system", content: system }, { role: "user", content: user }], []);
      return res.content;
    };
    this.reflecting = reflect(ask, { force })
      .then((r) => formatReflection(r))
      .catch((e: unknown) => `Reflection failed: ${e instanceof Error ? e.message : String(e)}`)
      .finally(() => {
        this.reflecting = null;
      });
    return this.reflecting;
  }

  /** Save the conversation as this project's session (.xyro/sessions). */
  save(meta: { provider?: string } = {}): void {
    this.history.save({ model: this.model, ...meta });
  }

  /** Open one of this project's sessions (the latest when no id). */
  load(id?: string): boolean {
    return this.history.load(id);
  }

  /** Start a fresh session; the current one stays in /sessions. */
  newSession(): void {
    this.compactGen++;
    this.pendingCompact = null;
    this.history.newSession();
  }

  /** /skills → Enter: XYRO follows this skill for the rest of the session. */
  useSkill(name: string, use: boolean): void {
    this.history.setSkillInUse(name, use);
  }

  skillsInUse(): string[] {
    return this.history.skillsInUse();
  }

  /** A prompt the user typed (titles the session; up/down in the input walks them). */
  notePrompt(text: string): void {
    this.history.notePrompt(text);
  }

  sessionPrompts(): string[] {
    return this.history.getPrompts();
  }

  sessionId(): string {
    return this.history.currentSessionId();
  }

  /** The conversation so far (to redraw the chat when a session is reopened). */
  messages(): Message[] {
    return this.history.getAll();
  }

  reset(): void {
    this.history.reset();
  }
}
