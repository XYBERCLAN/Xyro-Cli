import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";
import { isIgnoredDir } from "../config/platform.js";

function walk(dir: string, depth = 0, maxDepth = 3): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (isIgnoredDir(entry, IGNORED_DIRS) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const isDir = statSync(full).isDirectory();
      const indent = "  ".repeat(depth);
      results.push(`${indent}${isDir ? "📁" : "📄"} ${entry}${isDir ? "/" : ""}`);
      if (isDir) {
        results.push(...walk(full, depth + 1, maxDepth));
      }
    }
  } catch {
    // permission denied, skip
  }
  return results;
}

export async function listFiles(args: { path?: string }): Promise<string> {
  const dir = args.path || ".";
  const entries = walk(dir);
  if (entries.length === 0) return "(Empty directory)";
  return entries.slice(0, 200).join("\n");
}
