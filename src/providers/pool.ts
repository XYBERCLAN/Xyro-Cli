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
import { getProviderKey, onProviderKeyChanged } from "../config/persist.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { getAllModels } from "../models/catalog.js";
import { liveFreeModels } from "../models/live.js";
import { createHash } from "node:crypto";

/** Same-provider backup models (kept in sync with the free tiers we know). */
export const PROVIDER_FALLBACK_MODELS: Record<string, string[]> = {
  google: ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-flash-lite-latest"],
  groq: ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "groq/compound"],
  // OpenRouter's free line-up changes every few weeks: its live list (models/live) is used instead
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
  /** Fingerprint of a key the provider rejected (a newly saved key is tried again) */
  badKey?: string;
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
    all[providerId] = { day: today(), requests: 0, tokens: 0, rateLimits: 0, cooldownUntil: u?.cooldownUntil ?? 0, learnedDailyRequests: u?.learnedDailyRequests, ttftMs: u?.ttftMs, badKey: u?.badKey };
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
  // What the provider says it serves today comes first; known lists and the catalog after
  const list = [...liveFreeModels(pid), ...(PROVIDER_FALLBACK_MODELS[pid] ?? []), ...fromCatalog];
  return [currentModel, ...[...new Set(list)].filter((m) => m !== currentModel)].slice(0, 6);
}

/** Best free model to borrow on another provider. */
function freeModelFor(providerId: string): string | null {
  const p = FREE_PROVIDERS.find((x) => x.id === providerId);
  const live = liveFreeModels(providerId);
  const free = live.length ? live : getAllModels().filter((m) => m.providerId === providerId && m.isFree).map((m) => m.id);
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
    if (!key || isKeyRejected(p.id, key)) continue;
    const m = freeModelFor(p.id);
    if (m) cross.push({ model: m, providerId: p.id, baseURL: p.baseURL, apiKey: key, sameProvider: false });
    if (cross.length >= 4) break;
  }
  // Least-used providers first, so load spreads across free quotas
  cross.sort((a, b) => usage(a.providerId).requests - usage(b.providerId).requests);

  // The provider the user chose is always tried: first, or after the others while it rests
  const readyCross = cross.filter((c) => !isCoolingDown(c.providerId));
  const ordered = pid && isCoolingDown(pid) ? [...readyCross, ...same] : [...same, ...readyCross];
  return ordered.length ? ordered : [...same, ...cross];
}

const keyPrint = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

/** The provider rejected this exact key (a different, newly saved key is not affected). */
export function isKeyRejected(providerId: string, key: string): boolean {
  const u = load()[providerId];
  return Boolean(u?.badKey && u.badKey === keyPrint(key));
}

/** Remember that a provider rejected a key, so the pool stops trying it until the key changes. */
export function noteRejectedKey(providerId: string, key: string): void {
  if (!providerId || !key) return;
  usage(providerId).badKey = keyPrint(key);
  save();
}

/** 401 / 403, or a 400 that is about the key (Google answers "Please pass a valid API key" with 400). */
export function isAuthError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const msg = String(e?.message ?? err).toLowerCase();
  return e?.status === 401 || e?.status === 403 || (e?.status === 400 && /api key|invalid key|invalid token|unauthori[sz]ed/.test(msg)) || /invalid (api )?key|invalid token|incorrect api key/.test(msg);
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

/** The provider's free allowance for TODAY is used up (not a per-minute rate limit). */
export function isDailyLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)).toLowerCase();
  return /per[- ]?day|daily|free-models-per-day|requests per day|rpd|limit reached for the day|quota exceeded for metric/.test(msg);
}

/** When a provider's daily allowance comes back (OpenRouter: 00:00 UTC; Google: midnight Pacific). */
export function dailyResetAt(providerId: string, now = Date.now()): number {
  if (providerId === "google") {
    // Midnight in America/Los_Angeles, expressed in UTC
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(now));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
    const sinceMidnight = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000;
    return now - sinceMidnight + 24 * 3600_000;
  }
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function inWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

/** Known free daily request allowances (OpenRouter: 50 without credit, 1000 with $10+). */
const KNOWN_DAILY_CAPS: Record<string, number> = { openrouter: 50 };

export interface RequestBudget {
  /** Requests a day, when known */
  cap?: number;
  /** Requests left today, when the cap is known */
  left?: number;
  /** Tight budget: work in as few requests as possible */
  frugal: boolean;
}

/** How many requests this provider is likely to allow for the rest of today. */
export function requestBudget(providerId: string): RequestBudget {
  const u = usage(providerId);
  let cap: number | undefined = u.learnedDailyRequests || KNOWN_DAILY_CAPS[providerId];
  // More successful requests than the known free cap today: this account has a bigger allowance
  if (cap && !u.learnedDailyRequests && u.requests > cap + 10) cap = undefined;
  if (!cap) return { frugal: false };
  return { cap, left: Math.max(0, cap - u.requests), frugal: cap <= 200 };
}

/** One clear message when a provider's free daily allowance is used up. */
export function dailyLimitMessage(providerId: string, err: unknown, now = Date.now()): string {
  const name = FREE_PROVIDERS.find((p) => p.id === providerId)?.name.replace(/\s*\(.*\)$/, "") ?? providerId;
  const reset = dailyResetAt(providerId, now);
  const used = usage(providerId).requests;
  const others = FREE_PROVIDERS.filter((p) => p.id !== providerId && p.id !== "local" && getProviderKey(p.id) && !isKeyRejected(p.id, getProviderKey(p.id)!) && !isCoolingDown(p.id, now));
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const lines = [
    `Your free daily limit on ${name} is used up${used ? ` (${used} requests today)` : ""}.`,
    `It resets in ${inWords(reset - now)} (${new Date(reset).toISOString().slice(11, 16)} UTC).`,
    "Until then you can:",
    ...(others.length ? [`- keep going: XYRO switches to ${others.map((p) => p.name.replace(/\s*\(.*\)$/, "")).join(", ")} automatically`] : ["- connect another free provider with /provider (Google AI Studio and Groq have free keys): XYRO then switches by itself"]),
    ...(providerId === "openrouter" || /credits/.test(msg) ? ["- add $10 of credit on openrouter.ai to raise the free limit to 1000 requests a day"] : []),
    "- or wait for the reset",
  ];
  return lines.join("\n");
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

/** Cooldown for an error, knowing the provider: a used-up DAILY allowance rests until it resets. */
function cooldownFor(providerId: string, err: unknown): number {
  return isDailyLimitError(err) ? Math.max(60_000, dailyResetAt(providerId) - Date.now()) : cooldownMs(err);
}

/** Record a rate-limit / quota error and put the provider on cooldown. */
export function noteRateLimit(providerId: string, err: unknown): void {
  if (!providerId) return;
  const u = usage(providerId);
  u.rateLimits++;
  u.cooldownUntil = Date.now() + cooldownFor(providerId, err);
  if (isQuotaExhausted(err)) u.learnedDailyRequests = Math.max(u.learnedDailyRequests ?? 0, u.requests);
  // "Add 10 credits to unlock 1000 free model requests per day" → this account is on the 50/day tier
  if (/unlock 1000 free model requests/i.test(String((err as { message?: string })?.message ?? err))) u.learnedDailyRequests = KNOWN_DAILY_CAPS.openrouter;
  save();
}

export function noteSuccess(providerId: string, tokens = 0): void {
  if (!providerId) return;
  const u = usage(providerId);
  u.badKey = undefined; // it works now
  u.cooldownUntil = 0; // …so it is not resting any more
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
  // Free tiers count requests: hedge only genuinely stuck requests, never a model that is just thinking
  return t === undefined ? 15_000 : Math.min(30_000, Math.max(12_000, Math.round(t * 3)));
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
/** A borrowed provider failed for another reason (bad request, outage…): leave it alone for a while. */
export function noteBorrowFailure(providerId: string, ms = 10 * 60_000): void {
  if (!providerId) return;
  const u = usage(providerId);
  u.cooldownUntil = Math.max(u.cooldownUntil, Date.now() + ms);
  save();
}

// Switch notices: one per actual change of model, not repeated within a while
const announced = new Map<string, number>();
const ANNOUNCE_EVERY_MS = 10 * 60_000;

export function shouldAnnounceSwitch(key: string, now = Date.now()): boolean {
  const at = announced.get(key);
  if (at !== undefined && now - at < ANNOUNCE_EVERY_MS) return false;
  announced.set(key, now);
  return true;
}

/**
 * A new key (or a new account) starts fresh: the old key's rate limit, rest
 * period and "rejected" mark don't apply to it.
 */
export function resetProviderState(providerId: string): void {
  const u = load()[providerId];
  if (!u) return;
  u.cooldownUntil = 0;
  u.badKey = undefined;
  u.rateLimits = 0;
  save();
}
onProviderKeyChanged(resetProviderState);

// ─── pacing: stay under each provider's per-minute limit ────────────────────

/** Free-tier requests per minute (per key), when known. Learned values replace these. */
const KNOWN_RPM: Record<string, number> = { google: 10, openrouter: 20, groq: 30, cerebras: 30, mistral: 60 };
const sent = new Map<string, number[]>();
const learnedRpm = new Map<string, number>();
const pacingNoticeAt = new Map<string, number>();

function recent(providerId: string, now = Date.now()): number[] {
  const list = (sent.get(providerId) ?? []).filter((t) => now - t < 60_000);
  sent.set(providerId, list);
  return list;
}

export function rpmLimit(providerId: string): number | undefined {
  return learnedRpm.get(providerId) ?? KNOWN_RPM[providerId];
}

/**
 * A per-minute 429 (not a daily one) tells the real limit: what was sent in
 * the last minute was one too many.
 */
export function noteMinuteLimit(providerId: string, err: unknown): void {
  if (isDailyLimitError(err)) return;
  const n = recent(providerId).length;
  if (n >= 2) learnedRpm.set(providerId, Math.max(1, Math.min(n - 1, rpmLimit(providerId) ?? n - 1)));
}

/**
 * Wait until this provider can take another request within its per-minute
 * limit (free tiers 429 a burst of steps or parallel experts). The wait ends
 * early if the user stops the turn.
 */
export async function waitForSlot(providerId: string, report?: (msg: string) => void, signal?: AbortSignal): Promise<void> {
  const limit = rpmLimit(providerId);
  if (!limit || process.env.XYRO_NO_PACING) {
    recent(providerId).push(Date.now());
    return;
  }
  for (;;) {
    const list = recent(providerId);
    if (list.length < limit) {
      list.push(Date.now());
      return;
    }
    const wait = Math.max(250, list[0] + 60_000 - Date.now());
    const last = pacingNoticeAt.get(providerId) ?? 0;
    if (Date.now() - last > 30_000) pacingNoticeAt.set(providerId, Date.now());
    else report = undefined; // one notice per provider per 30s
    report?.(`Pacing: ${FREE_PROVIDERS.find((p) => p.id === providerId)?.name.replace(/\s*\(.*\)$/, "") ?? providerId} allows about ${limit} requests a minute on the free tier, waiting ${Math.ceil(wait / 1000)}s`);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, wait);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
    if (signal?.aborted) return;
  }
}

export function _resetPool(): void {
  sent.clear();
  learnedRpm.clear();
  pacingNoticeAt.clear();
  cache = {};
  announced.clear();
}
