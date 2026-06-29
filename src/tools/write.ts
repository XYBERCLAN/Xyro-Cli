import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { parse } from "node:path";

export async function writeFile(args: { path: string; content: string }): Promise<string> {
  const dir = parse(args.path).dir;
  if (dir) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(args.path, args.content, "utf-8");
  return `✅ Written to ${args.path} (${args.content.length} chars)`;
}

export async function editFile(args: { path: string; old_text: string; new_text: string }): Promise<string> {
  const content = readFileSync(args.path, "utf-8");
  if (!content.includes(args.old_text)) {
    return "❌ Target text not found in file";
  }
  const updated = content.replace(args.old_text, args.new_text);
  writeFileSync(args.path, updated, "utf-8");
  return `✅ Edited ${args.path}`;
}
