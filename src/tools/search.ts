import { readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { IGNORED_DIRS } from "../config/constants.js";
import { isWindows } from "../config/platform.js";

export async function searchCode(args: { pattern: string; path?: string }): Promise<string> {
  const pattern = args.pattern.toLowerCase();
  const dir = args.path || ".";

  const ignorePatterns = Array.from(IGNORED_DIRS).flatMap((d) => [`**/${d}/**`, `**/${d}`]);
  ignorePatterns.push("**/.*/**");

  const files = await fg("**/*", {
    cwd: dir,
    dot: false,
    onlyFiles: true,
    ignore: ignorePatterns,
  });

  // Sort files for deterministic search output
  files.sort();

  const matches: string[] = [];

  for (const rel of files) {
    if (matches.length >= 50) break;
    const fullPath = join(dir, rel);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(pattern)) {
          const displayPath = isWindows ? fullPath.replace(/\\/g, "/") : fullPath;
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
