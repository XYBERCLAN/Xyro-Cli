// Evidence-backed skills — every skill earns its place.
//
// Skill ecosystems are prose of unknown quality, and a bad skill injected
// into an expert's prompt makes it worse. XYRO keeps a track record: each
// time a skill is used, the outcome is recorded — VERIFIED outcomes (the
// verifier agreed, or the skill's run won a tournament), not the expert's own
// opinion. Skills that keep failing are quarantined: no longer auto-loaded
// (asking for one by name still works), like the immune memory for experts.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";

export interface SkillRecord {
  uses: number;
  wins: number;
  lastUsed: string;
}

const MIN_USES_TO_JUDGE = 4;
const QUARANTINE_BELOW = 0.3;

function statsPath(): string {
  return join(getConfigDir(), "skill-stats.json");
}

export function loadSkillStats(): Record<string, SkillRecord> {
  try {
    return JSON.parse(fs.readFileSync(statsPath(), "utf-8")) as Record<string, SkillRecord>;
  } catch {
    return {};
  }
}

export function recordSkillOutcome(skills: string[], ok: boolean): void {
  if (!skills.length) return;
  const all = loadSkillStats();
  for (const s of new Set(skills)) {
    const r = (all[s] ??= { uses: 0, wins: 0, lastUsed: "" });
    r.uses++;
    if (ok) r.wins++;
    r.lastUsed = new Date().toISOString();
  }
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(statsPath(), JSON.stringify(all, null, 2));
  } catch {
    // best effort
  }
}

/** Success rate with a neutral prior (an unused skill scores 0.5). */
export function skillHealth(name: string, stats = loadSkillStats()): number {
  const r = stats[name];
  return ((r?.wins ?? 0) + 1) / ((r?.uses ?? 0) + 2);
}

export function isQuarantined(name: string, stats = loadSkillStats()): boolean {
  const r = stats[name];
  return Boolean(r && r.uses >= MIN_USES_TO_JUDGE && r.wins / r.uses < QUARANTINE_BELOW);
}

/** "3/4 verified" style label, or "" when never used. */
export function trackRecord(name: string, stats = loadSkillStats()): string {
  const r = stats[name];
  if (!r?.uses) return "";
  return `${r.wins}/${r.uses} verified${isQuarantined(name, stats) ? ", quarantined" : ""}`;
}
