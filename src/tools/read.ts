import { readFileSync } from "node:fs";
import { isWindows } from "../config/platform.js";

export async function readFile(args: { path: string }): Promise<string> {
  const filePath = args.path;
  const content = readFileSync(filePath, { encoding: "utf-8", flag: "r" });
  // Handle both \n and \r\n line endings
  const lines = content.split(/\r?\n/);
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
  // Normalize path for display on Windows
  const displayPath = isWindows ? filePath.replace(/\\/g, "/") : filePath;
  return `📄 ${displayPath} (${lines.length} lines)\n${numbered}`;
}
