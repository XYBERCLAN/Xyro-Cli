import OpenAI from "openai";
import { Message } from "../agent/types.js";
import { getToolDefinitions } from "../tools/registry.js";
import pc from "picocolors";

export interface LLMResponse {
  content: string | null;
  tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  usage?: unknown;
  actualModel?: string;
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
    timeout: 120_000,
    maxRetries: 0,
  };

  if (isOpenRouter(baseURL)) {
    config.defaultHeaders = {
      "HTTP-Referer": "https://wolf-ai.dev",
      "X-Title": "XYRO Coding Agent",
    };
  }

  return new OpenAI(config as any);
}

/** Get safe max_tokens for a given model and provider to respect provider-specific limits */
export function getMaxTokensForModel(client: OpenAI, model: string): number {
  const baseURL = (client as any).baseURL || "";
  // Groq on-demand free-tier models (e.g. qwen/qwen3.8-27b) enforce a strict OTPM (output tokens/min) cap of 1,000.
  // Requesting max_tokens > 1000 causes Groq to fail immediately with 429 "Request too large ... on output tokens per minute (OTPM)".
  if (baseURL.includes("groq.com") || model.toLowerCase().startsWith("qwen/")) {
    return 800;
  }
  return 4096;
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
  if ((err as any)?.name === "APIConnectionTimeoutError") return true;
  const status = (err as any)?.status || (err as any)?.response?.status;
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const cause = (err as any)?.cause?.message || (err as any)?.cause?.code || "";
  const combined = `${msg} ${cause}`.toLowerCase();
  return (
    combined.includes("503") ||
    combined.includes("502") ||
    combined.includes("504") ||
    combined.includes("overloaded") ||
    combined.includes("service unavailable") ||
    combined.includes("timed out") ||
    combined.includes("timeout") ||
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

/** Fallback candidate models per provider for fast failover on 503/429/404 */
export const PROVIDER_FALLBACK_MODELS: Record<string, string[]> = {
  google: [
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-flash-lite-latest",
  ],
  groq: [
    "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b",
    "groq/compound",
  ],
  openrouter: [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-chat:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
  ],
};

/** Get fallback candidate chain starting with current model */
export function getFallbackChain(baseURL: string | undefined, currentModel: string): string[] {
  let providerKey = "google";
  if (baseURL?.includes("groq.com")) providerKey = "groq";
  else if (baseURL?.includes("openrouter.ai")) providerKey = "openrouter";
  else if (baseURL?.includes("googleapis.com")) providerKey = "google";

  const list = PROVIDER_FALLBACK_MODELS[providerKey] || [];
  return [currentModel, ...list.filter((m) => m !== currentModel)];
}

/** Check if an error warrants failing over to a fallback model */
export function isFallbackableError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status || (err as any)?.response?.status;
  const lower = msg.toLowerCase();
  return (
    status === 503 ||
    status === 404 ||
    status === 429 ||
    lower.includes("503") ||
    lower.includes("overloaded") ||
    lower.includes("high demand") ||
    lower.includes("not_found") ||
    lower.includes("no longer available") ||
    lower.includes("rate limit") ||
    lower.includes("quota exceeded") ||
    lower.includes("resource has been exhausted")
  );
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
        // Fast failover for 503 (model overloaded / high demand):
        // Allow at most 1 quick retry (~1.5s) then fail fast so fallback model engages immediately
        const is503 =
          (err as any)?.status === 503 ||
          String(err).includes("503") ||
          String(err).toLowerCase().includes("overloaded") ||
          String(err).toLowerCase().includes("high demand");
        if (is503 && attempt >= 1) {
          throw err;
        }

        const waitMs = extractRetryDelay(err, attempt);
        let reason = "provider API latency / network delay";
        if (isRateLimit) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.toLowerCase().includes("otpm") || msg.toLowerCase().includes("output token")) {
            reason = "Groq output token limit (OTPM)";
          } else {
            reason = "rate limited";
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as any)?.status || (err as any)?.response?.status;
          if (status === 503 || msg.includes("503") || msg.toLowerCase().includes("overloaded")) {
            reason = "model overloaded / server busy (503)";
          } else if (status === 502 || status === 504 || msg.includes("502") || msg.includes("504")) {
            reason = `server error (${status || "50x"})`;
          } else if (msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("timeout")) {
            reason = "request timed out";
          }
        }
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

export async function callLLM(
  client: OpenAI,
  model: string,
  messages: Message[],
  tools?: OpenAI.ChatCompletionTool[],
  onModelSwitched?: (newModel: string, reason: string) => void
): Promise<LLMResponse> {
  const baseURL = (client as any)?.baseURL || "";
  const candidates = getFallbackChain(baseURL, model);
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidateModel = candidates[i];
    try {
      const max_tokens = getMaxTokensForModel(client, candidateModel);
      const toolDefs = tools !== undefined ? (tools.length > 0 ? tools : undefined) : getToolDefinitions();
      const response = await withRetry(() =>
        client.chat.completions.create({
          model: candidateModel,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          ...(toolDefs ? { tools: toolDefs } : {}),
          max_tokens,
        })
      );

      const msg = response.choices[0].message;
      if (candidateModel !== model) {
        onModelSwitched?.(candidateModel, `model ${model} overloaded or unavailable`);
      }
      return {
        content: msg.content,
        tool_calls: msg.tool_calls || [],
        usage: response.usage || null,
        actualModel: candidateModel,
      };
    } catch (err: unknown) {
      lastError = err;
      const hasNext = i + 1 < candidates.length;
      if (hasNext && isFallbackableError(err)) {
        const nextModel = candidates[i + 1];
        const is503 = (err as any)?.status === 503 || String(err).includes("503") || String(err).toLowerCase().includes("overloaded");
        const reason = is503 ? "overloaded (503)" : "unavailable";
        console.log(`  ${pc.cyan("⚡")} ${candidateModel} is ${reason}, switching to fallback: ${pc.bold(nextModel)}...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Streaming LLM call with automatic multi-model failover.
 * Yields content chunks in real time and automatically switches to fallback
 * candidate models if the primary model returns 503/429/404.
 */
export async function callLLMStream(
  client: OpenAI,
  model: string,
  messages: Message[],
  onChunk: StreamChunkHandler,
  tools?: OpenAI.ChatCompletionTool[],
  onModelSwitched?: (newModel: string, reason: string) => void
): Promise<LLMResponse> {
  const baseURL = (client as any)?.baseURL || "";
  const candidates = getFallbackChain(baseURL, model);
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidateModel = candidates[i];
    try {
      const max_tokens = getMaxTokensForModel(client, candidateModel);
      const toolDefs = tools !== undefined ? (tools.length > 0 ? tools : undefined) : getToolDefinitions();
      const stream = await withRetry(() =>
        client.chat.completions.create({
          model: candidateModel,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          ...(toolDefs ? { tools: toolDefs } : {}),
          stream: true,
          max_tokens,
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
                  arguments: tc.function?.arguments || "",
                },
              });
            } else {
              const existing = toolCallsMap.get(idx)!;
              if (tc.function?.arguments) {
                existing.function.arguments += tc.function.arguments;
              }
              if (tc.function?.name) {
                existing.function.name = tc.function.name;
              }
              if (tc.id) {
                existing.id = tc.id;
              }
            }
          }
        }

        // Preserve extra metadata fields (e.g. extra_content with thought_signature for Google AI Studio)
        if ((chunk as any).extra_content) {
          (usage as any) = { ...((usage as any) || {}), extra_content: (chunk as any).extra_content };
        }

        // Usage (only on last chunk)
        if (chunk.usage) {
          usage = chunk.usage;
        }
      }

      if (candidateModel !== model) {
        onModelSwitched?.(candidateModel, `model ${model} overloaded or unavailable`);
      }

      return {
        content: content || null,
        tool_calls: Array.from(toolCallsMap.values()),
        usage,
        actualModel: candidateModel,
      };
    } catch (err: unknown) {
      lastError = err;
      const hasNext = i + 1 < candidates.length;
      if (hasNext && isFallbackableError(err)) {
        const nextModel = candidates[i + 1];
        const is503 =
          (err as any)?.status === 503 ||
          String(err).includes("503") ||
          String(err).toLowerCase().includes("overloaded") ||
          String(err).toLowerCase().includes("high demand");
        const reason = is503 ? "overloaded (503)" : "unavailable";
        console.log(
          `  ${pc.cyan("⚡")} ${candidateModel} is ${reason}, switching to fallback: ${pc.bold(nextModel)}...`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function summarizeHistory(
  client: OpenAI,
  model: string,
  messages: Message[]
): Promise<string | null> {
  const max_tokens = Math.min(800, getMaxTokensForModel(client, model));
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
      max_tokens,
    })
  );

  return response.choices[0].message.content;
}
