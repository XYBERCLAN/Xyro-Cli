/**
 * skills — Load SKILL.md conventions from the project.
 *
 * Convention over configuration: any `SKILL.md` file in the project (or files
 * under a `skills/` directory) is a skill that teaches XYRO how to work in
 * this repository. Their contents get injected into the system prompt as a
 * "Skills" section, alongside AGENTS.md / CLAUDE.md project context.
 *
 * Results are cached briefly (TTL) so re-scanning per message stays cheap.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";
import { GitIgnoreMatcher } from "../tools/gitignore.js";

const MAX_SKILL_FILES = 5;
const MAX_SKILL_LINES = 150;
const CACHE_TTL_MS = 5000;

interface SkillEntry {
  rel: string;
  content: string;
}

let cache: { root: string; skills: SkillEntry[]; at: number } | null = null;

function walkForSkills(dir: string, root: string, matcher: GitIgnoreMatcher, found: string[]): void {
  if (found.length >= MAX_SKILL_FILES) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_SKILL_FILES) break;
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (matcher.isIgnored(rel)) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkForSkills(full, root, matcher, found);
    } else if (entry === "SKILL.md" || (rel.includes("/skills/") && entry.endsWith(".md"))) {
      found.push(rel);
    }
  }
}

function readSkill(rel: string): string {
  try {
    const content = readFileSync(join(process.cwd(), rel), "utf-8");
    const lines = content.split(/\r?\n/);
    const limited = lines.length > MAX_SKILL_LINES ? lines.slice(0, MAX_SKILL_LINES) : lines;
    return limited.join("\n") + (lines.length > MAX_SKILL_LINES ? `\n… (${lines.length - MAX_SKILL_LINES} more lines omitted)` : "");
  } catch {
    return "";
  }
}

/** Scan the current project for SKILL.md files and return a markdown section, or null. */
export function loadSkills(): string | null {
  const root = process.cwd();
  if (cache && cache.root === root && Date.now() - cache.at < CACHE_TTL_MS) {
    return formatSkills(cache.skills);
  }

  const files: string[] = [];
  walkForSkills(root, root, new GitIgnoreMatcher(root), files);
  files.sort();

  const skills: SkillEntry[] = [];
  for (const rel of files) {
    const content = readSkill(rel);
    if (content) skills.push({ rel, content });
  }

  cache = { root, skills, at: Date.now() };
  return formatSkills(skills);
}

function formatSkills(skills: SkillEntry[]): string | null {
  if (skills.length === 0) return null;
  const sections = skills.map(
    (s) => `### ${s.rel}\n${s.content.trim()}`
  );
  return `## Skills\n\n${sections.join("\n\n")}`;
}

/** Drop the cache (used by tests). */
export function clearSkillsCache(): void {
  cache = null;
}

/** Keep import used for typing purposes (existsSync guard for unusual setups). */
export function hasProjectSkills(): boolean {
  return existsSync(join(process.cwd(), "SKILL.md"));
}