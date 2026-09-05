import { readFileSync } from "node:fs";
import { isWindows } from "../config/platform.js";
import { resolveProjectPath } from "./safety.js";

export async function readFile(args: {
  path: string;
  start_line?: number;
  end_line?: number;
}): Promise<string> {
  const resolveResult = resolveProjectPath(args.path);
  if (!resolveResult.ok) return resolveResult.message;
  const filePath = resolveResult.path;
  const content = readFileSync(filePath, { encoding: "utf-8", flag: "r" });
  // Handle both \n and \r\n line endings
  const allLines = content.split(/\r?\n/);
  const totalLines = allLines.length;

  // Windowed read: slice to [start_line, end_line] (1-indexed, inclusive)
  const start = args.start_line ? Math.max(1, args.start_line) : 1;
  const end = args.end_line ? Math.min(totalLines, args.end_line) : totalLines;
  const lines = allLines.slice(start - 1, end);

  const numbered = lines
    .map((line, i) => `${String(start + i).padStart(4, " ")} | ${line}`)
    .join("\n");

  // Normalize path for display on Windows
  const displayPath = isWindows ? filePath.replace(/\\/g, "/") : filePath;
  const windowInfo =
    start !== 1 || end !== totalLines
      ? ` [lines ${start}-${end} of ${totalLines}]`
      : ` (${totalLines} lines)`;
  return `📄 ${displayPath}${windowInfo}\n${numbered}`;
}
