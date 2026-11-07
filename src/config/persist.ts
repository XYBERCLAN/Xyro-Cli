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

function tightenFile(p: string): void {
  try {
    if (process.platform !== "win32" && fs.existsSync(p) && (fs.statSync(p).mode & 0o077) !== 0) fs.chmodSync(p, 0o600);
  } catch {
    // best effort
  }
}

/**
 * Files older versions left readable by every user on the machine (keys,
 * conversations, MCP config): make them private. Runs once at start-up.
 */
export function tightenPrivateFiles(extra: string[] = []): void {
  for (const p of [configPath(), join(getConfigDir(), "mcp.json"), ...extra]) tightenFile(p);
}

function backupPath(): string {
  return configPath() + ".bak";
}

function corruptBackupPath(): string {
  return configPath() + ".corrupt-" + Date.now();
}

/** Read + parse a config file; returns null when missing or unreadable/corrupt. */
function readConfigFile(p: string): PersistedConfig | null {
  try {
    if (!fs.existsSync(p)) return null;
    const data = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as PersistedConfig;
    return null;
  } catch {
    return null;
  }
}

export function loadPersistedConfig(): PersistedConfig {
  const p = configPath();
  const primary = readConfigFile(p);
  if (primary) return primary;
  // Corrupt or unreadable primary: try the last known-good backup before giving up.
  const backup = readConfigFile(backupPath());
  if (backup) {
    // Restore the good copy so subsequent reads/saves see a valid file.
    try {
      fs.copyFileSync(backupPath(), p);
      tightenFile(p);
    } catch {
      // best effort
    }
    return backup;
  }
  // Nothing recoverable: preserve the corrupt bytes for forensics, then treat as empty.
  try {
    if (fs.existsSync(p)) fs.copyFileSync(p, corruptBackupPath());
  } catch {
    // best effort
  }
  return {};
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
  const target = configPath();
  // Keep a last known-good copy before overwriting, but only if the current file parses.
  try {
    if (fs.existsSync(target) && readConfigFile(target)) {
      fs.copyFileSync(target, backupPath());
      tightenFile(backupPath());
    }
  } catch {
    // best effort
  }
  // Atomic write: temp file in the same dir, then rename (POSIX rename is atomic).
  const tmp = target + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { encoding: "utf-8", mode: 0o600 });
    try { fs.fsyncSync(fs.openSync(tmp, "r")); } catch { /* best effort */ }
    tightenFile(tmp);
    fs.renameSync(tmp, target);
    tightenFile(target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
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
