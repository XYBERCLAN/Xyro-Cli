import OpenAI from "openai";

export type ToolFn = (args: Record<string, unknown>) => Promise<string>;

export interface Tool {
  definition: OpenAI.ChatCompletionTool;
  execute: ToolFn;
}

export type Role = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: Role;
  content: string;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

export interface AgentOptions {
  model?: string;
  baseURL?: string;
  apiKey?: string;
  maxToolCalls?: number;
  workingDir?: string;
}
