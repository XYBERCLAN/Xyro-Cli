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

// ── Usage counts (powers "Most used" in the model picker) ────────────────────

export interface ModelUsage {
  id: string;
  providerId?: string;
  count: number;
  lastUsed: number;
}

function usagePath(dir?: string): string {
  return join(dir || getConfigDir(), "model-usage.json");
}

export function getModelUsage(dir?: string): ModelUsage[] {
  try {
    const data = JSON.parse(fs.readFileSync(usagePath(dir), "utf-8")) as { models?: unknown };
    if (!Array.isArray(data?.models)) return [];
    return data.models.filter((u): u is ModelUsage => typeof u?.id === "string" && typeof u?.count === "number");
  } catch {
    return [];
  }
}

/** Count one use of a model (call when a model becomes active or answers a turn). */
export function recordModelUse(id: string, providerId?: string, dir?: string): void {
  const key = (id || "").trim();
  if (!key) return;
  const all = getModelUsage(dir);
  const hit = all.find((u) => u.id === key && (u.providerId ?? "") === (providerId ?? ""));
  if (hit) {
    hit.count++;
    hit.lastUsed = Date.now();
  } else {
    all.push({ id: key, providerId, count: 1, lastUsed: Date.now() });
  }
  try {
    const target = dir || getConfigDir();
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    // Keep the file small: the 50 most relevant entries
    const kept = all.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed).slice(0, 50);
    fs.writeFileSync(usagePath(dir), JSON.stringify({ models: kept }, null, 2), "utf-8");
  } catch {
    // Best-effort persistence
  }
}

/** Models ranked by how often they are used (ties: most recent first). */
export function getMostUsedModels(limit = 5, dir?: string): ModelUsage[] {
  return getModelUsage(dir)
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}
