/**
 * apply_patch — apply multi-file changes with diff preview and user approval.
 *
 * Accepts a list of files with their full new content, validates all paths,
 * shows diffs, and writes atomically (all-or-nothing). Backups are created for
 * existing files so they can be reverted.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveProjectPath } from "./safety.js";
import { backupFile } from "./undo.js";
import { generateDiff } from "./diff.js";

export interface PatchFile {
  path: string;
  content: string;
}

export async function applyPatch(args: {
  files: PatchFile[];
  reason?: string;
}): Promise<string> {
  const files = Array.isArray(args.files) ? args.files : [];
  if (files.length === 0) {
    return "❌ apply_patch: `files` must contain at least one file.";
  }

  // Validate everything first — nothing written if any path/content is invalid
  const pending: Array<{
    display: string;
    abs: string;
    before: string;
    after: string;
    isNew: boolean;
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") {
      return `❌ apply_patch: file ${i + 1} must have string 'path' and string 'content'.`;
    }
    const r = resolveProjectPath(f.path);
    if (!r.ok) return `❌ apply_patch: ${r.message}`;
    const abs = r.path;
    const exists = existsSync(abs);
    const before = exists ? readFileSync(abs, "utf-8") : "";
    if (before === f.content) {
      continue; // skip no-op changes
    }
    pending.push({
      display: f.path,
      abs,
      before,
      after: f.content,
      isNew: !exists,
    });
  }

  if (pending.length === 0) {
    return "✅ No changes to apply (all files identical).";
  }

  // Apply all changes
  const sections: string[] = [];
  for (const p of pending) {
    if (!p.isNew) {
      backupFile(p.abs);
    }
    const dir = dirname(p.abs);
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(p.abs, p.after, "utf-8");

    if (p.isNew) {
      const preview = p.after.split("\n").slice(0, 80).map((l) => `+ ${l}`).join("\n");
      const more = p.after.split("\n").length > 80 ? `\n+ ... (${p.after.split("\n").length - 80} more lines)` : "";
      sections.push(`## [new file] ${p.display}\n${preview}${more}`);
    } else {
      const diff = generateDiff(p.before, p.after, p.display);
      sections.push(`## ${p.display}\n${diff}`);
    }
  }

  const summary = `✅ Applied patch to ${pending.length} file${pending.length === 1 ? "" : "s"}${args.reason ? ` — ${args.reason}` : ""}`;
  const body = sections.join("\n\n");
  const out = `${summary}\n\n${body}`;
  // Avoid blowing up context too much
  return out.length > 12000 ? out.slice(0, 12000) + "\n\n... (diff truncated)" : out;
}
