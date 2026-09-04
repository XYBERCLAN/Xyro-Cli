import OpenAI from "openai";
import pc from "picocolors";
import { Message, AgentOptions } from "./types.js";
import { HistoryManager } from "./history.js";
import { createClient, callLLMStream, summarizeHistory, LLMResponse } from "../providers/llm.js";
import { executeTool } from "../tools/registry.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOOL_CALLS, CONTEXT_WINDOW_WARN_TOKENS, POST_TURN_COMPACT_TOKENS } from "../config/constants.js";
import { savePersistedConfig } from "../config/persist.js";
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
export function getMaxHistoryTokens(baseURL?: string, model?: string): number {
  const url = baseURL || "";
  const m = (model || "").toLowerCase();
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

  return sections.join("\n\n") || "Previous conversation context retained.";
}

/** Trim history to fit within token limits while preserving schema validity and pruning old tool outputs */
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

  async compact(): Promise<string | null> {
    const msgs = this.history.getAll();
    if (msgs.length <= 1) return null;

    const baseURL = (this.client as any)?.baseURL || "";
    const isGroq = baseURL.includes("groq.com") || this.model.toLowerCase().startsWith("qwen/");

    // On Groq or strict rate-limited providers, use fast local summary to prevent 429
    if (isGroq) {
      const summary = buildLocalContextSummary(msgs);
      this.history.resetWithSummary(summary);
      return summary;
    }

    try {
      const summary = await summarizeHistory(this.client, this.model, msgs);
      if (summary) {
        this.history.resetWithSummary(summary);
        return summary;
      }
    } catch {
      // Fall back to zero-cost local summary if API call fails
      const summary = buildLocalContextSummary(msgs);
      this.history.resetWithSummary(summary);
      return summary;
    }
    return null;
  }

  async run(input: string): Promise<void> {
    this.history.add({ role: "user", content: input });
    if (!process.stdin.isTTY) renderUserMessage(input);

    let toolCallCount = 0;

    while (true) {
      // Auto-compact: check if context is getting too large
      const msgs = this.history.getAll();
      const estimatedTokens = estimateTokens(msgs);
      if (estimatedTokens > CONTEXT_WINDOW_WARN_TOKENS) {
        if (!isJsonMode()) {
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

      const useTTY = !isJsonMode() && Boolean(process.stdout.isTTY);
      if (useTTY) renderThinking();

      let response: LLMResponse;
      const llmStart = performance.now();
      try {
        // Use streaming for real-time output
        const maxHistory = getMaxHistoryTokens((this.client as any)?.baseURL, this.model);
        const msgs = trimHistory(this.history.getAll(), maxHistory);
        if (process.stdout.isTTY && !isJsonMode()) {
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
        throw err;
      }
      const llmElapsed = ((performance.now() - llmStart) / 1000).toFixed(1);

      if (response.actualModel && response.actualModel !== this.model) {
        this.model = response.actualModel;
        try {
          savePersistedConfig({ model: this.model });
        } catch {
          // ignore
        }
      }

      this.history.emitResponse(response);

      const msg: Message = { role: "assistant", content: response.content || "" };
      if (response.tool_calls.length > 0) {
        msg.tool_calls = response.tool_calls;
      }
      this.history.add(msg);

      if (response.content) {
        if (process.stdout.isTTY && !isJsonMode()) {
          renderStreamEnd(llmElapsed);
        } else {
          // Non-TTY: streaming was a no-op, render the full response now
          renderAssistant(response.content, llmElapsed);
        }
      }

      if (!response.tool_calls || response.tool_calls.length === 0) {
        // Post-turn rate-limit guard: if history grew large during this turn,
        // compact it now so the NEXT request starts lean and avoids TPM limits.
        const postTurnTokens = estimateTokens(this.history.getAll());
        if (postTurnTokens > POST_TURN_COMPACT_TOKENS) {
          if (!isJsonMode()) {
            console.log(`  ${pc.dim("...")} context grew to ~${postTurnTokens} tokens, compacting to avoid rate limits...`);
          }
          try {
            await this.compact();
            if (!isJsonMode()) {
              console.log(`  ${pc.green("OK")} context compacted — next turn starts fresh`);
            }
          } catch {
            // non-critical: compact failed, continue without it
          }
        }
        break;
      }

      // Show progress indicator for multiple tool calls
      const totalTools = response.tool_calls.length;
      if (totalTools > 1 && !isJsonMode() && process.stdout.isTTY) {
        console.log(`  ${pc.dim("┃")} ${pc.dim(`executing ${totalTools} tool calls...`)}`);
      }

      for (const tc of response.tool_calls) {
        toolCallCount++;
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments);

        const start = performance.now();
        renderToolCall(name, args, toolCallCount);

        // Show running indicator
        if (useTTY) renderToolRunning(name);

        const result = await executeTool(name, args);
        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
        if (useTTY) renderToolRunningDone();

        renderToolResult(result, elapsed);

        this.history.add({
          role: "tool",
          tool_call_id: tc.id,
          content: truncateToolResult(result),
        });
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
  }

  save(): void {
    this.history.save();
  }

  load(): boolean {
    return this.history.load();
  }

  reset(): void {
    this.history.reset();
  }
}
