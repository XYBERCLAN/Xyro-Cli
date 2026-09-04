import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";
import { isIgnoredDir, isWindows } from "../config/platform.js";

function shouldIgnore(fp: string): boolean {
  // Normalize path separators for consistent matching
  const normalized = fp.replace(/\\/g, "/");
  for (const d of IGNORED_DIRS) {
    const dirLower = d.toLowerCase();
    if (normalized.toLowerCase().includes(`/${dirLower}/`)) return true;
  }
  return false;
}

function getAllFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name, IGNORED_DIRS)) {
          results.push(...getAllFiles(full));
        }
      } else {
        results.push(full);
      }
    }
  } catch {
    // permission denied, skip
  }
  return results;
}

export async function searchCode(args: { pattern: string; path?: string }): Promise<string> {
  const pattern = args.pattern.toLowerCase();
  const dir = args.path || ".";
  const files = getAllFiles(dir);
  const matches: string[] = [];

  for (const fp of files) {
    if (shouldIgnore(fp)) continue;
    if (matches.length >= 50) break;
    try {
      const content = readFileSync(fp, "utf-8");
      // Handle both \n and \r\n line endings
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(pattern)) {
          // Normalize path for display (use forward slashes for consistency)
          const displayPath = isWindows ? fp.replace(/\\/g, "/") : fp;
          matches.push(`${displayPath}:${i + 1}: ${lines[i].trim()}`);
          if (matches.length >= 50) break;
        }
      }
    } catch {
      // binary or unreadable, skip
    }
  }

  return matches.length > 0
    ? matches.join("\n")
    : `No matches for '${args.pattern}'`;
}
