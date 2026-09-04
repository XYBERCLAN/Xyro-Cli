import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "./platform.js";

export interface PersistedConfig {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
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
  };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf-8");
}

export function clearPersistedConfig(): void {
  try {
    fs.unlinkSync(configPath());
  } catch {
    // ignore
  }
}
