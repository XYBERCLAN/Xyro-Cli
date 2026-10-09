// Router + immune memory.
//
// Like an immune system recognising an antigen, the router reads a task and
// activates the specialist whose "receptors" (triggers + description) match
// it best. Every run is remembered: which expert handled which kind of task,
// and whether it succeeded. That memory strengthens future matches.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { getExperts, Expert } from "./experts.js";
import { keywords } from "./skills-catalog.js";

interface MemoryFile {
  experts: Record<string, { runs: number; ok: number }>;
  /** keyword → expert → learned affinity */
  affinity: Record<string, Record<string, number>>;
}

function memoryPath(): string {
  return join(getConfigDir(), "agent-memory.json");
}

export function readMemory(): MemoryFile {
  try {
    const m = JSON.parse(fs.readFileSync(memoryPath(), "utf-8")) as MemoryFile;
    return { experts: m.experts ?? {}, affinity: m.affinity ?? {} };
  } catch {
    return { experts: {}, affinity: {} };
  }
}

function writeMemory(m: MemoryFile): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    // Keep the file small: drop the weakest keywords beyond 400
    const entries = Object.entries(m.affinity);
    if (entries.length > 400) {
      entries.sort((a, b) => Math.max(...Object.values(b[1])) - Math.max(...Object.values(a[1])));
      m.affinity = Object.fromEntries(entries.slice(0, 400));
    }
    fs.writeFileSync(memoryPath(), JSON.stringify(m), "utf-8");
  } catch {
    // memory is an optimisation — never fail a task over it
  }
}

/** Remember how an expert did on a task (success strengthens, failure weakens). */
export function rememberOutcome(expert: string, task: string, ok: boolean): void {
  const m = readMemory();
  const stats = (m.experts[expert] ??= { runs: 0, ok: 0 });
  stats.runs++;
  if (ok) stats.ok++;
  for (const w of keywords(task)) {
    const row = (m.affinity[w] ??= {});
    row[expert] = Math.max(-2, Math.min(5, (row[expert] ?? 0) + (ok ? 0.5 : -0.5)));
  }
  writeMemory(m);
}

const GENERIC_VERBS = new Set(["add", "update", "change", "create", "build", "check", "write code", "support", "plan", "find"]);

export interface RouteScore {
  expert: Expert;
  score: number;
  reasons: string[];
}

/** Rank experts for a task, best first. */
export function routeTask(task: string, experts: Expert[] = getExperts()): RouteScore[] {
  const text = ` ${task.toLowerCase()} `;
  const words = keywords(task);
  const mem = readMemory();

  const scored = experts.map((expert) => {
    const reasons: string[] = [];
    let score = 0;

    const hits = expert.triggers.filter((t) => (t.includes(" ") ? text.includes(t) : words.has(t) || text.includes(` ${t} `)));
    if (hits.length) {
      // Specific nouns ("readme", "injection") outweigh generic verbs ("add", "update")
      score += hits.reduce((sum, h) => sum + (GENERIC_VERBS.has(h) ? 1.5 : 3), 0);
      reasons.push(`matches ${hits.slice(0, 3).join(", ")}`);
    }

    const overlap = [...keywords(expert.description)].filter((w) => words.has(w)).length;
    if (overlap) score += overlap;

    let learned = 0;
    for (const w of words) learned += mem.affinity[w]?.[expert.name] ?? 0;
    if (learned) {
      score += Math.max(-3, Math.min(6, learned));
      if (learned > 0) reasons.push("worked well on similar tasks");
    }

    const stats = mem.experts[expert.name];
    if (stats && stats.runs >= 3) score += (stats.ok / stats.runs - 0.5) * 2;

    return { expert, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/** Best expert for a task; falls back to the builder when nothing matches. */
export function pickExpert(task: string): RouteScore {
  const ranked = routeTask(task);
  if (ranked[0] && ranked[0].score > 0) return ranked[0];
  const builder = ranked.find((r) => r.expert.name === "builder") ?? ranked[0];
  return { ...builder, reasons: ["general-purpose default"] };
}
