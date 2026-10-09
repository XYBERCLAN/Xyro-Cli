// Privacy shield — secrets and personal data never leave your machine.
//
// Before a request goes to a remote model, API keys, tokens, passwords,
// private keys, connection-string passwords, card numbers and email addresses
// are swapped for stable placeholders like [[XYRO_SECRET_1]]. The model works
// with the placeholders; on the way back XYRO puts the real values in again —
// in the streamed text and in tool arguments — so a file the model edits keeps
// its real key. The mapping lives only in this process. An audit log records
// what kinds of data were withheld (counts, never values):
//   ~/.config/xyro/privacy-audit.jsonl
//
// Local models (localhost) are not shielded: nothing leaves the machine.
// Turn off with XYRO_PRIVACY=off or /privacy off.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import type { Message } from "../agent/types.js";

export type PrivacyKind = "SECRET" | "KEY" | "PASSWORD" | "CARD" | "EMAIL";

const PLACEHOLDER = /\[\[XYRO_(SECRET|KEY|PASSWORD|CARD|EMAIL)_(\d+)\]\]/g;

const toPlaceholder = new Map<string, string>();
const toValue = new Map<string, string>();
const counters: Record<PrivacyKind, number> = { SECRET: 0, KEY: 0, PASSWORD: 0, CARD: 0, EMAIL: 0 };
const sessionTotals: Record<PrivacyKind, number> = { SECRET: 0, KEY: 0, PASSWORD: 0, CARD: 0, EMAIL: 0 };

let enabledOverride: boolean | null = null;
let shieldLocal = false;

export function privacyEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  return !/^(off|0|false|no)$/i.test(process.env.XYRO_PRIVACY ?? "");
}

export function setPrivacyEnabled(on: boolean): void {
  enabledOverride = on;
}

/** Remote endpoints only: a model on this machine sees nothing new. */
export function shouldShield(baseURL: string | undefined): boolean {
  if (!privacyEnabled()) return false;
  if (shieldLocal) return true;
  if (!baseURL) return true;
  try {
    const h = new URL(baseURL).hostname;
    return !(h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".localhost"));
  } catch {
    return true;
  }
}

function placeholderFor(value: string, kind: PrivacyKind, seen: Record<PrivacyKind, number>): string {
  let p = toPlaceholder.get(value);
  if (!p) {
    p = `[[XYRO_${kind}_${++counters[kind]}]]`;
    toPlaceholder.set(value, p);
    toValue.set(p, value);
  }
  seen[kind]++;
  return p;
}

// Well-known token formats
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj|or-v1|svcacct)-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9]{32,}\b/g,
  /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bgsk_[A-Za-z0-9]{40,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// scheme://user:password@host
const CONN_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi;
// NAME=value / name: "value" for secret-looking names
const ASSIGNMENT = /\b([A-Za-z0-9_]*(?:secret|token|passw(?:or)?d|pwd|api_?key|apikey|private_?key|access_?key|auth_?key|client_?secret)(?:s|_[A-Za-z0-9_]*)?)(["']?\s*[:=]\s*)(["'`]?)([^\s"'`,;#)}]{6,})\3/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Your own keys: saved provider keys and secret-looking environment values. */
function knownSecrets(): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) {
    if (v && v.length >= 12 && /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && !/\s/.test(v)) out.add(v);
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(join(getConfigDir(), "config.json"), "utf-8")) as { apiKey?: string; providerKeys?: Record<string, string> };
    for (const v of [cfg.apiKey, ...Object.values(cfg.providerKeys ?? {})]) if (v && v.length >= 12) out.add(v);
  } catch {
    // no config
  }
  return [...out].sort((a, b) => b.length - a.length);
}

let knownCache: { at: number; list: string[] } | null = null;
function known(): string[] {
  if (!knownCache || Date.now() - knownCache.at > 5000) knownCache = { at: Date.now(), list: knownSecrets() };
  return knownCache.list;
}

const isPlaceholder = (s: string) => s.startsWith("[[XYRO_");
// Code, not a literal: process.env.X, ${X}, req.body.password, getToken()
const looksLikeCode = (s: string) => /^(?:process\.env|import\.meta|\$\{|\$[A-Z_]|<|%|\{\{)|^[a-z_$][\w$]*(?:\.[\w$]+)+$|\(|^[\d.]+$/.test(s) || /^(?:true|false|null|undefined|none|string|number|required|optional|changeme|password|secret|token)$/i.test(s);

/** Redact one string. `seen` collects what was withheld. */
export function redactText(text: string, seen: Record<PrivacyKind, number> = { SECRET: 0, KEY: 0, PASSWORD: 0, CARD: 0, EMAIL: 0 }): string {
  if (!text) return text;
  let s = text.replace(PRIVATE_KEY, (m) => placeholderFor(m, "KEY", seen));
  for (const v of known()) {
    if (s.includes(v)) s = s.split(v).join(placeholderFor(v, "SECRET", seen));
  }
  for (const re of TOKEN_PATTERNS) s = s.replace(re, (m) => placeholderFor(m, "SECRET", seen));
  s = s.replace(CONN_PASSWORD, (_m, pre: string, pw: string, at: string) => (isPlaceholder(pw) || /^\$\{?|^<|^\*+$/.test(pw) ? _m : pre + placeholderFor(pw, "PASSWORD", seen) + at));
  s = s.replace(ASSIGNMENT, (m, name: string, sep: string, q: string, value: string) => {
    if (isPlaceholder(value) || looksLikeCode(value)) return m;
    // Unquoted values only count for env-style names (API_KEY=...), so code like `token = getToken` is left alone
    if (!q && name !== name.toUpperCase()) return m;
    return `${name}${sep}${q}${placeholderFor(value, /passw|pwd/i.test(name) ? "PASSWORD" : "SECRET", seen)}${q}`;
  });
  s = s.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/^(\d)\1+$/.test(digits) ? placeholderFor(m, "CARD", seen) : m;
  });
  s = s.replace(EMAIL, (m) => (/@(?:example\.(?:com|org|net)|test\.com|localhost)$|noreply|no-reply|@users\.noreply\.github\.com$/i.test(m) ? m : placeholderFor(m, "EMAIL", seen)));
  return s;
}

/** Put the real values back. Unknown placeholders are left untouched. */
export function restoreText(text: string): string;
export function restoreText(text: string | null): string | null;
export function restoreText(text: string | null): string | null {
  if (!text || !text.includes("[[XYRO_")) return text;
  return text.replace(PLACEHOLDER, (m) => toValue.get(m) ?? m);
}

/** Redacted copies of the messages; the originals (with real values) stay local. */
export function redactMessages(messages: Message[], provider: string): Message[] {
  const seen: Record<PrivacyKind, number> = { SECRET: 0, KEY: 0, PASSWORD: 0, CARD: 0, EMAIL: 0 };
  const out = messages.map((m) => {
    const copy: Message = { ...m };
    if (typeof m.content === "string") copy.content = redactText(m.content, seen);
    else if (Array.isArray(m.content)) {
      copy.content = (m.content as Array<{ type?: string; text?: string }>).map((p) => (p && typeof p.text === "string" ? { ...p, text: redactText(p.text, seen) } : p)) as unknown as string;
    }
    if (m.tool_calls?.length) {
      copy.tool_calls = m.tool_calls.map((tc) => (tc?.function ? { ...tc, function: { ...tc.function, arguments: redactText(tc.function.arguments ?? "", seen) } } : tc));
    }
    return copy;
  });
  audit(provider, seen);
  return out;
}

/** Restore placeholders in a model response (text and tool arguments). */
export function restoreResponse<T extends { content: string | null; tool_calls: unknown[] }>(res: T): T {
  return {
    ...res,
    content: restoreText(res.content),
    tool_calls: res.tool_calls.map((tc) => {
      const t = tc as { function?: { arguments?: string } };
      return t?.function ? { ...t, function: { ...t.function, arguments: restoreText(t.function.arguments ?? "") } } : tc;
    }),
  };
}

/**
 * Streaming restore: a placeholder can arrive split across chunks, so text
 * from an unfinished "[[" is held back until it closes (or clearly isn't one).
 */
export function restoringStream(emit: (chunk: string) => void): { push: (chunk: string) => void; flush: () => void } {
  let pending = "";
  return {
    push(chunk: string) {
      pending += chunk;
      let cut = pending.length;
      const open = pending.lastIndexOf("[[");
      if (open !== -1 && !pending.slice(open).includes("]]") && pending.length - open < 32) cut = open;
      else if (pending.endsWith("[")) cut = pending.length - 1;
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (ready) emit(restoreText(ready));
    },
    flush() {
      if (pending) emit(restoreText(pending));
      pending = "";
    },
  };
}

function audit(provider: string, seen: Record<PrivacyKind, number>): void {
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  if (!total) return;
  for (const k of Object.keys(seen) as PrivacyKind[]) sessionTotals[k] += seen[k];
  const counts = Object.fromEntries(Object.entries(seen).filter(([, n]) => n > 0));
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.appendFileSync(join(getConfigDir(), "privacy-audit.jsonl"), JSON.stringify({ at: new Date().toISOString(), provider: provider || "unknown", withheld: counts }) + "\n");
  } catch {
    // best effort
  }
}

export interface PrivacyStatus {
  enabled: boolean;
  /** Distinct values withheld this session, per kind */
  distinct: Record<PrivacyKind, number>;
  /** Occurrences withheld across all requests this session */
  occurrences: Record<PrivacyKind, number>;
  auditPath: string;
}

export function privacyStatus(): PrivacyStatus {
  return { enabled: privacyEnabled(), distinct: { ...counters }, occurrences: { ...sessionTotals }, auditPath: join(getConfigDir(), "privacy-audit.jsonl") };
}

/** Test helpers. */
export function _resetPrivacy(opts: { shieldLocal?: boolean } = {}): void {
  toPlaceholder.clear();
  toValue.clear();
  for (const k of Object.keys(counters) as PrivacyKind[]) {
    counters[k] = 0;
    sessionTotals[k] = 0;
  }
  enabledOverride = null;
  knownCache = null;
  shieldLocal = Boolean(opts.shieldLocal);
}
