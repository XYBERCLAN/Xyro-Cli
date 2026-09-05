import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";
import { isIgnoredDir } from "../config/platform.js";
import { resolveProjectPath } from "./safety.js";
import { GitIgnoreMatcher } from "./gitignore.js";

function walk(dir: string, depth = 0, maxDepth = 3, matcher?: GitIgnoreMatcher): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (isIgnoredDir(entry, IGNORED_DIRS) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (matcher && matcher.isIgnored(relative(dir, full).replace(/\\/g, "/"))) continue;
      const isDir = statSync(full).isDirectory();
      const indent = "  ".repeat(depth);
      results.push(`${indent}${isDir ? "📁" : "📄"} ${entry}${isDir ? "/" : ""}`);
      if (isDir) {
        results.push(...walk(full, depth + 1, maxDepth, matcher));
      }
    }
  } catch {
    // permission denied, skip
  }
  return results;
}

export async function listFiles(args: { path?: string }): Promise<string> {
  const resolveResult = resolveProjectPath(args.path || ".");
  if (!resolveResult.ok) return resolveResult.message;
  const dir = resolveResult.path;
  const matcher = new GitIgnoreMatcher(dir);
  const entries = walk(dir, 0, 3, matcher);
  if (entries.length === 0) return "(Empty directory)";
  return entries.slice(0, 200).join("\n");
}
