import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { CONTEXT_FILES, CONTEXT_RULE_DIRS } from "./constants.js";
import { getConfigDir } from "./platform.js";

/** Max chars for project context to avoid exceeding token limits */
const MAX_CONTEXT_CHARS = 16_000;

/** Per-file limits: memory/instruction files matter most, the README least. */
const FILE_LIMITS: Record<string, number> = { "XYRO.md": 6000, "AGENTS.md": 6000, "CLAUDE.md": 6000, "README.md": 1500 };

/**
 * Files inside rule folders that apply to every request. Cursor .mdc rules
 * that only apply to certain globs (alwaysApply: false with globs) are left
 * out — they would mislead on unrelated files.
 */
function ruleFiles(): [string, string][] {
  const out: [string, string][] = [];
  for (const dir of CONTEXT_RULE_DIRS) {
    try {
      if (!statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir).sort()) {
        if (!/\.(md|mdc|txt)$/.test(f)) continue;
        const p = join(dir, f);
        const text = readFileSync(p, "utf-8");
        const fm = text.match(/^---\n([\s\S]*?)\n---/);
        if (fm && /alwaysApply:\s*false/.test(fm[1]) && /globs:\s*\S/.test(fm[1])) continue;
        out.push([p, p]);
      }
    } catch {
      // folder missing or unreadable
    }
  }
  return out.slice(0, 12);
}

export function loadProjectContext(): string {
  const parts: string[] = [];
  let totalChars = 0;
  // Your personal memory applies to every project
  const userMemory = join(getConfigDir(), "XYRO.md");
  const sources: [string, string][] = [
    ...(existsSync(userMemory) ? ([[userMemory, "~/.config/xyro/XYRO.md (your memory)"]] as [string, string][]) : []),
    ...CONTEXT_FILES.map((f): [string, string] => [f, f]),
  ];
  // README goes last, after rule folders
  const readme = sources.findIndex(([f]) => f === "README.md");
  if (readme !== -1) sources.splice(readme, 0, ...ruleFiles());
  for (const [file, label] of sources) {
    if (!existsSync(file)) continue;
    try {
      if (!statSync(file).isFile()) continue; // .clinerules can be a folder
      const content = readFileSync(file, "utf-8").replace(/^---\n[\s\S]*?\n---\n/, "");
      const limit = FILE_LIMITS[basename(file)] ?? 3000;
      const truncated = content.length > limit ? content.slice(0, limit) + "\n…(truncated)" : content;
      if (totalChars + truncated.length > MAX_CONTEXT_CHARS) break;
      parts.push(`--- ${label} ---\n${truncated}`);
      totalChars += truncated.length;
    } catch {
      // skip unreadable files
    }
  }
  return parts.join("\n\n");
}
