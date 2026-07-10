import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface PersistedConfig {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

function configDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || path.join(os.homedir(), ".config");
  return path.join(base, "xyro");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
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
  const dir = configDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8");
}

export function clearPersistedConfig(): void {
  try {
    fs.unlinkSync(configPath());
  } catch {
    // ignore
  }
}
