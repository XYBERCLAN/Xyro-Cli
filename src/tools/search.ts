import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";

function shouldIgnore(fp: string): boolean {
  for (const d of IGNORED_DIRS) {
    if (fp.includes(`/${d}/`) || fp.includes(`\\${d}\\`)) return true;
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
        if (!IGNORED_DIRS.has(entry.name)) {
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
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(pattern)) {
          matches.push(`${fp}:${i + 1}: ${lines[i].trim()}`);
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
