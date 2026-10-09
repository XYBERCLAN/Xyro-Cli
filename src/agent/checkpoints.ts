// Checkpoints — a snapshot before every user message, so any turn can be
// rewound: files go back to how they were and the conversation is cut back
// to just before that message. Files are captured lazily: the first time a
// tool is about to change a file during a turn, its current content (or its
// absence) is recorded. Shell commands can change files XYRO cannot see —
// those are not covered (same as other agents).

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { workspaceRoot } from "./workspace.js";

export interface Checkpoint {
  id: number;
  prompt: string;
  at: number;
  /** Conversation length (messages) just before this prompt was added */
  historyLength: number;
  /** absolute path → content before the first change in this turn (null = file did not exist) */
  files: Map<string, string | null>;
}

const MAX_CHECKPOINTS = 50;
const checkpoints: Checkpoint[] = [];
let nextId = 1;

/** Start a checkpoint for a new user message. */
export function beginCheckpoint(prompt: string, historyLength: number): Checkpoint {
  const cp: Checkpoint = { id: nextId++, prompt, at: Date.now(), historyLength, files: new Map() };
  checkpoints.push(cp);
  if (checkpoints.length > MAX_CHECKPOINTS) checkpoints.shift();
  return cp;
}

/** Call right before a tool modifies `path` (relative or absolute). */
export function recordBeforeChange(path: string): void {
  const cp = checkpoints[checkpoints.length - 1];
  if (!cp || !path) return;
  // Edits inside a temporary expert worktree are not the user's files —
  // they are checkpointed when merged back instead (see agents/worktree.ts)
  if (workspaceRoot() !== process.cwd()) return;
  const abs = resolve(process.cwd(), path);
  if (cp.files.has(abs)) return; // keep the state from the start of the turn
  try {
    cp.files.set(abs, existsSync(abs) ? readFileSync(abs, "utf-8") : null);
  } catch {
    // unreadable (binary, permissions) — cannot restore, skip
  }
}

export function listCheckpoints(): Checkpoint[] {
  return checkpoints.slice().reverse();
}

export function getCheckpoint(id: number): Checkpoint | undefined {
  return checkpoints.find((c) => c.id === id);
}

export interface RewindResult {
  restored: string[];
  deleted: string[];
  failed: string[];
  historyLength: number;
}

/**
 * Restore every file changed since checkpoint `id` to its state at that
 * checkpoint, newest changes undone first, and drop later checkpoints.
 */
export function rewindTo(id: number): RewindResult | null {
  const idx = checkpoints.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  // Earliest recorded state per file across this checkpoint and all later ones
  const original = new Map<string, string | null>();
  for (const cp of checkpoints.slice(idx)) {
    for (const [path, content] of cp.files) if (!original.has(path)) original.set(path, content);
  }
  const res: RewindResult = { restored: [], deleted: [], failed: [], historyLength: checkpoints[idx].historyLength };
  for (const [path, content] of original) {
    const rel = relative(process.cwd(), path) || path;
    try {
      if (content === null) {
        if (existsSync(path)) {
          unlinkSync(path);
          res.deleted.push(rel);
        }
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf-8");
        res.restored.push(rel);
      }
    } catch {
      res.failed.push(rel);
    }
  }
  checkpoints.splice(idx);
  return res;
}

/** Paths a tool call is about to change (for checkpoint capture). */
export function pathsTouchedBy(tool: string, args: Record<string, unknown>): string[] {
  if (["write_file", "edit_file", "revert_file", "propose_write_file"].includes(tool) && typeof args.path === "string") return [args.path];
  if (tool === "multi_edit" && Array.isArray(args.edits)) {
    return (args.edits as { path?: unknown }[]).map((e) => e?.path).filter((p): p is string => typeof p === "string");
  }
  return [];
}

/** Test helper. */
export function _resetCheckpoints(): void {
  checkpoints.length = 0;
  nextId = 1;
}
