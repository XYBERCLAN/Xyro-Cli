/**
 * undo / revert_file — Snapshot and restore file contents.
 *
 * Every write_file / edit_file call transparently backs up the previous file
 * content to ~/.xyro/undo/ so the agent (or user) can roll back any change,
 * even when git isn't in play.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { resolveProjectPath } from "./safety.js";

const UNDO_DIR = join(homedir(), ".xyro", "undo");

export interface UndoEntry {
  key: string;
  path: string;
  content: string;
  ts: number;
  dir: string;
  backupFile: string;
}

function hashPath(absPath: string): string {
  return createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

function backupDirFor(absPath: string): string {
  return join(UNDO_DIR, hashPath(absPath));
}

/** Backup the current content of an existing file. Returns the backup file path or null. */
export function backupFile(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  try {
    const content = readFileSync(absPath, "utf-8");
    const dir = backupDirFor(absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const backupFile = join(dir, `${ts}.bak`);
    writeFileSync(backupFile, content, "utf-8");
    // Store metadata JSON alongside so revert knows the original absolute path.
    writeFileSync(join(dir, `${ts}.json`), JSON.stringify({ path: absPath, ts }), "utf-8");
    return backupFile;
  } catch {
    return null;
  }
}

/** List the backups available for a project-relative path (newest first). */
export function listBackups(absPath: string): { file: string; ts: number }[] {
  const dir = backupDirFor(absPath);
  if (!existsSync(dir)) return [];
  const backups: { file: string; ts: number }[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, entry), "utf-8"));
      if (meta.path === absPath) {
        backups.push({ file: join(dir, entry.replace(/\.json$/, ".bak")), ts: meta.ts });
      }
    } catch {
      // skip corrupted metadata
    }
  }
  return backups.sort((a, b) => b.ts - a.ts);
}

export async function revertFile(args: { path: string }): Promise<string> {
  const resolveResult = resolveProjectPath(args.path);
  if (!resolveResult.ok) return resolveResult.message;
  const absPath = resolveResult.path;

  const backups = listBackups(absPath);
  if (backups.length === 0) {
    return `❌ No undo history for ${args.path} (nothing was written via write_file/edit_file yet)`;
  }

  try {
    const content = readFileSync(backups[0].file, "utf-8");
    writeFileSync(absPath, content, "utf-8");
    const label = basename(absPath);
    return `✅ Reverted ${label} to the previous version (${new Date(backups[0].ts).toISOString()}). ${
      content.length
    } chars restored.`;
  } catch (err) {
    return `❌ revert_file error: ${err instanceof Error ? err.message : String(err)}`;
  }
}