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
    ...(config.providerKeys !== undefined
      ? { providerKeys: { ...existing.providerKeys, ...config.providerKeys } } : {}),
  };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf-8");
}

// ── Per-provider key store ──────────────────────────────────────────────────
// Keys are stored per providerId so switching models/providers never sends
// one provider's key to another provider's endpoint (401 "User not found").

export function saveProviderKey(providerId: string, apiKey: string): void {
  const id = providerId.trim();
  const key = apiKey.trim();
  if (!id || !key) return;
  savePersistedConfig({ providerKeys: { [id]: key } });
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
