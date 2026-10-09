// Free-quota pool — XYRO never stops at a rate limit.
//
// When a model is overloaded, gone, rate-limited or out of quota, the request
// moves on, in this order:
//   1. other free models of the SAME provider (same key, same endpoint)
//   2. a free model on ANOTHER provider you have a key for
// A provider that rate-limits is put on cooldown (from its own retry hint,
// or longer for daily quotas) and skipped until it recovers. Every provider's
// daily requests / tokens / limits are recorded so XYRO learns the real caps.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { getProviderKey } from "../config/persist.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { getAllModels } from "../models/catalog.js";

/** Same-provider backup models (kept in sync with the free tiers we know). */
export const PROVIDER_FALLBACK_MODELS: Record<string, string[]> = {
  google: ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-flash-lite-latest"],
  groq: ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "groq/compound"],
  openrouter: [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-chat:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
  ],
};

export interface Candidate {
  model: string;
  providerId: string;
  /** Present only for a different provider than the caller's client */
  baseURL?: string;
  apiKey?: string;
  sameProvider: boolean;
}

interface ProviderUsage {
  day: string;
  requests: number;
  tokens: number;
  rateLimits: number;
  cooldownUntil: number;
  /** Highest request count seen on a day that ended in a quota error */
  learnedDailyRequests?: number;
  /** Typical time to first streamed token (moving average, ms) */
  ttftMs?: number;
}

const today = () => new Date().toISOString().slice(0, 10);

function usagePath(): string {
  return join(getConfigDir(), "quota.json");
}

let cache: Record<string, ProviderUsage> | null = null;

function load(): Record<string, ProviderUsage> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(usagePath(), "utf-8")) as Record<string, ProviderUsage>;
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(usagePath(), JSON.stringify(cache ?? {}));
  } catch {
    // best effort
  }
}

function usage(providerId: string): ProviderUsage {
  const all = load();
  const u = all[providerId];
  if (!u || u.day !== today()) {
    all[providerId] = { day: today(), requests: 0, tokens: 0, rateLimits: 0, cooldownUntil: u?.cooldownUntil ?? 0, learnedDailyRequests: u?.learnedDailyRequests, ttftMs: u?.ttftMs };
  }
  return all[providerId];
}

/** Provider id from an endpoint URL ("" when unknown). */
export function providerIdForBaseURL(baseURL?: string): string {
  if (!baseURL) return "openai";
  const clean = baseURL.replace(/\/+$/, "");
  const exact = FREE_PROVIDERS.find((p) => clean.startsWith(p.baseURL.replace(/\/+$/, "")));
  if (exact) return exact.id;
  if (baseURL.includes("googleapis.com")) return "google";
  if (baseURL.includes("groq.com")) return "groq";
  if (baseURL.includes("openrouter.ai")) return "openrouter";
  if (baseURL.includes("localhost:11434")) return "local";
  return "";
}

export function isCoolingDown(providerId: string, now = Date.now()): boolean {
  return usage(providerId).cooldownUntil > now;
}

/** Same-provider chain, current model first, no duplicates. */
export function getFallbackChain(baseURL: string | undefined, currentModel: string): string[] {
  const pid = providerIdForBaseURL(baseURL) || "google";
  const fromCatalog = getAllModels()
    .filter((m) => (m.providerId === pid || (pid === "local" && m.providerId === "ollama")) && (m.isFree || m.badge === "LOCAL"))
    .map((m) => m.id);
  const list = [...(PROVIDER_FALLBACK_MODELS[pid] ?? []), ...fromCatalog];
  return [currentModel, ...[...new Set(list)].filter((m) => m !== currentModel)].slice(0, 6);
}

/** Best free model to borrow on another provider. */
function freeModelFor(providerId: string): string | null {
  const p = FREE_PROVIDERS.find((x) => x.id === providerId);
  const free = getAllModels().filter((m) => m.providerId === providerId && m.isFree).map((m) => m.id);
  if (p && free.includes(p.defaultModel)) return p.defaultModel;
  // Prefer coding-oriented free models
  return free.find((id) => /coder|code|qwen|deepseek|llama-3\.3|gemini/i.test(id)) ?? free[0] ?? PROVIDER_FALLBACK_MODELS[providerId]?.[0] ?? null;
}

/**
 * Ordered candidates for one request. Providers on cooldown are skipped
 * (unless nothing else is left). `pool: false` keeps it to one provider.
 */
export function buildCandidates(baseURL: string | undefined, model: string, opts: { pool?: boolean } = {}): Candidate[] {
  const pid = providerIdForBaseURL(baseURL);
  const same: Candidate[] = getFallbackChain(baseURL, model).map((m) => ({ model: m, providerId: pid, sameProvider: true }));
  if (opts.pool === false || process.env.XYRO_NO_POOL) return same;

  const cross: Candidate[] = [];
  for (const p of FREE_PROVIDERS) {
    if (p.id === pid || p.id === "local") continue;
    const key = getProviderKey(p.id);
    if (!key) continue;
    const m = freeModelFor(p.id);
    if (m) cross.push({ model: m, providerId: p.id, baseURL: p.baseURL, apiKey: key, sameProvider: false });
    if (cross.length >= 4) break;
  }
  // Least-used providers first, so load spreads across free quotas
  cross.sort((a, b) => usage(a.providerId).requests - usage(b.providerId).requests);

  const all = [...same, ...cross];
  const ready = all.filter((c) => !isCoolingDown(c.providerId));
  return ready.length ? ready : all;
}

/** Errors worth moving on from (overloaded, missing model, rate limit, quota). */
export function isFallbackableError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const status = (err as { status?: number; response?: { status?: number } })?.status ?? (err as { response?: { status?: number } })?.response?.status;
  return (
    status === 503 ||
    status === 404 ||
    status === 429 ||
    status === 402 ||
    /\b503\b|overloaded|high demand|not_found|no longer available|rate limit|quota exceeded|resource has been exhausted|insufficient credits|too many requests/.test(msg)
  );
}

function isQuotaExhausted(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /quota|exhausted|per day|daily|insufficient credits|limit reached for the day/.test(msg) || (err as { status?: number })?.status === 402;
}

/** Cooldown from a Retry-After / "retry in Ns" hint, else a sensible default. */
function cooldownMs(err: unknown): number {
  const headers = (err as { headers?: Record<string, string> | { get?: (k: string) => string | null } })?.headers;
  const ra = headers && (typeof (headers as { get?: unknown }).get === "function" ? (headers as { get: (k: string) => string | null }).get("retry-after") : (headers as Record<string, string>)["retry-after"]);
  if (ra && !isNaN(Number(ra))) return Math.min(Number(ra) * 1000, 6 * 3600_000);
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(?:retry|try again)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds|m|min|minutes)?/i);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = (m[2] || "s").toLowerCase();
    return Math.min(unit.startsWith("ms") ? n : unit.startsWith("m") && unit !== "ms" ? n * 60_000 : n * 1000, 6 * 3600_000);
  }
  return isQuotaExhausted(err) ? 60 * 60_000 : 60_000;
}

/** Record a rate-limit / quota error and put the provider on cooldown. */
export function noteRateLimit(providerId: string, err: unknown): void {
  if (!providerId) return;
  const u = usage(providerId);
  u.rateLimits++;
  u.cooldownUntil = Date.now() + cooldownMs(err);
  if (isQuotaExhausted(err)) u.learnedDailyRequests = Math.max(u.learnedDailyRequests ?? 0, u.requests);
  save();
}

export function noteSuccess(providerId: string, tokens = 0): void {
  if (!providerId) return;
  const u = usage(providerId);
  u.requests++;
  u.tokens += tokens;
  save();
}

// ─── tournament contestants ─────────────────────────────────────────────────

export interface Contestant {
  model: string;
  providerId: string;
  baseURL?: string;
  apiKey?: string;
}

interface ModelRecord {
  entries: number;
  wins: number;
}

function recordsPath(): string {
  return join(getConfigDir(), "tournaments.json");
}

function loadRecords(): Record<string, ModelRecord> {
  try {
    return JSON.parse(fs.readFileSync(recordsPath(), "utf-8")) as Record<string, ModelRecord>;
  } catch {
    return {};
  }
}

/** Win rate with a prior, so one lucky win doesn't dominate. */
export function winRate(model: string, records = loadRecords()): number {
  const r = records[model];
  return ((r?.wins ?? 0) + 1) / ((r?.entries ?? 0) + 3);
}

export function recordTournament(entrants: string[], winner: string | null): void {
  const all = loadRecords();
  for (const m of entrants) {
    const r = (all[m] ??= { entries: 0, wins: 0 });
    r.entries++;
    if (m === winner) r.wins++;
  }
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(recordsPath(), JSON.stringify(all, null, 2));
  } catch {
    // best effort
  }
}

/**
 * Diverse contestants: the current model first, then free models on OTHER
 * connected providers (different model families make different mistakes),
 * then other free models on the same provider. Past tournament winners are
 * preferred; resting providers are skipped.
 */
export function pickContestants(n: number, current: { baseURL?: string; apiKey?: string; model: string }): Contestant[] {
  const pid = providerIdForBaseURL(current.baseURL);
  const out: Contestant[] = [{ model: current.model, providerId: pid, baseURL: current.baseURL, apiKey: current.apiKey }];
  const records = loadRecords();
  const cross: Contestant[] = [];
  for (const p of FREE_PROVIDERS) {
    if (p.id === pid || p.id === "local" || isCoolingDown(p.id)) continue;
    const key = getProviderKey(p.id);
    const m = key ? freeModelFor(p.id) : null;
    if (m) cross.push({ model: m, providerId: p.id, baseURL: p.baseURL, apiKey: key! });
  }
  cross.sort((a, b) => winRate(b.model, records) - winRate(a.model, records));
  // Same-provider alternatives only when we know which models that endpoint serves
  const same: Contestant[] = (pid ? getFallbackChain(current.baseURL, current.model) : [current.model])
    .slice(1)
    .sort((a, b) => winRate(b, records) - winRate(a, records))
    .map((m) => ({ model: m, providerId: pid, baseURL: current.baseURL, apiKey: current.apiKey }));
  for (const c of [...cross, ...same]) {
    if (out.length >= n) break;
    if (!out.some((o) => o.model === c.model)) out.push(c);
  }
  return out;
}

/** Learn how fast a provider usually starts answering. */
export function noteFirstToken(providerId: string, ms: number): void {
  if (!providerId || !(ms >= 0)) return;
  const u = usage(providerId);
  u.ttftMs = u.ttftMs === undefined ? ms : Math.round(u.ttftMs * 0.8 + ms * 0.2);
  save();
}

/**
 * When to start a backup request: well past this provider's usual first-token
 * time, so hedges only fire on genuinely stuck requests (and spend little quota).
 */
export function hedgeDelayMs(providerId: string): number {
  const env = Number(process.env.XYRO_HEDGE_MS);
  if (env > 0) return env;
  const t = usage(providerId).ttftMs;
  return t === undefined ? 8000 : Math.min(15_000, Math.max(2500, Math.round(t * 2.5)));
}

export interface ProviderCapacity {
  providerId: string;
  name: string;
  connected: boolean;
  requestsToday: number;
  tokensToday: number;
  rateLimitsToday: number;
  coolingForMs: number;
  learnedDailyRequests?: number;
  typicalFirstTokenMs?: number;
}

/** Live view of every free quota you can draw from (for /quota). */
export function poolStatus(): ProviderCapacity[] {
  return FREE_PROVIDERS.filter((p) => p.id !== "local")
    .map((p) => {
      const u = usage(p.id);
      return {
        providerId: p.id,
        name: p.name,
        connected: Boolean(getProviderKey(p.id)),
        requestsToday: u.requests,
        tokensToday: u.tokens,
        rateLimitsToday: u.rateLimits,
        coolingForMs: Math.max(0, u.cooldownUntil - Date.now()),
        learnedDailyRequests: u.learnedDailyRequests,
        typicalFirstTokenMs: u.ttftMs,
      };
    })
    .filter((c) => c.connected || c.requestsToday > 0);
}

/** Test helper. */
export function _resetPool(): void {
  cache = {};
}
