/**
 * glob — File pattern search tool.
 * Find files by glob pattern across the project tree.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";
import { resolveProjectPath } from "./safety.js";
import { GitIgnoreMatcher } from "./gitignore.js";

function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize both pattern and filePath to forward slashes
  const normPattern = pattern.replace(/\\/g, "/");
  const normPath = filePath.replace(/\\/g, "/");

  // Protect regex special chars and convert glob patterns with placeholders
  let regexStr = normPattern
    .replace(/\./g, "\\.")
    .replace(/\+/g, "\\+")
    .replace(/\^/g, "\\^")
    .replace(/\$/g, "\\$")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(",").join("|")})`)
    .replace(/\*\*\//g, "__GLOBSTAR_SLASH__")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "__STAR__")
    .replace(/\?/g, "__QUESTION__");

  regexStr = regexStr
    .replace(/__GLOBSTAR_SLASH__/g, "(.+/)?")
    .replace(/__GLOBSTAR__/g, ".*")
    .replace(/__STAR__/g, "[^/]*")
    .replace(/__QUESTION__/g, "[^/]");

  try {
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(normPath);
  } catch {
    return false;
  }
}

function walkDir(dir: string, root: string, results: string[], matcher: GitIgnoreMatcher, maxResults = 200): void {
  if (results.length >= maxResults) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const relPath = relative(root, fullPath).replace(/\\/g, "/");
    if (matcher.isIgnored(relPath)) continue;
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(fullPath, root, results, matcher, maxResults);
    } else {
      results.push(relPath);
    }
  }
}

export async function glob(args: { pattern: string; path?: string }): Promise<string> {
  const resolveResult = resolveProjectPath(args.path || ".");
  if (!resolveResult.ok) return resolveResult.message;
  const root = resolveResult.path;
  const pattern = args.pattern;

  if (!pattern) return "❌ Error: pattern is required";

  const allFiles: string[] = [];
  walkDir(root, root, allFiles, new GitIgnoreMatcher(root), 500);

  const matches = allFiles.filter((f) => matchGlob(pattern, f));

  if (matches.length === 0) {
    return `No files matching "${pattern}"`;
  }

  return `Found ${matches.length} file(s) matching "${pattern}":\n${matches.join("\n")}`;
}
