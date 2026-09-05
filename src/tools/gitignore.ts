import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal .gitignore matcher for exploration tools (list_files, search_code, glob).
 *
 * Reads the project-root .gitignore once and tests whether a given relative path
 * (using forward slashes) is ignored. Supported syntax:
 *   - Blank lines and lines starting with '#' are ignored
 *   - Trailing '/' means a directory pattern
 *   - Leading '/' anchors the pattern to the project root
 *   - '*' matches within a path segment, '**' matches across segments
 *   - '?' matches a single character
 *   - '!' negation is NOT supported (patterns are treated strictly additively)
 */
export class GitIgnoreMatcher {
  private patterns: { negated: boolean; regex: RegExp }[] = [];

  constructor(rootDir: string) {
    const gitignorePath = join(rootDir, ".gitignore");
    if (!existsSync(gitignorePath)) return;

    const lines = readFileSync(gitignorePath, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));

    for (const line of lines) {
      const entry = this.compile(line);
      if (entry) this.patterns.push(entry);
    }
  }

  private compile(raw: string): { negated: boolean; regex: RegExp } {
    let negated = false;
    let pattern = raw;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }

    let dirOnly = false;
    if (pattern.endsWith("/")) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }

    let anchored = pattern.startsWith("/");
    if (anchored) pattern = pattern.slice(1);

    // Escape regex specials first, then convert glob tokens.
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "__DS__")
      .replace(/\*\*/g, "__GLOBSTAR__")
      .replace(/\*/g, "__STAR__")
      .replace(/\?/g, "__Q__");

    const regexSrc =
      "(" +
      escaped
        .replace(/__DS__/g, "(?:[^/]+/)*")
        .replace(/__GLOBSTAR__/g, ".*")
        .replace(/__STAR__/g, "[^/]*")
        .replace(/__Q__/g, "[^/]") +
      "/?)";

    // An unanchored pattern applies at any depth; a dir-only pattern must match
    // a path component boundary.
    const suffix = dirOnly ? "(?:/|$)" : "";
    const source = anchored ? `^${regexSrc}${suffix}` : `(^|/)${regexSrc}${suffix}`;
    return { negated, regex: new RegExp(source) };
  }

  /** Test a relative path (forward slashes) against the compiled rules. */
  isIgnored(relPath: string): boolean {
    const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    let ignored = false;
    for (const p of this.patterns) {
      if (p.regex.test(norm)) ignored = !p.negated ? true : false;
    }
    return ignored;
  }
}