/**
 * sessions — Per-project, named conversation sessions.
 *
 * Before this module, XYRO kept exactly ONE conversation file
 * (`<data dir>/session.json`) shared by every project on the machine, so
 * talking about project A leaked into project B and `--resume` could restore
 * an unrelated conversation.
 *
 * A session is a single JSON document under `<data dir>/sessions/`:
 *
 *   <sessions dir>/<id>.json
 *
 *   { id, name, projectPath, projectKey, createdAt, updatedAt, messages: [] }
 *
 * `projectKey` is a short stable hash of the project path: sessions are still
 * listed globally (so you can jump between projects) but grouped by project and
 * never mixed by accident.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Message } from "./types.js";
import { getHistoryDir } from "../config/platform.js";

export interface SessionMeta {
  id: string;
  name: string;
  projectPath: string;
  projectKey: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** On-disk shape: metadata (minus the derived `messageCount`) plus the messages. */
export type SessionFile = Omit<SessionMeta, "messageCount"> & { messages: Message[] };

export interface SessionSummary extends SessionMeta {
  /** `true` when this session belongs to the current working directory. */
  current: boolean;
}

/** Default session name when the user does not provide one. */
const DEFAULT_SESSION_NAME = "default";

/** Session name -> filesystem-safe id. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || DEFAULT_SESSION_NAME;
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
}

/** Stable short hash identifying a project directory. */
export function projectKey(projectPath: string): string {
  return createHash("sha1").update(resolve(projectPath)).digest("hex").slice(0, 12);
}

export function getSessionsDir(): string {
  return join(getHistoryDir(), "sessions");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sessionPath(id: string): string {
  return join(getSessionsDir(), `${sanitizeSegment(id)}.json`);
}

function newId(): string {
  // timestamp + random suffix: sortable by creation, collision-safe
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolve a session id from a user-supplied token: an exact id, an exact name,
 * or a case-insensitive name match. Returns null when nothing matches.
 */
export function resolveSessionId(token: string): string | null {
  const wanted = token.trim();
  if (!wanted) return null;

  const sessions = listSessions();
  if (sessions.length === 0) return null;

  const byId = sessions.find((s) => s.id === wanted);
  if (byId) return byId.id;

  const lower = wanted.toLowerCase();
  const byName = sessions.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName.id;

  const bySlug = sessions.find((s) => slugify(s.name) === lower || slugify(s.id) === lower);
  return bySlug ? bySlug.id : null;
}

function readSession(id: string): SessionFile | null {
  try {
    const file = sessionPath(id);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as SessionFile;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(data: SessionFile): void {
  const dir = getSessionsDir();
  ensureDir(dir);
  writeFileSync(sessionPath(data.id), JSON.stringify(data, null, 2), "utf-8");
}

/** Every session on this machine, newest first. Corrupted files are skipped. */
export function listSessions(): SessionSummary[] {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];

  const cwd = resolve(process.cwd());
  const currentKey = projectKey(cwd);
  const out: SessionSummary[] = [];

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.replace(/\.json$/, "");
    const full = join(dir, entry);
    try {
      if (!statSync(full).isFile()) continue;
      const parsed = JSON.parse(readFileSync(full, "utf-8")) as SessionFile;
      if (!parsed || !Array.isArray(parsed.messages)) continue;
      out.push({
        id: parsed.id || id,
        name: parsed.name || DEFAULT_SESSION_NAME,
        projectPath: parsed.projectPath || "",
        projectKey: parsed.projectKey || "",
        createdAt: parsed.createdAt || 0,
        updatedAt: parsed.updatedAt || 0,
        messageCount: parsed.messages.length,
        current: (parsed.projectKey || "") === currentKey,
      });
    } catch {
      // Corrupted session file: skip it rather than breaking the whole list.
    }
  }

  // Newest first. Timestamps have millisecond resolution, so two sessions
  // touched in the same millisecond tie: fall back to creation time and then
  // to the id so the listing never reorders itself between two calls.
  out.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * Return the id of the session for this project, creating it on first use.
 * `name` defaults to "default", so each project always has a stable home
 * session and starting XYRO twice in a row resumes where you left off.
 */
export function getOrCreateProjectSession(name?: string, projectPath?: string): string {
  const path = resolve(projectPath || process.cwd());
  const key = projectKey(path);
  const wantedName = name?.trim() || DEFAULT_SESSION_NAME;
  const lowerName = wantedName.toLowerCase();

  const existing = listSessions().find(
    (s) => s.projectKey === key && s.name.toLowerCase() === lowerName
  );
  if (existing) return existing.id;

  const now = Date.now();
  const id = newId();
  writeSession({
    id,
    name: wantedName,
    projectPath: path,
    projectKey: key,
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
  return id;
}

/** Short human label for a session: `name` plus its project folder. */
export function describeSession(s: SessionSummary): string {
  const folder = s.projectPath ? basename(s.projectPath) : "(unknown)";
  return `${s.name} — ${folder}`;
}

/**
 * Create an empty session, optionally under a name, for the current project.
 * Returns the new session id (use `getSessionMeta` to read its metadata).
 */
export function createSession(name?: string, projectPath?: string): string {
  const path = resolve(projectPath || process.cwd());
  const key = projectKey(path);
  const wantedName = name?.trim() || DEFAULT_SESSION_NAME;

  const now = Date.now();
  const id = newId();
  const data: SessionFile = {
    id,
    name: wantedName,
    projectPath: path,
    projectKey: key,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  writeSession(data);
  return id;
}

export function saveSessionMessages(
  id: string,
  messages: Message[],
  meta?: Partial<Pick<SessionMeta, "name" | "projectPath">>
): boolean {
  const existing = readSession(id);
  const now = Date.now();
  const data: SessionFile = existing
    ? {
        ...existing,
        messages,
        updatedAt: now,
        name: meta?.name ?? existing.name,
        projectPath: meta?.projectPath ?? existing.projectPath,
      }
    : {
        id,
        name: meta?.name?.trim() || DEFAULT_SESSION_NAME,
        projectPath: resolve(meta?.projectPath || process.cwd()),
        projectKey: projectKey(meta?.projectPath || process.cwd()),
        createdAt: now,
        updatedAt: now,
        messages,
      };
  writeSession(data);
  return true;
}

export function loadSessionMessages(id: string): Message[] | null {
  const data = readSession(id);
  return data ? data.messages : null;
}

export function getSessionMeta(id: string): SessionMeta | null {
  const data = readSession(id);
  return data ? toMeta(data) : null;
}

export function renameSession(id: string, name: string): boolean {
  const data = readSession(id);
  if (!data) return false;
  data.name = name.trim() || DEFAULT_SESSION_NAME;
  data.updatedAt = Date.now();
  writeSession(data);
  return true;
}

export function deleteSession(id: string): boolean {
  const file = sessionPath(id);
  if (!existsSync(file)) return false;
  try {
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Import the legacy single-file session (`<data dir>/session.json`) into the
 * new layout so upgrading users keep their previous conversation. Returns the
 * new session id, or null when there was nothing to migrate.
 */
export function migrateLegacySession(): string | null {
  const legacy = join(getHistoryDir(), "session.json");
  if (!existsSync(legacy)) return null;

  try {
    const messages = JSON.parse(readFileSync(legacy, "utf-8")) as Message[];
    if (!Array.isArray(messages) || messages.length === 0) return null;

    const cwd = resolve(process.cwd());
    const key = projectKey(cwd);
    // Don't migrate twice: if we already hold a migrated copy for this project,
    // just drop the stale legacy file.
    const already = listSessions().find((s) => s.projectKey === key && s.name === "migrated");
    if (already) {
      rmSync(legacy, { force: true });
      return already.id;
    }

    const now = Date.now();
    const id = newId();
    writeSession({
      id,
      name: "migrated",
      projectPath: cwd,
      projectKey: key,
      createdAt: now,
      updatedAt: now,
      messages,
    });
    rmSync(legacy, { force: true });
    return id;
  } catch {
    return null;
  }
}

/** Absolute path of a session file (shown by `/sessions` for debugging). */
export function getSessionFilePath(id: string): string {
  return sessionPath(id);
}

function toMeta(data: SessionFile): SessionMeta {
  return {
    id: data.id,
    name: data.name,
    projectPath: data.projectPath,
    projectKey: data.projectKey,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    messageCount: data.messages.length,
  };
}
