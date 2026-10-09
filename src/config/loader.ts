import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { CONTEXT_FILES } from "./constants.js";
import { getConfigDir } from "./platform.js";

/** Max chars for project context to avoid exceeding token limits */
const MAX_CONTEXT_CHARS = 16_000;

/** Per-file limits: memory/instruction files matter most, the README least. */
const FILE_LIMITS: Record<string, number> = { "XYRO.md": 6000, "AGENTS.md": 6000, "CLAUDE.md": 6000, "README.md": 1500 };

export function loadProjectContext(): string {
  const parts: string[] = [];
  let totalChars = 0;
  // Your personal memory applies to every project
  const userMemory = join(getConfigDir(), "XYRO.md");
  const sources: [string, string][] = [
    ...(existsSync(userMemory) ? ([[userMemory, "~/.config/xyro/XYRO.md (your memory)"]] as [string, string][]) : []),
    ...CONTEXT_FILES.map((f): [string, string] => [f, f]),
  ];
  for (const [file, label] of sources) {
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, "utf-8");
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
