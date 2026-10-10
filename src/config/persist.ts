import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./platform.js";

export interface PersistedConfig {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  /** Per-provider saved API keys — prevents cross-provider 401s on model switch */
  providerKeys?: Record<string, string>;
  /** Language XYRO speaks with the user (code, e.g. "fr") */
  language?: string;
}

function configPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadPersistedConfig(): PersistedConfig {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return {};
    const data = fs.readFileSync(p, "utf-8");
    return JSON.parse(data) as PersistedConfig;
  } catch {
    return {};
  }
}

export function savePersistedConfig(config: PersistedConfig): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = loadPersistedConfig();
  const merged: PersistedConfig = {
    ...existing,
    ...(config.provider !== undefined ? { provider: config.provider } : {}),
    ...(config.model !== undefined ? { model: config.model } : {}),
    ...(config.baseURL !== undefined ? { baseURL: config.baseURL } : {}),
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.language !== undefined ? { language: config.language } : {}),
    ...(config.providerKeys !== undefined
      ? { providerKeys: { ...existing.providerKeys, ...config.providerKeys } } : {}),
  };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf-8");
}

// ── Per-provider key store ──────────────────────────────────────────────────
// Keys are stored per providerId so switching models/providers never sends
// one provider's key to another provider's endpoint (401 "User not found").

const keyListeners: ((providerId: string) => void)[] = [];

/** Hear about a NEW key being saved for a provider (the quota pool forgets that provider's old trouble). */
export function onProviderKeyChanged(fn: (providerId: string) => void): void {
  keyListeners.push(fn);
}

export function saveProviderKey(providerId: string, apiKey: string): void {
  const id = providerId.trim();
  const key = apiKey.trim();
  if (!id || !key) return;
  const changed = getProviderKey(id) !== key;
  savePersistedConfig({ providerKeys: { [id]: key } });
  if (changed) for (const fn of keyListeners) fn(id);
}

export function getProviderKey(providerId: string): string | undefined {
  const keys = loadPersistedConfig().providerKeys;
  return keys?.[providerId.trim()];
}

export function clearPersistedConfig(): void {
  try {
    fs.unlinkSync(configPath());
  } catch {
    // ignore
  }
}

function introMarkerPath(): string {
  return join(getConfigDir(), ".intro-seen");
}

/** True once the first-launch intro animation has played. */
export function hasSeenIntro(): boolean {
  try {
    return fs.existsSync(introMarkerPath());
  } catch {
    return true;
  }
}

export function markIntroSeen(): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(introMarkerPath(), new Date().toISOString() + "\n");
  } catch {
    // Not fatal: the intro may simply play again next launch
  }
}

function onboardedMarkerPath(): string {
  return join(getConfigDir(), ".onboarded");
}

/** True once the first-launch "choose your look" step has been completed. */
export function hasOnboarded(): boolean {
  try {
    return fs.existsSync(onboardedMarkerPath());
  } catch {
    return true;
  }
}

export function markOnboarded(): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(onboardedMarkerPath(), new Date().toISOString() + "\n");
  } catch {
    // Not fatal: the welcome step may simply show again next launch
  }
}
