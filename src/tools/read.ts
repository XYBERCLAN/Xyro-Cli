import { readFileSync } from "node:fs";

export async function readFile(args: { path: string }): Promise<string> {
  const path = args.path;
  const content = readFileSync(path, { encoding: "utf-8", flag: "r" });
  const lines = content.split("\n");
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
  return `📄 ${path} (${lines.length} lines)\n${numbered}`;
}
