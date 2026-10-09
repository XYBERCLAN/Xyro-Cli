// Recently Used Models Tracker for XYRO
// Persists the most recently used model ids so the model picker can surface
// them at the top, separated from unused models.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";

const MAX_RECENTS = 5;

function recentsPath(dir?: string): string {
  return join(dir || getConfigDir(), "recents.json");
}

export function getRecentModelIds(dir?: string): string[] {
  try {
    const raw = fs.readFileSync(recentsPath(dir), "utf-8");
    const data = JSON.parse(raw) as { models?: unknown };
    if (!Array.isArray(data?.models)) return [];
    return data.models.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function recordRecentModel(id: string, dir?: string): void {
  const key = (id || "").trim();
  if (!key) return;

  const existing = getRecentModelIds(dir).filter((x) => x !== key);
  existing.unshift(key);
  const trimmed = existing.slice(0, MAX_RECENTS);

  try {
    const target = dir || getConfigDir();
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    fs.writeFileSync(recentsPath(dir), JSON.stringify({ models: trimmed }, null, 2), "utf-8");
  } catch {
    // Best-effort persistence — never crash the picker
  }
}

export function clearRecentModels(dir?: string): void {
  try {
    fs.unlinkSync(recentsPath(dir));
  } catch {
    // ignore
  }
}
