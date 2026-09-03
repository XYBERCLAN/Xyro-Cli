import OpenAI from "openai";
import { Message } from "../agent/types.js";
import { getToolDefinitions } from "../tools/registry.js";

export interface LLMResponse {
  content: string | null;
  tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  usage?: unknown;
}

export type StreamChunkHandler = (chunk: string) => void;
export type StreamToolCallHandler = (toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]) => void;

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

/**
 * Streaming LLM call — yields content chunks in real time.
 * Returns the full assembled response when the stream completes.
 */
export async function callLLMStream(
  client: OpenAI,
  model: string,
  messages: Message[],
  onChunk: StreamChunkHandler
): Promise<LLMResponse> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: getToolDefinitions(),
    stream: true,
  });

  let content = "";
  const toolCallsMap = new Map<number, OpenAI.Chat.Completions.ChatCompletionMessageToolCall>();
  let usage: unknown = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Content streaming
    if (delta.content) {
      content += delta.content;
      onChunk(delta.content);
    }

    // Tool call streaming (arguments come in fragments)
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, {
            id: tc.id || "",
            type: "function" as const,
            function: {
              name: tc.function?.name || "",
              arguments: "",
            },
          });
        }
        const existing = toolCallsMap.get(idx)!;
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name = tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }

    // Usage (only on last chunk)
    if (chunk.usage) {
      usage = chunk.usage;
    }
  }

  const toolCalls = Array.from(toolCallsMap.values());

  return {
    content: content || null,
    tool_calls: toolCalls,
    usage,
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
