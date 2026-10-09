import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { Message } from "../agent/types.js";
import { getToolDefinitions } from "../tools/registry.js";
import pc from "picocolors";

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
  // Only fall back to the OPENAI_API_KEY env var when the endpoint is actually
  // OpenAI (or no baseURL given). Sending an OpenAI key to OpenRouter/Groq/etc.
  // produces 401 "User not found" errors.
  // NOTE: the OpenAI SDK auto-reads OPENAI_API_KEY when apiKey is *undefined*
  // (even if passed explicitly as undefined) — so for foreign endpoints we
  // must pass an empty string to suppress the env fallback.
  const isOpenAIDirect = !baseURL || baseURL.includes("api.openai.com");
  let effectiveKey: string | undefined;
  if (apiKey) {
    effectiveKey = apiKey;
  } else if (isOpenAIDirect) {
    effectiveKey = process.env["OPENAI_API_KEY"];
  } else {
    effectiveKey = ""; // suppress OPENAI_API_KEY env fallback on foreign endpoints
  }

  const config: Record<string, unknown> = {
    baseURL: baseURL || undefined,
    apiKey: effectiveKey,
  };

  if (isOpenRouter(baseURL)) {
    config.defaultHeaders = {
      "HTTP-Referer": "https://wolf-ai.dev",
      "X-Title": "XYRO Coding Agent",
    };
  }

  return new OpenAI(config as any);
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check if an error represents a rate limit or transient quota exhaustion */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof OpenAI.APIError) {
    if (err.status === 429) return true;
    if (err.code === "rate_limit_exceeded" || err.code === "insufficient_quota") return true;
  }
  if (typeof err === "object" && "status" in err && (err as any).status === 429) {
    return true;
  }

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("resource has been exhausted") ||
    lower.includes("resource_exhausted") ||
    lower.includes("too many requests") ||
    lower.includes("quota exceeded") ||
    lower.includes("tpm") ||
    lower.includes("rpm")
  );
}

/** Check if an error represents a transient network issue that warrants a retry */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const cause = (err as any)?.cause?.message || (err as any)?.cause?.code || "";
  const combined = `${msg} ${cause}`.toLowerCase();
  return (
    combined.includes("etimedout") ||
    combined.includes("econnreset") ||
    combined.includes("connection error") ||
    combined.includes("fetch failed") ||
    combined.includes("network error")
  );
}

/** Extract retry-after duration in milliseconds from error headers or message */
export function extractRetryDelay(err: unknown, attempt: number): number {
  // Check headers if available
  const headers = (err as any)?.headers || (err as any)?.response?.headers;
  if (headers) {
    const retryAfter = headers["retry-after"] || headers["Retry-After"];
    if (retryAfter) {
      const parsedSeconds = parseFloat(retryAfter);
      if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
        return Math.min(30000, Math.max(1000, Math.ceil(parsedSeconds * 1000)));
      }
    }
    const retryAfterMs = headers["retry-after-ms"] || headers["Retry-After-Ms"];
    if (retryAfterMs) {
      const parsedMs = parseFloat(retryAfterMs);
      if (!isNaN(parsedMs) && parsedMs > 0) {
        return Math.min(30000, Math.max(1000, Math.ceil(parsedMs)));
      }
    }
  }

  // Check error message for duration patterns like "try again in 12.5s" or "wait 3000ms"
  const msg = err instanceof Error ? err.message : String(err);
  const secMatch = msg.match(/(?:try again in|wait|after)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:s|seconds)/i);
  if (secMatch && secMatch[1]) {
    const sec = parseFloat(secMatch[1]);
    if (!isNaN(sec) && sec > 0) {
      return Math.min(30000, Math.max(1000, Math.ceil(sec * 1000)));
    }
  }

  const msMatch = msg.match(/(?:try again in|wait|after)\s*([0-9]+)\s*ms/i);
  if (msMatch && msMatch[1]) {
    const ms = parseInt(msMatch[1], 10);
    if (!isNaN(ms) && ms > 0) {
      return Math.min(30000, Math.max(1000, ms));
    }
  }

  // Exponential backoff with jitter: 2s, 4s, 8s, 16s + jitter
  const baseMs = 2000 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(25000, baseMs + jitter);
}

/** Retry wrapper for rate-limited and transient API calls */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const isRateLimit = isRateLimitError(err);
      const isNetwork = isTransientNetworkError(err);

      if ((isRateLimit || isNetwork) && attempt < maxRetries) {
        const waitMs = extractRetryDelay(err, attempt);
        const reason = isRateLimit ? "rate limited" : "connection issue";
        console.log(
          `  ${pc.yellow("...")} ${reason}, waiting ${(waitMs / 1000).toFixed(1)}s (retry ${attempt + 1}/${maxRetries})...`
        );
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export function isAnthropicModel(model: string): boolean {
  return model.toLowerCase().startsWith("claude-") || model.toLowerCase().includes("anthropic");
}

async function callAnthropicStream(
  model: string,
  messages: Message[],
  onChunk: StreamChunkHandler,
  apiKey?: string
): Promise<LLMResponse> {
  const anthropic = new Anthropic({
    apiKey: apiKey || process.env["ANTHROPIC_API_KEY"],
  });

  let systemPrompt: string | undefined;
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemPrompt = (systemPrompt ? systemPrompt + "\n\n" : "") + (m.content || "");
    } else if (m.role === "user") {
      anthropicMessages.push({ role: "user", content: m.content || "" });
    } else if (m.role === "assistant") {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) {
        contentBlocks.push({ type: "text", text: m.content });
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          try {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || "{}"),
            });
          } catch {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: {},
            });
          }
        }
      }
      if (contentBlocks.length > 0) {
        anthropicMessages.push({ role: "assistant", content: contentBlocks });
      }
    } else if (m.role === "tool") {
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id || "",
            content: m.content || "",
          },
        ],
      });
    }
  }

  const tools: Anthropic.Tool[] = getToolDefinitions().map((t) => ({
    name: t.function.name,
    description: t.function.description || "",
    input_schema: (t.function.parameters || { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
  }));

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 4096,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages,
    tools,
  });

  let fullContent = "";
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

  stream.on("text", (text: string) => {
    fullContent += text;
    onChunk(text);
  });

  const finalMessage = await withRetry(() => stream.finalMessage());

  for (const block of finalMessage.content) {
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  return {
    content: fullContent || null,
    tool_calls: toolCalls,
    usage: finalMessage.usage,
  };
}

export async function callLLM(
  client: OpenAI,
  model: string,
  messages: Message[]
): Promise<LLMResponse> {
  if (isAnthropicModel(model) && process.env["ANTHROPIC_API_KEY"] && !isOpenRouter(client.baseURL)) {
    return callAnthropicStream(model, messages, () => {});
  }

  const response = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: getToolDefinitions(),
      max_tokens: 4096,
    })
  );

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
 * Optional `toolsOverride` lets sub-agents restrict the tool set.
 */
export async function callLLMStream(
  client: OpenAI,
  model: string,
  messages: Message[],
  onChunk: StreamChunkHandler,
  toolsOverride?: OpenAI.Chat.Completions.ChatCompletionTool[]
): Promise<LLMResponse> {
  if (isAnthropicModel(model) && process.env["ANTHROPIC_API_KEY"] && !isOpenRouter(client.baseURL)) {
    return callAnthropicStream(model, messages, onChunk);
  }

  const stream = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: toolsOverride ?? getToolDefinitions(),
      stream: true,
      max_tokens: 4096,
    })
  );

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
            ...tc,
            id: tc.id || "",
            type: "function" as const,
            function: {
              name: tc.function?.name || "",
              arguments: "",
            },
          } as any);
        }
        const existing = toolCallsMap.get(idx)!;
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name = tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;

        // Preserve extra metadata fields (e.g. extra_content with thought_signature for Google AI Studio)
        for (const [key, val] of Object.entries(tc)) {
          if (key !== "index" && key !== "function" && key !== "id" && key !== "type") {
            (existing as any)[key] = val;
          }
        }
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
  const response = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `Summarize the following conversation between a user and a coding assistant. Preserve: tasks completed, files modified, key decisions, and open follow-ups. Be concise - under 500 words.`,
        },
        {
          role: "user",
          content: JSON.stringify(
            messages.map((m) => ({ role: m.role, content: m.content }))
          ),
        },
      ],
    })
  );

  return response.choices[0].message.content;
}
