/**
 * find_files — Deterministic relevance-ranked file search.
 *
 * A lightweight local version of an LLM-driven `find_files`: it scans the
 * project (respecting .gitignore) and ranks matches by:
 *   1. filename token matches
 *   2. path token matches
 *   3. content substring hits
 * It returns the top matches with a one-line reason so the main agent can
 * jump straight to the right files without burning LLM tokens.
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { IGNORED_DIRS } from "../config/constants.js";
import { resolveProjectPath } from "./safety.js";
import { GitIgnoreMatcher } from "./gitignore.js";

const MAX_FILES_SCANNED = 3000;
const MAX_FILE_BYTES = 1_048_576; // skip files > 1MB
const CONTENT_SNIFF_BYTES = 2048;

interface Candidate {
  rel: string;
  score: number;
  reason: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "have", "has", "was",
  "were", "are", "but", "not", "you", "your", "our", "all", "can", "will",
  "would", "should", "could", "about", "into", "over", "after", "before",
  "a", "an", "of", "on", "in", "to", "is", "it", "or", "be", "as", "at",
  "by", "no", "yeah",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function scrape(dir: string, root: string, matcher: GitIgnoreMatcher, out: string[]): void {
  if (out.length >= MAX_FILES_SCANNED) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES_SCANNED) break;
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
      scrape(full, root, matcher, out);
    } else if (stat.size <= MAX_FILE_BYTES) {
      out.push(rel);
    }
  }
}

export async function findFiles(args: {
  query: string;
  path?: string;
  max_results?: number;
}): Promise<string> {
  const query = (args.query || "").trim();
  if (!query) return "❌ find_files: query is required";

  const resolveResult = resolveProjectPath(args.path || ".");
  if (!resolveResult.ok) return resolveResult.message;
  const root = resolveResult.path;

  const files: string[] = [];
  scrape(root, root, new GitIgnoreMatcher(root), files);

  const tokens = tokenize(query);
  if (tokens.length === 0) return `No searchable terms in "${query}"`;

  const cleanQuery = query.toLowerCase();
  const scored: Candidate[] = [];

  for (const rel of files) {
    let score = 0;
    const name = basename(rel).toLowerCase();
    const pathParts = rel.toLowerCase().split("/");

    for (const tok of tokens) {
      if (name.includes(tok)) score += 10;
    }
    for (const part of pathParts) {
      for (const tok of tokens) {
        if (part.includes(tok)) score += 3;
      }
    }
    if (score < 5) continue; // filename/path not promising — skip content read

    // Content sniff: substring hits boost relevance strongly.
    let content = "";
    try {
      const fd = readFileSync(join(root, rel), "utf-8");
      if (!fd.includes("\u0000")) content = fd.slice(0, CONTENT_SNIFF_BYTES);
    } catch {
      continue;
    }
    const contentHits = content.toLowerCase().includes(cleanQuery) ? 8 : 0;
    score += contentHits;

    const reason = [
      name && tokens.filter((t) => name.includes(t)).length > 0 ? "name match" : "",
      contentHits > 0 ? "content match" : "",
    ]
      .filter(Boolean)
      .join(" + ");

    scored.push({ rel, score, reason: reason || "path match" });
  }

  scored.sort((a, b) => b.score - a.score);
  const max = Math.min(args.max_results ?? 20, 50);
  const top = scored.slice(0, max);

  if (top.length === 0) {
    return `No relevant files found for "${query}"`;
  }

  const lines = top.map(
    (c, i) => `${String(i + 1).padStart(2)}. ${c.rel} [${c.score}] ${c.reason ? `(${c.reason})` : ""}`
  );
  return `Top ${top.length} relevant file(s) for "${query}":\n${lines.join("\n")}`;
}