import { readFileSync, existsSync } from "node:fs";
import { CONTEXT_FILES } from "./constants.js";

export function loadProjectContext(): string {
  const parts: string[] = [];
  for (const file of CONTEXT_FILES) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, "utf-8");
        parts.push(`--- ${file} ---\n${content}`);
      } catch {
        // skip unreadable files
      }
    }
  }
  return parts.join("\n\n");
}
