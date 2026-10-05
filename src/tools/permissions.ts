/**
 * permissions — who may run which tool, on which paths, and for how long.
 *
 * Every tool call goes through `checkPermission`, which answers one of three
 * verdicts:
 *
 *   allow — run it
 *   deny  — refuse it, and tell the agent why
 *   ask   — a human has to decide (interactive terminals only)
 *
 * Resolution order:
 *
 *   1. Hard denies: credential files (.env, private keys, ~/.ssh, .git/…) are
 *      refused for file-mutating tools. No rule can lift them.
 *   2. User rules, persisted in `<config>/permissions.json`. Deny wins over
 *      allow, so a broad allow never defeats a targeted deny.
 *   3. Built-in defaults: read-only tools are allowed, mutating or networked
 *      tools ask.
 *
 * Outside an interactive terminal nobody can answer a prompt, so "ask" becomes
 * **deny** — silently running mutating tools in a script is how a headless run
 * rewrites files nobody was watching. `XYRO_NO_APPROVE=1` (`--no-approve`) is
 * the explicit opt-in that turns those back into allows.
 *
 * Rules are managed by the user through `/permissions`, never by the agent: a
 * tool that could grant itself permission would make every other check moot.
 */

import { isAbsolute, relative, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getConfigDir } from "../config/platform.js";
import { confirmAction } from "../ui/prompts.js";
import { isJsonMode } from "../ui/render.js";

/** Read-only / bookkeeping tools: no prompt, no rule needed. */
const ALLOW_ALWAYS = new Set([
  "read_file",
  "list_files",
  "glob",
  "search_code",
  "find_files",
  "write_todos",
  "end_turn",
  "task_completed",
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "git_pr_view",
  "revert_file",
]);

/** Mutating or networked tools: prompt in an interactive terminal. */
const ASK_ALWAYS = new Set([
  "write_file",
  "edit_file",
  "propose_write_file",
  "fetch_url",
  "run_command",
  "run_tests",
  "spawn_agent",
  "spawn_agents",
  "git_commit",
  "git_init",
  "git_push",
  "git_create_pr",
  "git_stash",
  "git_stash_pop",
  "git_checkout",
]);

/** Tools whose damage is done by the file they write. */
const FILE_MUTATING = new Set(["write_file", "edit_file", "propose_write_file"]);

/**
 * Files that must never be written through a file tool: credentials and VCS
 * internals. Patterns without a slash match a basename at any depth; a
 * leading double-star then slash pins a directory at any depth too, so a
 * nested .git is caught as well.
 */
const HARD_DENY_PATTERNS = [
  ".env",
  ".env.*",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "**/.git/**",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/.kube/**",
  "**/.docker/config.json",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
];

export type PermissionAction = "allow" | "deny";
export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRule {
  id: string;
  action: PermissionAction;
  /** Tool names, or ["*"] for every tool. */
  tools: string[];
  /** Glob patterns; empty means "any path". */
  paths: string[];
  createdAt: number;
}

export interface PermissionOutcome {
  decision: PermissionAction;
  reason?: string;
}

const WILDCARD_TOOLS = "*";

// ─── glob matching ──────────────────────────────────────────────────────

/** Translate a glob into an anchored regular expression. */
function globToRegExp(glob: string, text = false): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        // `a/**/b` must match `a/b` as well as `a/x/y/b`.
        if (glob[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        // In text mode (a shell command) there are no path separators to stop
        // at, so `*` means "anything".
        source += text ? ".*" : "[^/]*";
      }
    } else if (c === "?") {
      source += text ? "." : "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      source += `\\${c}`;
    } else {
      source += c;
    }
  }
  return new RegExp(`^${source}$`);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function stripTrailingGlobSlash(pattern: string): string {
  return pattern.endsWith("/") ? `${pattern}**` : pattern;
}

/**
 * Does `target` match `pattern`?
 *
 * - an absolute pattern is matched against the absolute path
 * - a pattern containing `/` is relative to the project root; paths outside it
 *   never match
 * - a bare pattern (`*.log`, `.env`) matches a basename at any depth
 * - `text` mode matches free text (a shell command) instead of a path, where
 *   `*` spans everything including separators
 */
export function matchesPathPattern(pattern: string, target: string, text = false): boolean {
  const clean = stripTrailingGlobSlash(pattern.trim());
  if (!clean) return true;

  const normalized = toPosix(target);

  // Free text (a shell command): no path semantics, match the whole string.
  if (text) return globToRegExp(clean, true).test(normalized);

  if (isAbsolute(clean)) {
    return globToRegExp(toPosix(clean)).test(normalized);
  }

  if (!clean.includes("/")) {
    const base = normalized.slice(normalized.lastIndexOf("/") + 1);
    return globToRegExp(clean).test(base);
  }

  const rel = toPosix(relative(process.cwd(), target));
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return globToRegExp(clean).test(rel);
}

/** Is this file one of the credential/VCS paths that tools must never write? */
export function isHardDeniedPath(absPath: string): boolean {
  return HARD_DENY_PATTERNS.some((p) => matchesPathPattern(p, absPath));
}

// ─── rule store ─────────────────────────────────────────────────────────

function rulesPath(): string {
  return resolve(getConfigDir(), "permissions.json");
}

export function loadRules(): PermissionRule[] {
  try {
    const raw = readFileSync(rulesPath(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPermissionRule).map((r) => ({ ...r, paths: r.paths ?? [], tools: r.tools ?? [] }));
  } catch {
    // No rules file yet, or it was hand-edited into something unusable: treat
    // it as "no rules" rather than blocking every tool call.
    return [];
  }
}

function isPermissionRule(value: unknown): value is PermissionRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<PermissionRule>;
  return (
    typeof r.id === "string" &&
    (r.action === "allow" || r.action === "deny") &&
    Array.isArray(r.tools) &&
    r.tools.every((t) => typeof t === "string")
  );
}

function saveRules(rules: PermissionRule[]): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(rulesPath(), `${JSON.stringify(rules, null, 2)}\n`, "utf-8");
}

let ruleCounter = 0;

function newRuleId(): string {
  ruleCounter += 1;
  return `r${Date.now().toString(36)}${ruleCounter.toString(36)}`;
}

/** Persist a new rule. Re-adding an identical rule refreshes it in place. */
export function addRule(input: {
  action: PermissionAction;
  tools: string[];
  paths?: string[];
}): PermissionRule {
  const tools = input.tools.map((t) => t.trim()).filter(Boolean);
  if (tools.length === 0) throw new Error("a rule needs at least one tool");
  const paths = (input.paths ?? []).map((p) => p.trim()).filter(Boolean);

  const rules = loadRules();
  const duplicate = rules.find(
    (r) =>
      r.action === input.action &&
      r.tools.length === tools.length &&
      r.tools.every((t) => tools.includes(t)) &&
      r.paths.length === paths.length &&
      r.paths.every((p) => paths.includes(p))
  );
  if (duplicate) return duplicate;

  const rule: PermissionRule = { id: newRuleId(), action: input.action, tools, paths, createdAt: Date.now() };
  rules.push(rule);
  saveRules(rules);
  return rule;
}

export function removeRule(id: string): boolean {
  const rules = loadRules();
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return false;
  saveRules(next);
  return true;
}

export function clearRules(): number {
  const rules = loadRules();
  saveRules([]);
  return rules.length;
}

// ─── decision ───────────────────────────────────────────────────────────

/** Pull the target path out of a tool call, whatever the tool named it. */
export function extractPath(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  for (const key of ["path", "file_path", "filePath", "target"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** What a rule's `paths` are matched against for this call. */
interface RuleTarget {
  value: string;
  /** Free text (a shell command) rather than a filesystem path. */
  text: boolean;
}

function resolveTarget(filePath: string): string {
  return isAbsolute(filePath) ? resolve(filePath) : resolve(process.cwd(), filePath);
}

/**
 * The subject of a rule's path patterns for one call: the file being written
 * for file tools, the command line for `run_command` (so a rule can forbid a
 * command), and nothing at all for the rest.
 */
function ruleTarget(name: string, args: Record<string, unknown> | undefined): RuleTarget | null {
  const filePath = extractPath(args);
  if (filePath) return { value: resolveTarget(filePath), text: false };
  if (name === "run_command" && args && typeof args.command === "string") {
    return { value: args.command, text: true };
  }
  return null;
}

function ruleMatches(rule: PermissionRule, tool: string, target: RuleTarget | null): boolean {
  const toolOk = rule.tools.includes(WILDCARD_TOOLS) || rule.tools.includes(tool);
  if (!toolOk) return false;
  if (rule.paths.length === 0) return true;
  if (!target) return false;
  return rule.paths.some((p) => matchesPathPattern(p, target.value, target.text));
}

/**
 * The verdict for one tool call, before any human is involved.
 * See the module header for the resolution order.
 */
export function evaluatePermission(
  name: string,
  args?: Record<string, unknown>
): PermissionDecision {
  const filePath = extractPath(args);
  const absPath = filePath ? resolveTarget(filePath) : null;

  if (absPath && FILE_MUTATING.has(name) && isHardDeniedPath(absPath)) {
    return "deny";
  }

  const target = ruleTarget(name, args);
  const rules = loadRules();
  if (rules.some((r) => r.action === "deny" && ruleMatches(r, name, target))) {
    return "deny";
  }
  if (rules.some((r) => r.action === "allow" && ruleMatches(r, name, target))) {
    return "allow";
  }

  if (ALLOW_ALWAYS.has(name)) return "allow";
  // Unknown tools (plugins) are trusted: they were installed by the user.
  if (ASK_ALWAYS.has(name)) return "ask";
  return "allow";
}

/** Would this call need a human? Convenience predicate over evaluatePermission. */
export function shouldAskPermission(name: string, args?: Record<string, unknown>): boolean {
  return evaluatePermission(name, args) === "ask";
}

export function canPromptUser(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && !isJsonMode();
}

/** True when the user asked for unattended runs (`--no-approve`). */
export function approvalIsPreGranted(): boolean {
  return Boolean(process.env["XYRO_NO_APPROVE"]);
}

function previewArgs(name: string, args: Record<string, unknown>): string {
  if (name === "run_command") return `executing command: ${String(args.command || "").slice(0, 80)}`;
  const filePath = extractPath(args);
  if (filePath) return `path: ${filePath}`;
  if (typeof args.url === "string") return `url: ${args.url.slice(0, 80)}`;
  if (typeof args.message === "string") return `message: ${args.message.slice(0, 80)}`;
  return "";
}

/**
 * Final verdict for a tool call. The caller must not execute the tool when the
 * decision is "deny"; `reason` is surfaced to the agent so it can adapt.
 */
export async function checkPermission(
  name: string,
  args: Record<string, unknown> = {}
): Promise<PermissionOutcome> {
  const decision = evaluatePermission(name, args);
  if (decision === "allow") return { decision: "allow" };
  if (decision === "deny") return { decision: "deny", reason: denyReason(name, args) };

  if (approvalIsPreGranted()) return { decision: "allow" };

  if (!canPromptUser()) {
    return {
      decision: "deny",
      reason:
        `${name} needs approval and this is not an interactive terminal, so it was refused. ` +
        `Ask the user to run /permissions allow ${name} (optionally with a path pattern), ` +
        `or to pass --no-approve to accept unattended runs.`,
    };
  }

  const detail = previewArgs(name, args);
  try {
    const ok = await confirmAction(`${name}${detail ? ` (${detail})` : ""}`);
    return ok ? { decision: "allow" } : { decision: "deny", reason: "the user declined this action" };
  } catch {
    // A prompt that cannot be displayed is not consent: refuse.
    return { decision: "deny", reason: `the approval prompt for ${name} could not be shown` };
  }
}

/** Why a call was refused, phrased for the agent. */
export function denyReason(name: string, args: Record<string, unknown>): string {
  const filePath = extractPath(args);
  if (filePath && FILE_MUTATING.has(name) && isHardDeniedPath(resolveTarget(filePath))) {
    return `${name} cannot write to "${filePath}": that path holds credentials or VCS internals. Pick a different location.`;
  }
  const rules = loadRules();
  const target = ruleTarget(name, args);
  const denyRule = rules.find((r) => r.action === "deny" && ruleMatches(r, name, target));
  if (denyRule) {
    const scope = denyRule.paths.length ? ` on ${denyRule.paths.join(", ")}` : "";
    return `a saved permission rule denies ${name}${scope} (rule ${denyRule.id}). Do not retry it unchanged.`;
  }
  return `${name} is not permitted.`;
}

/** Message handed to the model when a call is refused. */
export function permissionDeniedResult(name: string, reason?: string): string {
  const because = reason ? ` Reason: ${reason}` : "";
  return (
    `⛔ Tool "${name}" was not executed.${because} ` +
    `Do NOT retry this tool call unchanged: adjust your approach, choose another tool, ` +
    `or tell the user what permission is missing.`
  );
}

/** Kept for callers that only need the generic wording. */
export const PERMISSION_DENIED_RESULT = permissionDeniedResult("tool");
