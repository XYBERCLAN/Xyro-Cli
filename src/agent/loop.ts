import OpenAI from "openai";
import * as p from "@clack/prompts";
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
  renderStreamEnd,
  isJsonMode,
} from "../ui/render.js";

export type ResponseHandler = (usage: unknown) => void;

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
          const spin = p.spinner();
          spin.start("context window getting large, summarizing...");
          try {
            await this.compact();
            spin.stop("compacted");
          } catch {
            spin.stop("compact failed, continuing");
          }
        } else {
          try {
            await this.compact();
          } catch {
            // continue anyway
          }
        }
      }

      const useSpinner = !isJsonMode() && Boolean(process.stdout.isTTY);
      const spin = useSpinner ? p.spinner() : null;
      if (spin) spin.start("thinking...");

      let response: LLMResponse;
      const llmStart = performance.now();
      try {
        // Use streaming for real-time output
        if (process.stdout.isTTY && !isJsonMode()) {
          // Stop spinner silently (no message) to avoid artifacts before streaming
          if (spin) spin.stop("");
          response = await callLLMStream(
            this.client,
            this.model,
            this.history.getAll(),
            (chunk) => renderStreamChunk(chunk)
          );
        } else {
          response = await callLLMStream(
            this.client,
            this.model,
            this.history.getAll(),
            () => {} // no-op for non-TTY / JSON mode
          );
          if (spin) spin.stop("ready");
        }
      } catch (err) {
        if (spin) spin.stop("error");
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

        // Show spinner while tool is executing
        const toolSpin = useSpinner ? p.spinner() : null;
        if (toolSpin) toolSpin.start(`running ${name}...`);

        const result = await executeTool(name, args);
        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
        if (toolSpin) toolSpin.stop(`${name} done`);

        renderToolResult(result, elapsed);

        this.history.add({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
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
