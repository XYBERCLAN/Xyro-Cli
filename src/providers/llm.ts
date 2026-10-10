import { FREE_PROVIDERS } from "../ui/prompts.js";
import { turnSignal, StoppedByUser, isStopped } from "../agent/cancel.js";
import type { Candidate } from "./pool.js";
import { shouldShield, redactMessages, restoreResponse, restoreText, restoringStream } from "./privacy.js";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { buildCandidates, isFallbackableError, isAuthError, noteRejectedKey, noteBorrowFailure, shouldAnnounceSwitch, waitForSlot, noteMinuteLimit, noteRateLimit, noteSuccess, noteFirstToken, hedgeDelayMs, providerIdForBaseURL } from "./pool.js";
export { getFallbackChain, isFallbackableError } from "./pool.js";
import { Message } from "../agent/types.js";
import { getToolDefinitions } from "../tools/registry.js";
import pc from "picocolors";

export interface LLMResponse {
  content: string | null;
  tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  usage?: unknown;
  /** Model that actually answered (differs after a failover) */
  actualModel?: string;
  /** Provider that actually answered */
  providerId?: string;
}

export interface ModelSwitch {
  from: string;
  to: string;
  toProvider: string;
  crossProvider: boolean;
  reason: string;
}

/** Where retry notices go (the TUI replaces the console default so it never draws over the screen). */
let retryReporter: (msg: string) => void = (msg) => console.log(`  ${pc.yellow("...")} ${msg}`);
export function setRetryReporter(fn: (msg: string) => void): void {
  retryReporter = fn;
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

/** Retry wrapper for rate-limited and transient API calls */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, opts: { retryRateLimit?: boolean } = {}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      // The user pressed Esc: never retry, never wait
      if (turnSignal().aborted) throw new StoppedByUser();
      lastError = err;
      const isRateLimit = isRateLimitError(err);
      const isNetwork = isTransientNetworkError(err);

      // With the free-quota pool, a rate limit is better handled by switching provider
      const retryable = isNetwork || (isRateLimit && opts.retryRateLimit !== false);
      if (retryable && attempt < maxRetries) {
        const waitMs = extractRetryDelay(err, attempt);
        const reason = isRateLimit ? "rate limited" : "connection issue";
        retryReporter(`${reason}, waiting ${(waitMs / 1000).toFixed(1)}s (retry ${attempt + 1}/${maxRetries})...`);
        await stoppableSleep(waitMs);
        if (turnSignal().aborted) throw new StoppedByUser();
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/** A wait that ends early when the user stops the turn. */
function stoppableSleep(ms: number): Promise<void> {
  const signal = turnSignal();
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
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
  messages: Message[],
  tools?: OpenAI.ChatCompletionTool[],
  onModelSwitched?: (newModel: string, reason: string) => void
): Promise<LLMResponse> {
  if (isAnthropicModel(model) && process.env["ANTHROPIC_API_KEY"] && !isOpenRouter(client.baseURL)) {
    return shieldedAnthropic(model, messages, () => {});
  }
  const toolDefs = tools ?? getToolDefinitions();
  const candidates = buildCandidates(client.baseURL, model);
  let lastError: unknown;
  let sessionError: unknown;
  const skip = new Set<string>();
  const limited = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (skip.has(c.providerId)) continue;
    const cl = c.sameProvider ? client : createClient(c.baseURL, c.apiKey);
    const shield = shouldShield(cl.baseURL);
    const sendMsgs = shield ? redactMessages(messages, c.providerId) : messages;
    try {
      const response = await withRetry(
        () =>
          cl.chat.completions.create({
            model: c.model,
            messages: sendMsgs as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            ...(toolDefs.length ? { tools: toolDefs } : {}),
            max_tokens: 4096,
          }),
        4,
        { retryRateLimit: i === candidates.length - 1 }
      );
      const msg = response.choices[0].message;
      noteSuccess(c.providerId, response.usage?.total_tokens ?? 0);
      if (c.model !== model || !c.sameProvider) onModelSwitched?.(c.model, `${model} unavailable`);
      const out = { content: msg.content, tool_calls: msg.tool_calls || [], usage: response.usage || null, actualModel: c.model, providerId: c.providerId };
      return shield ? restoreResponse(out) : out;
    } catch (err: unknown) {
      if (turnSignal().aborted) throw new StoppedByUser();
      lastError = tagProvider(err, c.providerId);
      if (c.sameProvider) sessionError = err;
      if (isRateLimitError(err)) {
        noteMinuteLimit(c.providerId, err);
        noteRateLimit(c.providerId, err);
        // Limits per key: leave the provider. Per model (Gemini, Groq): try a few other models, not all of them
        limited.set(c.providerId, (limited.get(c.providerId) ?? 0) + 1);
        if (!PER_MODEL_LIMITS.has(c.providerId) || (limited.get(c.providerId) ?? 0) >= PER_MODEL_TRIES) skip.add(c.providerId);
      }
      // Another provider rejected its saved key: skip it (until the key changes) and keep going
      if (!c.sameProvider && isAuthError(err)) {
        noteRejectedKey(c.providerId, c.apiKey ?? "");
        skip.add(c.providerId);
        retryReporter(`${providerLabel(c.providerId)} rejected its saved API key, so XYRO skips it. Update it with /provider.`);
        if (candidates.slice(i + 1).some((x) => !skip.has(x.providerId))) continue;
        throw sessionError ?? err;
      }
      // Any other failure of a borrowed provider never ends the chain: move on to the next one
      if (!c.sameProvider && !isStopped()) {
        skip.add(c.providerId);
        if (candidates.slice(i + 1).some((x) => !skip.has(x.providerId))) continue;
      }
      if (candidates.slice(i + 1).some((x) => !skip.has(x.providerId)) && isFallbackableError(err)) continue;
      throw sessionError ?? err;
    }
  }
  // Everything failed: the user's own provider's error is the one that explains it
  throw sessionError ?? lastError;
}

/**
 * Streaming LLM call — yields content chunks in real time.
 * Returns the full assembled response when the stream completes.
 * Optional `toolsOverride` lets sub-agents restrict the tool set.
 */
/**
 * Streaming call with the free-quota pool: on overload / missing model /
 * rate limit / quota, move to the next candidate (same provider first, then
 * other connected providers). Failover only happens before any text was
 * shown, so an answer is never duplicated.
 */
export async function callLLMStream(
  client: OpenAI,
  model: string,
  messages: Message[],
  onChunk: StreamChunkHandler,
  toolsOverride?: OpenAI.Chat.Completions.ChatCompletionTool[],
  opts: { onSwitch?: (s: ModelSwitch) => void; pool?: boolean; hedge?: boolean } = {}
): Promise<LLMResponse> {
  if (isAnthropicModel(model) && process.env["ANTHROPIC_API_KEY"] && !isOpenRouter(client.baseURL)) {
    return shieldedAnthropic(model, messages, onChunk);
  }
  const candidates = buildCandidates(client.baseURL, model, { pool: opts.pool });
  let lastError: unknown;
  let sessionError: unknown;
  let firstError: unknown;
  const skip = new Set<string>();
  const limited = new Map<string, number>();
  // Tell the user once, after the fact, when a different model actually answered
  const announce = (winner: Candidate, reason?: string) => {
    if (winner.sameProvider && winner.model === model) return;
    const why = reason ?? describeFailure(firstError);
    if (!shouldAnnounceSwitch(`${model}|${winner.providerId}|${winner.model}|${why}`)) return;
    opts.onSwitch?.({ from: model, to: winner.model, toProvider: winner.providerId, crossProvider: !winner.sameProvider, reason: why });
  };
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (skip.has(c.providerId)) continue;
    const cl = c.sameProvider ? client : createClient(c.baseURL, c.apiKey);
    let emitted = false;
    try {
      const isLast = i === candidates.length - 1;
      const emit = (chunk: string) => {
        emitted = true;
        onChunk(chunk);
      };
      // Hedge the first request: if it is slow to start, race a backup on another provider
      const backup = i === 0 && opts.hedge && hedgingEnabled() ? candidates.find((x, k) => k > 0 && x.providerId !== c.providerId && !skip.has(x.providerId)) : undefined;
      if (backup) {
        const bcl = backup.sameProvider ? client : createClient(backup.baseURL, backup.apiKey);
        const raced = await hedgedAttempt(
          { run: (e, ctl) => attempt(cl, c, messages, e, toolsOverride, isLast, ctl), providerId: c.providerId },
          { run: (e, ctl) => attempt(bcl, backup, messages, e, toolsOverride, false, ctl), providerId: backup.providerId },
          hedgeDelayMs(c.providerId),
          emit
        );
        const winner = raced.winner === 0 ? c : backup;
        announce(winner, raced.winner === 1 ? "slow to respond" : undefined);
        const u = raced.res.usage as { total_tokens?: number } | null | undefined;
        noteSuccess(winner.providerId, u?.total_tokens ?? 0);
        if (raced.backupStarted) noteSuccess((raced.winner === 0 ? backup : c).providerId, 0);
        return { ...raced.res, actualModel: winner.model, providerId: winner.providerId };
      }
      const res = await attempt(cl, c, messages, emit, toolsOverride, isLast, {
        onFirstEvent: (ms) => noteFirstToken(c.providerId, ms),
      });
      const u = res.usage as { total_tokens?: number } | null | undefined;
      noteSuccess(c.providerId, u?.total_tokens ?? 0);
      announce(c);
      return { ...res, actualModel: c.model, providerId: c.providerId };
    } catch (err: unknown) {
      if (turnSignal().aborted) throw new StoppedByUser();
      lastError = tagProvider(err, c.providerId);
      firstError ??= err;
      if (c.sameProvider) sessionError = err;
      if (isRateLimitError(err)) {
        noteMinuteLimit(c.providerId, err);
        noteRateLimit(c.providerId, err);
        // Limits per key: leave the provider. Per model (Gemini, Groq): try a few other models, not all of them
        limited.set(c.providerId, (limited.get(c.providerId) ?? 0) + 1);
        if (!PER_MODEL_LIMITS.has(c.providerId) || (limited.get(c.providerId) ?? 0) >= PER_MODEL_TRIES) skip.add(c.providerId);
      }
      // Another provider rejected its saved key: skip it (until the key changes) and keep going
      if (!c.sameProvider && isAuthError(err)) {
        noteRejectedKey(c.providerId, c.apiKey ?? "");
        skip.add(c.providerId);
        retryReporter(`${providerLabel(c.providerId)} rejected its saved API key, so XYRO skips it. Update it with /provider.`);
        if (candidates.slice(i + 1).some((x) => !skip.has(x.providerId))) continue;
        throw sessionError ?? err;
      }
      // Any other failure of a borrowed provider never ends the chain: move on, and rest it a while
      if (!c.sameProvider && !isStopped()) {
        skip.add(c.providerId);
        if (!isRateLimitError(err)) noteBorrowFailure(c.providerId);
        if (candidates.slice(i + 1).some((x) => !skip.has(x.providerId))) continue;
      }
      if (!emitted && candidates.slice(i + 1).some((x) => !skip.has(x.providerId)) && isFallbackableError(err)) continue;
      throw emitted ? err : sessionError ?? err;
    }
  }
  // Everything failed: the user's own provider's error is the one that explains it
  throw sessionError ?? lastError;
}

interface AttemptControl {
  signal?: AbortSignal;
  /** First streamed event (text or tool call) arrived after `ms` */
  onFirstEvent?: (ms: number) => void;
}

/** One request to one candidate, through the privacy shield. */
async function attempt(
  cl: OpenAI,
  c: Candidate,
  messages: Message[],
  emit: StreamChunkHandler,
  toolsOverride: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  retryRateLimit: boolean,
  ctl: AttemptControl
): Promise<LLMResponse> {
  // Stay under the provider's per-minute limit (bursts of steps or parallel experts 429 free tiers)
  await waitForSlot(c.providerId, retryReporter, turnSignal());
  if (turnSignal().aborted) throw new StoppedByUser();
  // Privacy shield: the provider sees placeholders, the user sees real values
  const shield = shouldShield(cl.baseURL);
  const restorer = shield ? restoringStream(emit) : null;
  const sendMsgs = shield ? redactMessages(messages, c.providerId) : messages;
  const res = await streamOnce(cl, c.model, sendMsgs, restorer ? (chunk) => restorer.push(chunk) : emit, toolsOverride, retryRateLimit, ctl);
  if (!restorer) return res;
  restorer.flush();
  return restoreResponse(res);
}

export function hedgingEnabled(): boolean {
  return !/^(off|0|false|no)$/i.test(process.env.XYRO_HEDGE ?? "");
}

type Racer = { run: (emit: StreamChunkHandler, ctl: AttemptControl) => Promise<LLMResponse>; providerId: string };

/**
 * Tail-latency hedge. Free tiers queue requests unpredictably, so a request
 * that hasn't started streaming within ~2.5x the provider's usual delay is
 * raced against a backup on ANOTHER provider (a different queue). The first
 * to stream anything wins; the other is aborted. Output is never mixed: only
 * the winner's chunks reach the screen. Errors before anything streamed are
 * thrown as usual so normal failover applies.
 */
export function hedgedAttempt(
  primary: Racer,
  backup: Racer,
  delayMs: number,
  emit: StreamChunkHandler
): Promise<{ res: LLMResponse; winner: 0 | 1; backupStarted: boolean }> {
  return new Promise((resolve, reject) => {
    const racers = [primary, backup];
    const ctls = [new AbortController(), new AbortController()];
    const errors: unknown[] = [undefined, undefined];
    const running = [false, false];
    let winner: 0 | 1 | null = null;
    let done = false;
    let backupStarted = false;
    let timer: NodeJS.Timeout | undefined;

    const claim = (i: 0 | 1) => {
      if (winner !== null) return;
      winner = i;
      if (timer) clearTimeout(timer);
      const other = (1 - i) as 0 | 1;
      if (running[other]) ctls[other].abort();
    };
    const start = (i: 0 | 1) => {
      running[i] = true;
      if (i === 1) backupStarted = true;
      racers[i]
        .run((chunk) => {
          claim(i);
          if (winner === i) emit(chunk);
        }, {
          signal: ctls[i].signal,
          onFirstEvent: (ms) => {
            noteFirstToken(racers[i].providerId, ms);
            claim(i);
          },
        })
        .then((res) => {
          running[i] = false;
          claim(i);
          if (winner === i && !done) {
            done = true;
            resolve({ res, winner: i, backupStarted });
          }
        })
        .catch((err: unknown) => {
          running[i] = false;
          errors[i] = err;
          if (done) return;
          if (winner === i) {
            done = true;
            return reject(err);
          }
          if (winner !== null) return; // the loser was aborted
          if (i === 1 && isRateLimitError(err)) noteRateLimit(racers[1].providerId, err);
          // Nothing streamed yet: wait for the other racer if it is still going
          if (running[(1 - i) as 0 | 1]) return;
          // Primary failed before the hedge fired: normal failover takes it from here
          if (timer) clearTimeout(timer);
          done = true;
          reject(errors[0] ?? err);
        });
    };
    start(0);
    timer = setTimeout(() => {
      if (winner === null && !done) start(1);
    }, delayMs);
  });
}

/**
 * Never show an empty error: some failures (dropped connections, aborted
 * streams, bare HTTP errors) carry no message at all.
 */
export function describeError(err: unknown): string {
  const e = err as { message?: string; status?: number; name?: string; code?: string; cause?: { message?: string; code?: string }; xyroProvider?: string };
  const where = e?.xyroProvider ? `${providerLabel(e.xyroProvider)}: ` : "";
  const text = String(e?.message ?? (typeof err === "string" ? err : "")).trim();
  const cause = e?.cause?.message || e?.cause?.code || e?.code || "";
  if (text && !/^\d{3}( status code)?( \(no body\))?$/i.test(text)) return `${where}${text}${cause && !text.includes(cause) ? ` (${cause})` : ""}`;
  if (e?.status) {
    const meaning: Record<number, string> = { 400: "the request was rejected (often a bad key or an unsupported model)", 401: "the API key was rejected", 403: "access denied for this key", 404: "model or endpoint not found", 408: "the request timed out", 413: "the conversation is too long for this model", 429: "rate limit or quota reached", 500: "the provider had an internal error", 502: "the provider is unreachable (bad gateway)", 503: "the provider is overloaded or down", 504: "the provider timed out" };
    return `${where}HTTP ${e.status}: ${meaning[e.status] ?? "request failed"}${cause ? ` (${cause})` : ""}`;
  }
  if (cause) return `${where}connection problem: ${cause}`;
  return `${where}${e?.name && e.name !== "Error" ? e.name : "the request failed"} with no details from the provider. Check your connection, or try another model with /model.`;
}

/** Remember which provider an error came from (the UI names it, and asks for the right key). */
function tagProvider(err: unknown, providerId: string): unknown {
  if (err && typeof err === "object" && !("xyroProvider" in err)) (err as { xyroProvider?: string }).xyroProvider = providerId;
  return err;
}

export function providerLabel(providerId: string): string {
  return FREE_PROVIDERS.find((p) => p.id === providerId)?.name.replace(/\s*\(.*\)$/, "") ?? providerId;
}

/** Providers whose rate limits are per model (others limit per key: skip them entirely). */
const PER_MODEL_LIMITS = new Set(["groq", "google"]);
/** Models tried on a per-model-limit provider before moving on (each failed try is a request). */
const PER_MODEL_TRIES = 3;

function describeFailure(err: unknown): string {
  if (!err) return "resting after a rate limit";
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/quota|exhausted|per day|daily|insufficient credits/.test(msg)) return "free quota used up";
  if (isRateLimitError(err)) return "rate limited";
  if (/503|overloaded|high demand/.test(msg)) return "overloaded";
  if (/404|not_found|no longer available/.test(msg)) return "model unavailable";
  return "unavailable";
}

/** One streaming attempt against one model. */
async function streamOnce(
  client: OpenAI,
  model: string,
  messages: Message[],
  onChunk: StreamChunkHandler,
  toolsOverride: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  retryRateLimit: boolean,
  ctl: AttemptControl = {}
): Promise<LLMResponse> {

  // An explicit empty list means "no tools" (some providers reject `tools: []`)
  const tools = toolsOverride ?? getToolDefinitions();
  const started = Date.now();
  // Stop when the user presses Esc, or when another hedged request won
  const signal = ctl.signal ? AbortSignal.any([ctl.signal, turnSignal()]) : turnSignal();
  const stream = await withRetry(
    () => {
      if (turnSignal().aborted) throw new StoppedByUser();
      if (ctl.signal?.aborted) throw new Error("aborted: another provider answered first");
      return client.chat.completions.create(
        {
          model,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          ...(tools.length ? { tools } : {}),
          stream: true,
          max_tokens: 4096,
        },
        { signal }
      );
    },
    4,
    { retryRateLimit }
  );
  let firstEvent = true;

  let content = "";
  const toolCallsMap = new Map<number, OpenAI.Chat.Completions.ChatCompletionMessageToolCall>();
  let usage: unknown = null;

  for await (const chunk of stream) {
    // Usage often arrives in a final chunk with no choices — read it first
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (firstEvent) {
      firstEvent = false;
      ctl.onFirstEvent?.(Date.now() - started);
    }

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

  }

  // An aborted stream can end quietly: it is a stop, not a complete answer
  if (turnSignal().aborted) throw new StoppedByUser();
  if (ctl.signal?.aborted) throw new Error("aborted: another provider answered first");

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
            (shouldShield(client.baseURL) ? redactMessages(messages, providerIdForBaseURL(client.baseURL)) : messages).map((m) => ({ role: m.role, content: m.content }))
          ),
        },
      ],
    })
  );

  return restoreText(response.choices[0].message.content);
}

/** Direct Anthropic calls go through the same shield. */
async function shieldedAnthropic(model: string, messages: Message[], onChunk: StreamChunkHandler): Promise<LLMResponse> {
  if (!shouldShield(undefined)) return callAnthropicStream(model, messages, onChunk);
  const restorer = restoringStream(onChunk);
  const res = await callAnthropicStream(model, redactMessages(messages, "anthropic"), (c) => restorer.push(c));
  restorer.flush();
  return restoreResponse(res);
}
