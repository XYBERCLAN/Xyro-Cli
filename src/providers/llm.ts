import OpenAI from "openai";
import { Message } from "../agent/types.js";
import { getToolDefinitions } from "../tools/registry.js";

export interface LLMResponse {
  content: string | null;
  tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  usage?: unknown;
}

function isOpenRouter(baseURL?: string): boolean {
  return !!baseURL?.includes("openrouter");
}

export function createClient(baseURL?: string, apiKey?: string): OpenAI {
  const config: Record<string, unknown> = {
    baseURL: baseURL || undefined,
    apiKey: apiKey || process.env["OPENAI_API_KEY"],
  };

  if (isOpenRouter(baseURL)) {
    config.defaultHeaders = {
      "HTTP-Referer": "https://wolf-ai.dev",
      "X-Title": "Wolf AI Coding Agent",
    };
  }

  return new OpenAI(config as any);
}

export async function callLLM(
  client: OpenAI,
  model: string,
  messages: Message[]
): Promise<LLMResponse> {
  const response = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: getToolDefinitions(),
  });

  const msg = response.choices[0].message;
  return {
    content: msg.content,
    tool_calls: msg.tool_calls || [],
    usage: response.usage || null,
  };
}

export async function summarizeHistory(
  client: OpenAI,
  model: string,
  messages: Message[]
): Promise<string | null> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `Summarize the following conversation between a user and a coding assistant.
Preserve: tasks completed, files modified, key decisions, and open follow-ups.
Be concise — under 500 words.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          messages.map((m) => ({ role: m.role, content: m.content }))
        ),
      },
    ],
  });

  return response.choices[0].message.content;
}
