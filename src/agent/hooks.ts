// Hooks — XYRO's reflexes: shell commands that run at fixed moments,
// deterministic and outside the model's control.
//
//   ~/.config/xyro/hooks.json   (yours, always active)
//   .xyro/hooks.json            (project, active only once trusted: /hooks trust)
//
//   {
//     "PreToolUse":  [{ "matcher": "write_file|edit_file", "command": "./scripts/guard.sh" }],
//     "PostToolUse": [{ "matcher": "write_file|edit_file|multi_edit", "command": "npx prettier --write \"$XYRO_FILE\"" }],
//     "UserPromptSubmit": [], "SessionStart": [], "Stop": []
//   }
//
// Each hook receives the event as JSON on stdin and XYRO_EVENT / XYRO_TOOL /
// XYRO_FILE / XYRO_PROJECT_DIR in its environment. Exit code 2 blocks the
// action (PreToolUse, UserPromptSubmit) and stderr explains why; other output
// is passed back to the model.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { getConfigDir } from "../config/platform.js";

export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "Stop";
export const HOOK_EVENTS: HookEvent[] = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop"];

export interface HookDef {
  matcher?: string;
  command: string;
  timeout?: number;
}

type HookFile = Partial<Record<HookEvent, HookDef[]>>;

export interface HookOutcome {
  blocked: boolean;
  reason: string;
  output: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const CACHE_MS = 3000;

function projectHooksPath(root = process.cwd()): string {
  return join(root, ".xyro", "hooks.json");
}
function userHooksPath(): string {
  return join(getConfigDir(), "hooks.json");
}
function trustPath(): string {
  return join(getConfigDir(), "trusted-hooks.json");
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function hashFile(path: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

export type ProjectHookStatus = "none" | "trusted" | "untrusted";

/**
 * Project files that make XYRO run commands (.xyro/hooks.json, .xyro/mcp.json)
 * are only honoured once the user trusted that exact content. Any edit to the
 * file requires trusting it again.
 */
export function projectFileTrust(absPath: string): ProjectHookStatus {
  if (!fs.existsSync(absPath)) return "none";
  const trusted = readJson<Record<string, string>>(trustPath()) ?? {};
  return trusted[resolve(absPath)] === hashFile(absPath) ? "trusted" : "untrusted";
}

export function trustProjectFile(absPath: string): boolean {
  const h = hashFile(absPath);
  if (!h) return false;
  const trusted = readJson<Record<string, string>>(trustPath()) ?? {};
  trusted[resolve(absPath)] = h;
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(trustPath(), JSON.stringify(trusted, null, 2));
    cache = null;
    return true;
  } catch {
    return false;
  }
}

/** Project hooks run only after the user trusted this exact file content. */
export function projectHooksStatus(root = process.cwd()): ProjectHookStatus {
  return projectFileTrust(projectHooksPath(root));
}

export function trustProjectHooks(root = process.cwd()): boolean {
  return trustProjectFile(projectHooksPath(root));
}

let cache: { at: number; root: string; hooks: HookFile } | null = null;

/** Active hooks: yours, plus the project's when trusted. */
export function loadHooks(root = process.cwd()): HookFile {
  if (cache && cache.root === root && Date.now() - cache.at < CACHE_MS) return cache.hooks;
  const merged: HookFile = {};
  const sources = [readJson<HookFile>(userHooksPath())];
  if (projectHooksStatus(root) === "trusted") sources.push(readJson<HookFile>(projectHooksPath(root)));
  for (const src of sources) {
    if (!src) continue;
    for (const ev of HOOK_EVENTS) {
      const list = Array.isArray(src[ev]) ? src[ev]!.filter((h) => h && typeof h.command === "string") : [];
      if (list.length) merged[ev] = [...(merged[ev] ?? []), ...list];
    }
  }
  cache = { at: Date.now(), root, hooks: merged };
  return merged;
}

export function countHooks(): number {
  return Object.values(loadHooks()).reduce((n, l) => n + (l?.length ?? 0), 0);
}

function matches(matcher: string | undefined, tool: string | undefined): boolean {
  if (!matcher || matcher === "*" || !tool) return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

/** Run every hook for an event. Never throws. */
export async function runHooks(
  event: HookEvent,
  payload: { tool?: string; args?: Record<string, unknown>; result?: string; prompt?: string } = {}
): Promise<HookOutcome> {
  const hooks = (loadHooks()[event] ?? []).filter((h) => matches(h.matcher, payload.tool));
  const outcome: HookOutcome = { blocked: false, reason: "", output: "" };
  if (!hooks.length) return outcome;

  const file = typeof payload.args?.path === "string" ? resolve(process.cwd(), payload.args.path) : "";
  const input = JSON.stringify({ event, cwd: process.cwd(), ...payload, result: payload.result?.slice(0, 20_000) });
  const outputs: string[] = [];

  for (const h of hooks) {
    try {
      const res = await execa(h.command, {
        shell: true,
        input,
        reject: false,
        timeout: h.timeout ?? DEFAULT_TIMEOUT_MS,
        env: { XYRO_EVENT: event, XYRO_TOOL: payload.tool ?? "", XYRO_FILE: file, XYRO_PROJECT_DIR: process.cwd() },
      });
      const out = String(res.stdout ?? "").trim();
      const err = String(res.stderr ?? "").trim();
      if (res.exitCode === 2 && (event === "PreToolUse" || event === "UserPromptSubmit")) {
        outcome.blocked = true;
        outcome.reason = (err || out || `hook "${h.command}" blocked this`).slice(0, 1000);
        return outcome;
      }
      if (res.timedOut) outputs.push(`hook "${h.command}" timed out`);
      else if (res.exitCode !== 0) outputs.push(`hook "${h.command}" exited ${res.exitCode}: ${(err || out).slice(0, 600)}`);
      else if (out) outputs.push(out.slice(0, 2000));
    } catch (e) {
      outputs.push(`hook "${h.command}" failed to start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  outcome.output = outputs.join("\n");
  return outcome;
}

/** Test helper. */
export function _clearHookCache(): void {
  cache = null;
}
