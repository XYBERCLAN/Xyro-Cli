// Learning — XYRO gets better at working for YOU.
//
// Two halves, kept apart on purpose:
//
// 1. OBSERVE (cheap, always on, local). While working, XYRO writes small
//    evidence events to a journal: what you ask for, when you correct it
//    ("no, use pnpm"), when you praise a result, when you /rewind, which tool
//    errors it hit and how it recovered, which actions you refused.
//
// 2. REFLECT (occasional). After enough new evidence (or on /learn), a model
//    reads the journal and proposes lessons. Code — not the model — decides
//    what is kept, by evidence:
//      - About you (profile, all projects): only patterns seen at least twice.
//      - About this project (lessons in XYRO.md): an error it recovered from,
//        a correction or a rewind is enough; anything else needs two sightings.
//      - Skills: only a reusable procedure seen working in two separate
//        sessions. Never a skill from a single success or from guesswork.
//    Every claim must cite the journal events behind it; uncited claims are
//    dropped. Skills learned this way then live by their track record
//    (skill-stats): if they stop working, they stop being used.
//
// Everything stays on this machine (~/.config/xyro/learning/), secrets are
// redacted before anything is written, reflection goes through the privacy
// shield. /profile shows what XYRO learned about you, /forget erases it,
// XYRO_LEARN=off turns learning off.

import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { workspaceRoot } from "./workspace.js";
import { redactText } from "../providers/privacy.js";
import { discoverSkills, invalidateSkillCache } from "../agents/skills-catalog.js";

export type LearnKind = "request" | "correction" | "praise" | "rewind" | "recovered" | "tool_error" | "denied" | "turn";

export interface LearnEvent {
  id: string;
  at: string;
  project: string;
  session: string;
  kind: LearnKind;
  text?: string;
  tool?: string;
  detail?: string;
  category?: string;
}

const SESSION = Date.now().toString(36);
const MAX_JOURNAL = 3000;
const REFLECT_MIN_EVENTS = 20;
const REFLECT_MIN_INTERVAL_MS = 30 * 60_000;
const MAX_PROFILE = 15;
const MAX_LESSONS = 30;
const LESSONS_START = "<!-- xyro:lessons:start -->";
const LESSONS_END = "<!-- xyro:lessons:end -->";

export function learningEnabled(): boolean {
  return !/^(off|0|false|no)$/i.test(process.env.XYRO_LEARN ?? "");
}

function dir(): string {
  return join(getConfigDir(), "learning");
}
const journalPath = () => join(dir(), "journal.jsonl");
const profilePath = () => join(dir(), "profile.json");
const statePath = () => join(dir(), "state.json");

/** Stable project key: folder name + short hash of its path. */
export function projectKey(root = workspaceRoot()): string {
  return `${basename(root)}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;
}

let seq = 0;
const clean = (s: string | undefined, n = 300) => (s ? redactText(s.replace(/\s+/g, " ").trim()).slice(0, n) : undefined);

/** Append one evidence event (never throws, never blocks long). */
export function recordEvent(e: { kind: LearnKind; text?: string; tool?: string; detail?: string; category?: string }): void {
  if (!learningEnabled()) return;
  const ev: LearnEvent = {
    id: `${SESSION}-${++seq}`,
    at: new Date().toISOString(),
    project: projectKey(),
    session: SESSION,
    kind: e.kind,
    ...(e.text ? { text: clean(e.text) } : {}),
    ...(e.tool ? { tool: e.tool } : {}),
    ...(e.detail ? { detail: clean(e.detail, 400) } : {}),
    ...(e.category ? { category: e.category } : {}),
  };
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(journalPath(), JSON.stringify(ev) + "\n");
  } catch {
    // best effort
  }
}

export function readJournal(): LearnEvent[] {
  try {
    return fs
      .readFileSync(journalPath(), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as LearnEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is LearnEvent => Boolean(e));
  } catch {
    return [];
  }
}

// ─── classifying what the user says ────────────────────────────────────────

const CORRECTION = /^(?:no\b|nope\b|nah\b|not (?:that|this|like that)|don'?t\b|do not\b|stop\b|wrong\b|undo\b|revert\b|i said\b|i told you\b|that'?s (?:not|wrong)|why (?:did|do) you\b|you (?:forgot|broke|missed|ignored)\b)|\binstead\b|\bnot what i\b|\bi (?:asked|wanted) (?:for|you to)\b/i;
const PRAISE = /^(?:thanks|thank you|thx|ty\b|perfect|great|awesome|nice|good job|well done|excellent|love it|that works|it works|exactly)\b/i;

export function classifyMessage(text: string): "correction" | "praise" | null {
  const t = text.trim();
  if (t.length > 400) return null;
  if (CORRECTION.test(t)) return "correction";
  if (PRAISE.test(t)) return "praise";
  return null;
}

// ─── profile & lessons (what the prompt sees) ──────────────────────────────

export interface ProfileItem {
  text: string;
  evidence: number;
  updated: string;
}

export function readProfile(): ProfileItem[] {
  try {
    return (JSON.parse(fs.readFileSync(profilePath(), "utf-8")) as { items?: ProfileItem[] }).items ?? [];
  } catch {
    return [];
  }
}

function writeProfile(items: ProfileItem[]): void {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(profilePath(), JSON.stringify({ items }, null, 2));
}

/** "About the user" block for the system prompt (small, capped). */
export function profilePrompt(): string {
  if (!learningEnabled()) return "";
  const items = readProfile();
  if (!items.length) return "";
  const body = items.map((i) => `- ${i.text}`).join("\n").slice(0, 1800);
  return `## How this user works (learned from past sessions; follow it unless they say otherwise)\n${body}`;
}

function xyroMdPath(root = workspaceRoot()): string {
  return join(root, "XYRO.md");
}

export function readLessons(root = workspaceRoot()): string[] {
  try {
    const t = fs.readFileSync(xyroMdPath(root), "utf-8");
    const a = t.indexOf(LESSONS_START);
    const b = t.indexOf(LESSONS_END);
    if (a === -1 || b === -1) return [];
    return t
      .slice(a + LESSONS_START.length, b)
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("_"));
  } catch {
    return [];
  }
}

/** Replace XYRO's managed lessons block in XYRO.md, leaving everything else as the user wrote it. */
function writeLessons(lessons: string[], root = workspaceRoot()): void {
  const p = xyroMdPath(root);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "# XYRO.md\n\nProject memory for XYRO and its experts.\n";
  const block = `${LESSONS_START}\n## Lessons learned\n_Kept by XYRO from evidence in past sessions. Edit or delete freely._\n${lessons.map((l) => `- ${l}`).join("\n")}\n${LESSONS_END}`;
  const a = cur.indexOf(LESSONS_START);
  const b = cur.indexOf(LESSONS_END);
  const next = a !== -1 && b !== -1 ? cur.slice(0, a) + block + cur.slice(b + LESSONS_END.length) : `${cur.trimEnd()}\n\n${block}\n`;
  fs.writeFileSync(p, next);
}

// ─── reflection ────────────────────────────────────────────────────────────

interface ReflectState {
  lastId?: string;
  lastAt?: number;
}

function readState(): ReflectState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf-8")) as ReflectState;
  } catch {
    return {};
  }
}

function writeState(s: ReflectState): void {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s));
}

function unreflected(): LearnEvent[] {
  const all = readJournal();
  const { lastId } = readState();
  if (!lastId) return all;
  const i = all.findIndex((e) => e.id === lastId);
  return i === -1 ? all : all.slice(i + 1);
}

export function reflectionDue(now = Date.now()): boolean {
  if (!learningEnabled()) return false;
  const { lastAt = 0 } = readState();
  return unreflected().length >= REFLECT_MIN_EVENTS && now - lastAt >= REFLECT_MIN_INTERVAL_MS;
}

export interface ReflectProposal {
  profile?: { text: string; keep?: boolean; evidence?: string[] }[];
  lessons?: { text: string; evidence?: string[] }[];
  skills?: { name: string; description: string; body: string; evidence?: string[] }[];
}

export interface ReflectResult {
  profileAdded: string[];
  profileKept: number;
  lessonsAdded: string[];
  skillsAdded: string[];
  rejected: string[];
  events: number;
}

/** Ask a model for proposals. Injected so tests and callers choose the model. */
export type Reflector = (system: string, user: string) => Promise<string | null>;

const SYSTEM = `You are XYRO's reflection step. You read an evidence journal of a coding agent's work for one user and propose what to remember.
Rules:
- Cite evidence: every new item lists the journal event ids ("id" field) that show it. Items without real ids are discarded.
- profile: how THIS USER works and what they want (tools they prefer, style, what annoys them, how they phrase requests, review habits). A new item needs 2+ events. To keep an existing item, repeat its exact text with "keep": true. Max 15 items. Never store personal data.
- lessons: facts about THIS PROJECT that avoid repeating mistakes (a command that fails and the one that works, a convention the user insisted on). Cite the error/correction events.
- skills: ONLY a reusable multi-step procedure that the journal shows working in at least two different sessions. Usually there is none: return [] rather than inventing one.
- Be specific and short. No generic advice ("write clean code").
Reply with JSON only: {"profile":[{"text":"…","keep":true}|{"text":"…","evidence":["id",…]}],"lessons":[{"text":"…","evidence":["id"]}],"skills":[{"name":"kebab-case","description":"when to use it","body":"markdown steps","evidence":["id","id"]}]}`;

function parseProposal(raw: string | null): ReflectProposal | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as ReflectProposal;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Run one reflection. The model only proposes; this function keeps what the
 * evidence supports and writes it.
 */
export async function reflect(ask: Reflector, opts: { force?: boolean } = {}): Promise<ReflectResult | null> {
  if (!learningEnabled()) return null;
  if (!opts.force && !reflectionDue()) return null;
  const events = unreflected().slice(-250);
  if (!events.length) return null;
  const project = projectKey();
  const byId = new Map(events.map((e) => [e.id, e]));
  const profile = readProfile();
  const lessons = readLessons();

  const payload = [
    `Current profile:\n${profile.map((p) => `- ${p.text}`).join("\n") || "(empty)"}`,
    `Current project lessons:\n${lessons.map((l) => `- ${l}`).join("\n") || "(none)"}`,
    `Journal (this project = ${project}):\n${events.map((e) => JSON.stringify({ id: e.id, kind: e.kind, session: e.session, project: e.project === project ? "this" : "other", text: e.text, tool: e.tool, detail: e.detail, category: e.category })).join("\n")}`,
  ]
    .join("\n\n")
    .slice(-24_000);

  const proposal = parseProposal(await ask(SYSTEM, payload));
  const result: ReflectResult = { profileAdded: [], profileKept: 0, lessonsAdded: [], skillsAdded: [], rejected: [], events: events.length };
  if (!proposal) return result;

  const cited = (ids: string[] | undefined) => [...new Set((ids ?? []).filter((id) => byId.has(id)))];
  const now = new Date().toISOString();

  // Profile: kept items must exist already; new ones need 2+ real events
  const nextProfile: ProfileItem[] = [];
  for (const p of proposal.profile ?? []) {
    const text = clean(p.text, 200);
    if (!text) continue;
    const existing = profile.find((x) => norm(x.text) === norm(text));
    if (p.keep && existing) {
      nextProfile.push(existing);
      result.profileKept++;
      continue;
    }
    const ev = cited(p.evidence);
    if (ev.length < 2) {
      result.rejected.push(`profile (needs 2 events): ${text}`);
      continue;
    }
    if (existing) {
      nextProfile.push({ text: existing.text, evidence: existing.evidence + ev.length, updated: now });
      result.profileKept++;
    } else {
      nextProfile.push({ text, evidence: ev.length, updated: now });
      result.profileAdded.push(text);
    }
  }
  // The model may forget to repeat old items: keep them unless it explicitly rewrote the list
  for (const old of profile) if (!nextProfile.some((x) => norm(x.text) === norm(old.text))) nextProfile.push(old);
  writeProfile(nextProfile.slice(0, MAX_PROFILE));

  // Project lessons: one strong signal (recovered error, correction, rewind) or two of anything
  const strong = new Set<LearnKind>(["recovered", "correction", "rewind", "tool_error"]);
  const nextLessons = [...lessons];
  for (const l of proposal.lessons ?? []) {
    const text = clean(l.text, 240);
    if (!text) continue;
    const ev = cited(l.evidence).filter((id) => byId.get(id)!.project === project);
    const ok = ev.some((id) => strong.has(byId.get(id)!.kind)) || ev.length >= 2;
    if (!ok) {
      result.rejected.push(`lesson (no evidence in this project): ${text}`);
      continue;
    }
    if (nextLessons.some((x) => norm(x) === norm(text))) continue;
    nextLessons.push(text);
    result.lessonsAdded.push(text);
  }
  if (result.lessonsAdded.length) writeLessons(nextLessons.slice(-MAX_LESSONS));

  // Skills: a procedure seen in 2+ sessions of this project, at most one per reflection
  for (const s of (proposal.skills ?? []).slice(0, 5)) {
    const name = String(s.name ?? "").toLowerCase().trim();
    const ev = cited(s.evidence).filter((id) => byId.get(id)!.project === project);
    const sessions = new Set(ev.map((id) => byId.get(id)!.session));
    const body = String(s.body ?? "").trim();
    const description = String(s.description ?? "").replace(/\s+/g, " ").trim();
    const why =
      !/^[a-z0-9][a-z0-9-]{1,49}$/.test(name) ? "bad name"
      : sessions.size < 2 ? "seen in fewer than 2 sessions"
      : body.length < 120 || description.length < 20 ? "too thin to reuse"
      : redactText(body) !== body ? "contains secrets"
      : discoverSkills().some((x) => x.name === name) ? "already exists"
      : result.skillsAdded.length ? "one new skill per reflection"
      : "";
    if (why) {
      result.rejected.push(`skill ${name || "?"} (${why})`);
      continue;
    }
    const skillDir = join(workspaceRoot(), ".xyro", "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nevidence: ${JSON.stringify(`learned from ${ev.length} observations across ${sessions.size} sessions`)}\nforged-by: xyro-learning\n---\n\n${body}\n`
    );
    invalidateSkillCache();
    result.skillsAdded.push(name);
  }

  writeState({ lastId: events[events.length - 1].id, lastAt: Date.now() });
  trimJournal();
  return result;
}

function trimJournal(): void {
  const all = readJournal();
  if (all.length <= MAX_JOURNAL) return;
  try {
    fs.writeFileSync(journalPath(), all.slice(-MAX_JOURNAL).map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {
    // best effort
  }
}

/** /forget: erase everything XYRO learned about you (project lessons in XYRO.md stay: they are project files). */
export function forgetEverything(): void {
  for (const p of [journalPath(), profilePath(), statePath()]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }
}

export function formatReflection(r: ReflectResult | null): string {
  if (!r) return learningEnabled() ? "Nothing new to learn from yet." : "Learning is off (XYRO_LEARN=off).";
  const parts: string[] = [`Reflected on ${r.events} event${r.events === 1 ? "" : "s"}.`];
  if (r.profileAdded.length) parts.push(`About you:\n${r.profileAdded.map((x) => `  + ${x}`).join("\n")}`);
  if (r.lessonsAdded.length) parts.push(`Project lessons (XYRO.md):\n${r.lessonsAdded.map((x) => `  + ${x}`).join("\n")}`);
  if (r.skillsAdded.length) parts.push(`New skills: ${r.skillsAdded.join(", ")}`);
  if (!r.profileAdded.length && !r.lessonsAdded.length && !r.skillsAdded.length) parts.push("Nothing met the evidence bar this time.");
  return parts.join("\n");
}
