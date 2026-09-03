import OpenAI from "openai";
import pc from "picocolors";
import { Message, AgentOptions } from "./types.js";
import { HistoryManager } from "./history.js";
import { createClient, callLLMStream, summarizeHistory, LLMResponse } from "../providers/llm.js";
import { executeTool } from "../tools/registry.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOOL_CALLS, CONTEXT_WINDOW_WARN_TOKENS } from "../config/constants.js";
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
const MAX_TOOL_RESULT_CHARS = 1500;

/** Max estimated tokens for conversation history before trimming (25K = safe for most providers) */
const MAX_HISTORY_TOKENS = 25000;

/** Truncate large tool results to avoid exceeding token limits */
function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  return result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n... (truncated, ${result.length} chars total)`;
}

/** Estimate token count from character count (rough: 1 token ≈ 4 chars) */
function estimateTokens(msgs: Message[]): number {
  let chars = 0;
  for (const m of msgs) {
    chars += (m.content || "").length;
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        chars += (tc.function?.arguments || "").length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

/** Trim history to fit within token limits, keeping the most recent messages */
function trimHistory(msgs: Message[]): Message[] {
  // Always keep the first message (system context)
  if (msgs.length <= 2) return msgs;
  
  let tokens = estimateTokens(msgs);
  if (tokens <= MAX_HISTORY_TOKENS) return msgs;
  
  // Keep first message + trim from the middle
  const first = msgs[0];
  const rest = msgs.slice(1);
  
  // Remove oldest messages until under limit
  while (rest.length > 2 && estimateTokens([first, ...rest]) > MAX_HISTORY_TOKENS) {
    rest.shift();
    // Also remove orphaned tool results after removed assistant messages
    while (rest.length > 0 && rest[0].role === "tool") {
      rest.shift();
    }
  }
  
  return [first, ...rest];
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
    const summary = await summarizeHistory(this.client, this.model, msgs);
    if (!summary) return null;
    this.history.resetWithSummary(summary);
    return summary;
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
        const msgs = trimHistory(this.history.getAll());
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
