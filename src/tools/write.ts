import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import pc from "picocolors";
import { isWindows } from "../config/platform.js";
import { generateDiff, generateInlineDiff } from "./diff.js";
import { resolveProjectPath } from "./safety.js";
import { backupFile } from "./undo.js";

function normalizeForDisplay(p: string): string {
  return isWindows ? p.replace(/\\/g, "/") : p;
}

export async function writeFile(args: { path: string; content: string }): Promise<string> {
  const resolveResult = resolveProjectPath(args.path);
  if (!resolveResult.ok) return resolveResult.message;
  const filePath = resolveResult.path;

  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Show diff if file already exists
  let diffPreview = "";
  if (existsSync(filePath)) {
    backupFile(filePath); // snapshot for revert_file
    const oldContent = readFileSync(filePath, "utf-8");
    if (oldContent === args.content) {
      return `ℹ️ ${normalizeForDisplay(filePath)} — no changes needed`;
    }
    diffPreview = "\n" + generateDiff(oldContent, args.content, normalizeForDisplay(filePath)) + "\n";
  } else {
    diffPreview = pc.dim(`  (new file: ${normalizeForDisplay(filePath)})`) + "\n";
  }

  writeFileSync(filePath, args.content, "utf-8");
  return `✅ Written to ${normalizeForDisplay(filePath)} (${args.content.length} chars)${diffPreview}`;
}

export async function editFile(args: {
  path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}): Promise<string> {
  const resolveResult = resolveProjectPath(args.path);
  if (!resolveResult.ok) return resolveResult.message;
  const filePath = resolveResult.path;

  if (!existsSync(filePath)) {
    return `❌ File not found: ${normalizeForDisplay(filePath)}`;
  }
  const content = readFileSync(filePath, "utf-8");
  if (!content.includes(args.old_text)) {
    return "❌ Target text not found in file";
  }
  backupFile(filePath); // snapshot for revert_file
  const occurrenceCount = content.split(args.old_text).length - 1;
  const replaceAll = args.replace_all === true || occurrenceCount > 1;
  const updated = replaceAll
    ? content.split(args.old_text).join(args.new_text)
    : content.replace(args.old_text, args.new_text);
  const diffPreview = "\n" + generateInlineDiff(args.old_text, args.new_text, normalizeForDisplay(filePath)) + "\n";
  writeFileSync(filePath, updated, "utf-8");
  const note = replaceAll
    ? pc.dim(` (${occurrenceCount} occurrence(s) replaced)`)
    : "";
  return `✅ Edited ${normalizeForDisplay(filePath)}${note}${diffPreview}`;
}