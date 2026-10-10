// Sessions — every project keeps its own conversations.
//
//   <project>/.xyro/sessions/<id>.json
//
// A session starts when you first write in a project and is saved after
// every turn: the conversation, a title (your first prompt) and the prompts
// you typed (↑/↓ in the input walks them). /sessions lists them so you can
// pick one up again; --resume reopens the latest one of THIS project.
// Conversations can hold secrets XYRO read, so the files are private (600)
// and the folder is kept out of git automatically.

import * as fs from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { workspaceRoot } from "./workspace.js";
import type { Message } from "./types.js";

export interface Session {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  provider?: string;
  /** Conversation without the system prompt (rebuilt fresh on load) */
  messages: Message[];
  /** What the user typed, oldest first */
  prompts: string[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  turns: number;
}

const MAX_PROMPTS = 200;

export function sessionsDir(root = workspaceRoot()): string {
  return join(root, ".xyro", "sessions");
}

export function newSessionId(): string {
  // Sorts by time, unique enough for one person's projects
  return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomBytes(3).toString("hex")}`;
}

/** Keep conversations out of git without touching the user's .gitignore. */
function excludeFromGit(root: string): void {
  try {
    const exclude = join(root, ".git", "info", "exclude");
    if (!fs.existsSync(dirname(exclude))) return;
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf-8") : "";
    if (!cur.includes(".xyro/sessions")) fs.appendFileSync(exclude, `${cur.endsWith("\n") || !cur ? "" : "\n"}.xyro/sessions/\n`);
  } catch {
    // best effort
  }
}

export function saveSession(s: Session, root = workspaceRoot()): void {
  const dir = sessionsDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  excludeFromGit(root);
  const file = join(dir, `${s.id}.json`);
  const data = { ...s, prompts: s.prompts.slice(-MAX_PROMPTS), updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
}

export function loadSession(id: string, root = workspaceRoot()): Session | null {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(join(sessionsDir(root), `${id}.json`), "utf-8")) as Session;
    return Array.isArray(s.messages) ? { ...s, prompts: s.prompts ?? [] } : null;
  } catch {
    return null;
  }
}

/** This project's sessions, newest first. */
export function listSessions(root = workspaceRoot()): SessionSummary[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(sessionsDir(root)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const f of files) {
    const s = loadSession(f.replace(/\.json$/, ""), root);
    if (s) out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, turns: s.prompts.length || s.messages.filter((m) => m.role === "user").length });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string, root = workspaceRoot()): boolean {
  if (!/^[\w-]+$/.test(id)) return false;
  try {
    fs.rmSync(join(sessionsDir(root), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

/** A short title from the first prompt. */
export function titleFrom(prompt: string): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 59) + "…" : t || "New session";
}
