import OpenAI from "openai";
import * as p from "@clack/prompts";
import { Message, AgentOptions } from "./types.js";
import { HistoryManager } from "./history.js";
import { createClient, callLLM, LLMResponse } from "../providers/llm.js";
import { executeTool } from "../tools/registry.js";
import { DEFAULT_MODEL, DEFAULT_MAX_TOOL_CALLS } from "../config/constants.js";
import { renderAssistant, renderUserMessage, renderToolCall, renderToolResult, isJsonMode } from "../ui/render.js";

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

  async run(input: string): Promise<void> {
    this.history.add({ role: "user", content: input });
    if (!process.stdin.isTTY) renderUserMessage(input);

    let toolCallCount = 0;

    while (true) {
      const useSpinner = !isJsonMode() && Boolean(process.stdout.isTTY);
      const spin = useSpinner ? p.spinner() : null;
      if (spin) spin.start("thinking...");

      let response: LLMResponse;
      try {
        response = await callLLM(this.client, this.model, this.history.getAll());
      } finally {
        if (spin) spin.stop("ready");
      }

      const msg: Message = { role: "assistant", content: response.content || "" };
      if (response.tool_calls.length > 0) {
        msg.tool_calls = response.tool_calls;
      }
      this.history.add(msg);

      if (response.content) {
        renderAssistant(response.content);
      }

      if (!response.tool_calls || response.tool_calls.length === 0) {
        break;
      }

      for (const tc of response.tool_calls) {
        toolCallCount++;
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments);

        const start = performance.now();
        renderToolCall(name, args, toolCallCount);

        const result = await executeTool(name, args);
        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
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
