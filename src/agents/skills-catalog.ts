// Skills catalog: every SKILL.md XYRO can find, indexed by name + description.
// The main agent only sees the index; an expert loads the full body of the
// skills it needs (declared, or matched to its task) — no prompt bloat.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { getConfigDir } from "../config/platform.js";
import { loadSkillStats, isQuarantined, skillHealth, trackRecord } from "./skill-stats.js";

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  /** project · user (XYRO) · claude (~/.claude/skills) · plugin (Claude Code plugins) */
  source: "project" | "user" | "claude" | "plugin";
}

/** Skills the prompt index lists by name; the rest are found with skill_search. */
const INDEX_LIMIT = 30;

const PROJECT_DIRS = [".agents/skills", ".claude/skills", ".xyro/skills", "skills"];
const MAX_BODY_LINES = 400;
const CACHE_TTL_MS = 10_000;

let cache: { root: string; at: number; skills: SkillInfo[] } | null = null;

/** Parse `name:` / `description:` from YAML-ish frontmatter (single or folded line). */
export function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // Folded / block scalars and indented continuation lines
    if (value === ">-" || value === ">" || value === "|" || value === "") {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(" ");
    }
    fields[kv[1]] = value.replace(/^["']|["']$/g, "");
  }
  return { fields, body: text.slice(m[0].length) };
}

function readSkill(path: string, source: SkillInfo["source"], fallbackName: string): SkillInfo | null {
  try {
    const { fields } = parseFrontmatter(readFileSync(path, "utf-8"));
    return { name: fields.name || fallbackName, description: fields.description || "", path, source };
  } catch {
    return null;
  }
}

function scanDir(dir: string, source: SkillInfo["source"], out: SkillInfo[]): void {
  if (!existsSync(dir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        const file = join(full, "SKILL.md");
        if (existsSync(file)) {
          const s = readSkill(file, source, entry);
          if (s) out.push(s);
        }
      }
    } catch {
      // unreadable entry — skip
    }
  }
}

/**
 * Claude Code plugin skill folders (…/plugins/cache/<market>/<plugin>/<version>/skills),
 * newest version first so it wins the name de-duplication.
 */
function pluginSkillDirs(pluginsRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const full = join(dir, e);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (e === "skills") out.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(pluginsRoot, 0);
  return out.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

/** All skills from the project and the user's config dir (project wins on name clashes). */
export function discoverSkills(root = process.cwd()): SkillInfo[] {
  if (cache && cache.root === root && Date.now() - cache.at < CACHE_TTL_MS) return cache.skills;
  const found: SkillInfo[] = [];
  for (const d of PROJECT_DIRS) scanDir(join(root, d), "project", found);
  const rootSkill = join(root, "SKILL.md");
  if (existsSync(rootSkill)) {
    const s = readSkill(rootSkill, "project", "project");
    if (s) found.push(s);
  }
  scanDir(join(getConfigDir(), "skills"), "user", found);
  // Bring your skills from other agents along (XYRO_IMPORT=off to skip)
  if (!/^(off|0|false|no)$/i.test(process.env.XYRO_IMPORT ?? "")) {
    const home = homedir();
    scanDir(join(home, ".claude", "skills"), "claude", found);
    scanDir(join(home, ".agents", "skills"), "claude", found);
    for (const dir of pluginSkillDirs(join(home, ".claude", "plugins"))) scanDir(dir, "plugin", found);
  }

  const seen = new Set<string>();
  const skills = found.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
  cache = { root, at: Date.now(), skills };
  return skills;
}

/** Forget the cached scan (after a skill is added). */
export function invalidateSkillCache(): void {
  cache = null;
}

export function findSkill(name: string): SkillInfo | undefined {
  const n = name.trim().toLowerCase();
  return discoverSkills().find((s) => s.name.toLowerCase() === n);
}

/** Full skill text (frontmatter stripped), capped to keep a sub-agent's context lean. */
export function loadSkillBody(name: string): string | null {
  const s = findSkill(name);
  if (!s) return null;
  try {
    const { body } = parseFrontmatter(readFileSync(s.path, "utf-8"));
    const lines = body.trim().split(/\r?\n/);
    return lines.length > MAX_BODY_LINES ? lines.slice(0, MAX_BODY_LINES).join("\n") + `\n… (${lines.length - MAX_BODY_LINES} more lines)` : lines.join("\n");
  } catch {
    return null;
  }
}

const STOP = new Set("the a an and or to of in on for with this that use when is are be it as by from your you any all at".split(" "));

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

/** Skills whose description overlaps the task most (score ≥ 2 shared keywords). */
export function matchSkills(task: string, limit = 2): SkillInfo[] {
  const words = keywords(task);
  const stats = loadSkillStats();
  return discoverSkills()
    // Skills with a failing track record are not auto-loaded any more
    .filter((s) => !isQuarantined(s.name, stats))
    .map((s) => ({ s, score: [...keywords(`${s.name} ${s.description}`)].filter((w) => words.has(w)).length + skillHealth(s.name, stats) - 0.5 }))
    // Your own skills need 2 shared keywords; imported ones (hundreds) need 3 so they don't crowd in
    .filter((x) => x.score >= (x.s.source === "project" || x.s.source === "user" ? 2 : 3) - 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Best skills for a free-text query (name and description overlap). */
export function searchSkills(query: string, limit = 8): SkillInfo[] {
  const words = keywords(query);
  const q = query.trim().toLowerCase();
  return discoverSkills()
    .map((s) => {
      const kw = keywords(`${s.name.replace(/[-_]/g, " ")} ${s.description}`);
      let score = [...kw].filter((w) => words.has(w)).length;
      if (s.name.toLowerCase() === q) score += 10;
      else if (q && s.name.toLowerCase().includes(q)) score += 3;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/**
 * Short index for the main agent's system prompt. Project skills come first;
 * with hundreds of imported skills only the first INDEX_LIMIT are listed and
 * the rest are a search away — the prompt stays small.
 */
export function skillsIndex(root = process.cwd()): string | null {
  const skills = discoverSkills(root);
  if (!skills.length) return null;
  const order = { project: 0, user: 1, claude: 2, plugin: 3 } as const;
  const sorted = [...skills].sort((a, b) => order[a.source] - order[b.source]);
  const shown = sorted.slice(0, INDEX_LIMIT);
  const stats = loadSkillStats();
  const lines = shown.map((s) => {
    const tags = [s.source !== "project" ? s.source : "", trackRecord(s.name, stats)].filter(Boolean).join(", ");
    return `- ${s.name}: ${s.description.slice(0, 120)}${tags ? ` (${tags})` : ""}`;
  });
  const more = skills.length - shown.length;
  return `## Skills available to your experts\nLoad one yourself with skill_load, pass \`skills\` to delegate, or let experts match them automatically. Nothing fits? skill_find_online, then skill_install.${more > 0 ? ` ${skills.length} skills in total: find others with skill_search.` : ""}\n${lines.join("\n")}`;
}

/** Path relative to the project, for display. */
export function displayPath(s: SkillInfo): string {
  return s.source === "project" ? relative(process.cwd(), s.path) : s.path;
}
