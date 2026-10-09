// Live model lists: every provider the user has a key for is asked for ALL of
// its models (free ones are classified by the fetcher). Results are cached on
// disk for a day so the model picker opens instantly; a refresh runs in the
// background and the picker re-renders as providers answer.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { getProviderKey } from "../config/persist.js";
import { FREE_PROVIDERS, Provider } from "../ui/prompts.js";
import { fetchLiveProviderModels, KeyRejectedError, DiscoveredModel } from "./fetcher.js";
import { registerDiscoveredModels, ModelEntry } from "./catalog.js";

export type ProviderLoadState = "idle" | "loading" | "ok" | "offline" | "rejected";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const state = new Map<string, ProviderLoadState>();

interface CacheFile {
  [providerId: string]: { fetchedAt: number; models: ModelEntry[] };
}

function cachePath(): string {
  return join(getConfigDir(), "models-cache.json");
}

function readCache(): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf-8")) as CacheFile;
  } catch {
    return {};
  }
}

function writeCache(cache: CacheFile): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(cache), "utf-8");
  } catch {
    // Best effort — the picker still works from memory
  }
}

/** Catalog uses "ollama" for local models; the provider list calls it "local". */
export function canonicalProviderId(id: string): string {
  return id === "ollama" ? "local" : id;
}

export function providerById(id: string): Provider | undefined {
  const cid = canonicalProviderId(id);
  return FREE_PROVIDERS.find((p) => p.id === cid);
}

/** True when the provider can be used right now (saved key, or local). */
export function isConnected(providerId: string): boolean {
  const cid = canonicalProviderId(providerId);
  return cid === "local" || Boolean(getProviderKey(cid));
}

export function providerLoadState(providerId: string): ProviderLoadState {
  return state.get(canonicalProviderId(providerId)) ?? "idle";
}

function toEntries(p: Provider, models: DiscoveredModel[]): ModelEntry[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    provider: p.name,
    providerId: p.id,
    isFree: m.isFree || m.badge === "LOCAL",
    badge: m.badge,
    desc: m.desc,
    baseURL: p.baseURL,
  }));
}

/** Register every cached model list (instant, no network). */
/** Free models the provider itself listed most recently (newest truth; [] when never fetched). */
export function liveFreeModels(providerId: string): string[] {
  const entry = readCache()[canonicalProviderId(providerId)];
  return (entry?.models ?? []).filter((m) => m.isFree).map((m) => m.id);
}

export function loadCachedModels(): void {
  const cache = readCache();
  for (const [pid, entry] of Object.entries(cache)) {
    if (entry?.models?.length) {
      registerDiscoveredModels(entry.models);
      if (!state.has(pid)) state.set(pid, "ok");
    }
  }
}

/**
 * Fetch the full model list of every connected provider whose cache is stale
 * (or all of them with `force`). Resolves when every provider has answered.
 * `onUpdate` fires after each provider so the UI can re-render progressively.
 */
export async function refreshConnectedProviders(opts: { force?: boolean; onUpdate?: () => void } = {}): Promise<void> {
  const cache = readCache();
  const jobs = FREE_PROVIDERS.filter((p) => p.id !== "local" && getProviderKey(p.id)).map(async (p) => {
    const fresh = cache[p.id] && Date.now() - cache[p.id].fetchedAt < CACHE_TTL_MS;
    if (fresh && !opts.force) return;
    if (state.get(p.id) === "loading") return;
    state.set(p.id, "loading");
    opts.onUpdate?.();
    try {
      const models = await fetchLiveProviderModels(p.baseURL, getProviderKey(p.id)!, p.id, p.models);
      const entries = toEntries(p, models);
      registerDiscoveredModels(entries);
      cache[p.id] = { fetchedAt: Date.now(), models: entries };
      writeCache(cache);
      state.set(p.id, "ok");
    } catch (err) {
      state.set(p.id, err instanceof KeyRejectedError ? "rejected" : "offline");
    }
    opts.onUpdate?.();
  });
  await Promise.all([...jobs, discoverLocal(opts.onUpdate)]);
}

/** Index a running local server (Ollama / vLLM) — quick probe, silent when absent. */
async function discoverLocal(onUpdate?: () => void): Promise<void> {
  const p = FREE_PROVIDERS.find((x) => x.id === "local");
  if (!p || state.get("local") === "loading") return;
  state.set("local", "loading");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`${p.baseURL.replace(/\/$/, "")}/models`, { signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string }[] };
    const ids = (body.data ?? []).map((m) => m.id).concat((body.models ?? []).map((m) => m.name)).filter((x): x is string => Boolean(x));
    const entries: ModelEntry[] = ids.map((id) => ({
      id,
      name: id,
      provider: p.name,
      providerId: "local",
      isFree: true,
      badge: "LOCAL",
      desc: "Running on this machine",
      baseURL: p.baseURL,
    }));
    if (entries.length) registerDiscoveredModels(entries);
    state.set("local", entries.length ? "ok" : "offline");
  } catch {
    state.set("local", "offline");
  } finally {
    clearTimeout(timer);
    onUpdate?.();
  }
}
