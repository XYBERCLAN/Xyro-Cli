import { Message } from "../agent/types.js";

const PRICE_PER_M_TOKENS: Record<string, [number, number]> = {
  // [input, output] USD per 1M tokens
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "o3-mini": [1.1, 4.4],
};

export interface UsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  apiCalls: number;
  model: string;
}

export class UsageTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private apiCalls = 0;

  track(usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined): void {
    if (!usage) return;
    this.promptTokens += usage.prompt_tokens || 0;
    this.completionTokens += usage.completion_tokens || 0;
    this.apiCalls++;
  }

  snapshot(model: string): UsageSnapshot {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      apiCalls: this.apiCalls,
      model,
    };
  }

  estimatedCost(model: string): number {
    const price = PRICE_PER_M_TOKENS[model];
    if (!price) return 0;
    return (
      (this.promptTokens / 1_000_000) * price[0] +
      (this.completionTokens / 1_000_000) * price[1]
    );
  }
}

export function formatUsage(s: UsageSnapshot, cost: number): string {
  const parts = [
    `model: ${s.model}`,
    `input: ${s.promptTokens.toLocaleString()} tok`,
    `output: ${s.completionTokens.toLocaleString()} tok`,
    `total: ${s.totalTokens.toLocaleString()} tok`,
    `api calls: ${s.apiCalls}`,
  ];
  if (cost > 0) parts.push(`est. cost: $${cost.toFixed(4)}`);
  return parts.join(" · ");
}

export function historyToMarkdown(messages: Message[]): string {
  const out: string[] = ["# XYRO Conversation Export", ""];
  for (const m of messages) {
    if (m.role === "system") continue;
    const who = m.role === "user" ? "## User" : m.role === "assistant" ? "## XYRO" : `## Tool (${m.tool_call_id || ""})`;
    const content = (m.content || "").trim();
    if (content) {
      out.push(who);
      out.push("");
      out.push(content);
      out.push("");
    }
  }
  return out.join("\n");
}
