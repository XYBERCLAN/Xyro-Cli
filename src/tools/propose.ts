/**
 * propose_write_file — write a whole file, but only after the user has seen
 * what changes. The diff is returned to the model, and approval happens in
 * XYRO's normal permission prompt (this tool always asks), so it works the
 * same in the full-screen UI and in line mode — no raw stdin prompting.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { generateDiff } from "./diff.js";
import { resolveProjectPath } from "./safety.js";
import { backupFile } from "./undo.js";

export async function proposeWriteFile(args: { path: string; content: string; reason?: string }): Promise<string> {
  const r = resolveProjectPath(args.path);
  if (!r.ok) return r.message;
  const filePath = r.path;

  const oldContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  if (existsSync(filePath) && oldContent === args.content) return `✅ No changes needed for ${args.path}`;

  const isNew = !existsSync(filePath);
  const diff = isNew ? `[new file] ${args.path}\n+ ${args.content.split("\n").join("\n+ ")}` : generateDiff(oldContent, args.content, args.path);

  if (!isNew) backupFile(filePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, args.content, "utf-8");
  return `✅ Changes applied to ${args.path}${args.reason ? ` — ${args.reason}` : ""}\n${diff.slice(0, 4000)}`;
}
