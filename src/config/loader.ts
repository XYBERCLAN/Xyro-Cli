import { readFileSync, existsSync } from "node:fs";
import { CONTEXT_FILES } from "./constants.js";

/** Max chars for project context to avoid exceeding token limits */
const MAX_CONTEXT_CHARS = 500;

export function loadProjectContext(): string {
  const parts: string[] = [];
  let totalChars = 0;
  for (const file of CONTEXT_FILES) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, "utf-8");
        // Truncate each file to first 500 chars
        const truncated = content.length > 500 ? content.slice(0, 500) + "..." : content;
        if (totalChars + truncated.length > MAX_CONTEXT_CHARS) break;
        parts.push(`--- ${file} ---\n${truncated}`);
        totalChars += truncated.length;
      } catch {
        // skip unreadable files
      }
    }
  }
  return parts.join("\n\n");
}
