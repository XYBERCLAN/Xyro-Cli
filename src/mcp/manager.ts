// MCP client — connects XYRO to Model Context Protocol servers (GitHub,
// databases, browsers, Sentry, …) and exposes their tools as
// `mcp__<server>__<tool>`.
//
//   ~/.config/xyro/mcp.json   (yours)
//   .xyro/mcp.json            (project — needs /mcp trust, it launches commands)
//
//   {
//     "mcpServers": {
//       "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
//                       "env": { "GITHUB_TOKEN": "…" }, "expertsOnly": true },
//       "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] },
//       "docs":       { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } },
//       "old":        { "command": "…", "disabled": true }
//     }
//   }
//
// Servers you already set up for other agents come along automatically
// (XYRO_IMPORT=off to skip): Claude Code (~/.claude.json, .mcp.json),
// Cursor (~/.cursor/mcp.json, .cursor/mcp.json), VS Code (.vscode/mcp.json)
// and Gemini CLI (~/.gemini/settings.json). Project files from any of them
// still need /mcp trust. On a name clash XYRO's own config wins.
//
// `expertsOnly` keeps a server's tools out of the main agent's context: only
// experts that declare `mcp: <server>` get them (fights context bloat).

import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getConfigDir } from "../config/platform.js";
import { registerExternalTools, unregisterExternalTools } from "../tools/registry.js";
import { projectFileTrust, trustProjectFile } from "../agent/hooks.js";
import { xyroVersion } from "../version.js";
import type { Tool } from "../agent/types.js";
import { setMcpAutoApproved, clearMcpAutoApproved } from "./approvals.js";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  expertsOnly?: boolean;
  disabled?: boolean;
  /** Tool names (as the server names them) that run without asking; "*" = all */
  autoApprove?: string[] | "*";
}

export type McpState = "connecting" | "connected" | "failed" | "disabled" | "untrusted";

export interface McpServerStatus {
  name: string;
  source: "user" | "project";
  /** Which agent's config it came from: xyro, claude, cursor, vscode, gemini */
  origin: string;
  state: McpState;
  tools: string[];
  error?: string;
  expertsOnly: boolean;
  transport: "stdio" | "http";
}

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_RESULT_CHARS = 20_000;

const servers = new Map<string, McpServerStatus>();
const clients = new Map<string, Client>();
let listener: (() => void) | null = null;

export function projectMcpPath(root = process.cwd()): string {
  return join(root, ".xyro", "mcp.json");
}
function userMcpPath(): string {
  return join(getConfigDir(), "mcp.json");
}

interface McpSource {
  path: string;
  origin: string;
  /** Top-level key holding the servers ("servers" in VS Code) */
  key?: "mcpServers" | "servers";
  /** ~/.claude.json also keeps per-project servers under projects[<root>] */
  claudeProject?: string;
}

const importEnabled = () => !/^(off|0|false|no)$/i.test(process.env.XYRO_IMPORT ?? "");

function projectSources(root: string): McpSource[] {
  const own: McpSource[] = [{ path: projectMcpPath(root), origin: "xyro" }];
  if (!importEnabled()) return own;
  return [
    ...own,
    { path: join(root, ".mcp.json"), origin: "claude" },
    { path: join(root, ".cursor", "mcp.json"), origin: "cursor" },
    { path: join(root, ".vscode", "mcp.json"), origin: "vscode", key: "servers" },
  ];
}

function userSources(root: string): McpSource[] {
  const own: McpSource[] = [{ path: userMcpPath(), origin: "xyro" }];
  if (!importEnabled()) return own;
  const home = homedir();
  return [
    ...own,
    { path: join(home, ".claude.json"), origin: "claude", claudeProject: resolve(root) },
    { path: join(home, ".cursor", "mcp.json"), origin: "cursor" },
    { path: join(home, ".gemini", "settings.json"), origin: "gemini" },
  ];
}

/** ${VAR} and ${env:VAR} (Claude Code / VS Code style) from the environment. */
function expandEnv(v: string): string {
  return v.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => process.env[name] ?? "");
}

/** Normalise one foreign server entry to XYRO's shape (null when unusable). */
function normalise(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // VS Code prompts for ${input:…} values at runtime; we can't, so skip those servers
  if (JSON.stringify(r).includes("${input:")) return null;
  const strMap = (o: unknown) =>
    o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, x]) => typeof x === "string").map(([k, x]) => [k, expandEnv(x as string)])) : undefined;
  const cfg: McpServerConfig = {
    command: typeof r.command === "string" ? expandEnv(r.command) : undefined,
    args: Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === "string").map(expandEnv) : undefined,
    env: strMap(r.env),
    url: typeof r.url === "string" ? expandEnv(r.url) : typeof r.httpUrl === "string" ? expandEnv(r.httpUrl) : undefined,
    headers: strMap(r.headers),
    expertsOnly: r.expertsOnly === true,
    disabled: r.disabled === true || r.enabled === false,
    autoApprove: r.autoApprove === "*" || Array.isArray(r.autoApprove) ? (r.autoApprove as string[] | "*") : undefined,
  };
  return cfg.command || cfg.url ? cfg : null;
}

function readSource(src: McpSource): Record<string, McpServerConfig> {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(fs.readFileSync(src.path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Record<string, McpServerConfig> = {};
  const add = (block: unknown) => {
    if (!block || typeof block !== "object") return;
    for (const [name, raw] of Object.entries(block as Record<string, unknown>)) {
      const cfg = src.origin === "xyro" ? (raw as McpServerConfig) : normalise(raw);
      if (cfg && !(name in out)) out[name] = cfg;
    }
  };
  add(j[src.key ?? "mcpServers"]);
  if (src.claudeProject) add((j.projects as Record<string, { mcpServers?: unknown }> | undefined)?.[src.claudeProject]?.mcpServers);
  return out;
}


/** Server name → safe identifier for tool names. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "server";
}

export function onMcpChange(fn: (() => void) | null): void {
  listener = fn;
}
function changed(): void {
  listener?.();
}

export function mcpStatus(): McpServerStatus[] {
  return [...servers.values()];
}

export function connectedServerCount(): number {
  return mcpStatus().filter((s) => s.state === "connected").length;
}

/** Tool names a server provides (for experts that declare `mcp: <server>`). */
export function getMcpToolNames(server: string): string[] {
  return servers.get(slug(server))?.tools ?? [];
}

/** "untrusted" when any project MCP file (XYRO's or another agent's) is not trusted yet. */
export function projectMcpTrust(root = process.cwd()): "none" | "trusted" | "untrusted" {
  const states = projectSources(root)
    .filter((s) => Object.keys(readSource(s)).length)
    .map((s) => projectFileTrust(s.path));
  if (!states.length) return "none";
  return states.includes("untrusted") ? "untrusted" : "trusted";
}

/** Trust every project MCP file as it is now (any later edit needs trusting again). */
export function trustProjectMcp(root = process.cwd()): boolean {
  const files = projectSources(root).filter((s) => Object.keys(readSource(s)).length);
  return files.length > 0 && files.every((s) => trustProjectFile(s.path));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Flatten an MCP tool result into text for the model. */
function resultText(res: { content?: unknown; isError?: boolean; structuredContent?: unknown }): string {
  const parts: string[] = [];
  for (const c of Array.isArray(res.content) ? (res.content as { type: string; text?: string; resource?: { text?: string; uri?: string }; mimeType?: string }[]) : []) {
    if (c.type === "text" && c.text) parts.push(c.text);
    else if (c.type === "resource" && c.resource) parts.push(c.resource.text ?? `[resource ${c.resource.uri ?? ""}]`);
    else if (c.type === "image") parts.push(`[image ${c.mimeType ?? ""}]`);
    else parts.push(`[${c.type}]`);
  }
  if (!parts.length && res.structuredContent) parts.push(JSON.stringify(res.structuredContent, null, 2));
  let text = parts.join("\n").trim() || "(no output)";
  if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + "\n… (truncated)";
  return res.isError ? `❌ ${text}` : text;
}

async function connectOne(name: string, cfg: McpServerConfig, source: "user" | "project", origin = "xyro"): Promise<void> {
  const id = slug(name);
  const status: McpServerStatus = {
    name,
    source,
    origin,
    state: "connecting",
    tools: [],
    expertsOnly: Boolean(cfg.expertsOnly),
    transport: cfg.url ? "http" : "stdio",
  };
  servers.set(id, status);
  changed();

  if (cfg.disabled) {
    status.state = "disabled";
    changed();
    return;
  }
  if (!cfg.command && !cfg.url) {
    status.state = "failed";
    status.error = "needs either `command` or `url`";
    changed();
    return;
  }

  const client = new Client({ name: "xyro", version: xyroVersion() });
  try {
    const transport = cfg.url
      ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers ?? {} } })
      : new StdioClientTransport({
          command: cfg.command!,
          args: cfg.args ?? [],
          env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) },
          stderr: "ignore",
        });
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "connect");
    const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "listing tools");

    const tools: Tool[] = listed.tools.map((t) => {
      const toolName = `mcp__${id}__${slug(t.name)}`;
      return {
        definition: {
          type: "function",
          function: {
            name: toolName,
            description: `[${name}] ${t.description ?? t.name}`.slice(0, 1024),
            parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
          },
        },
        execute: async (args: Record<string, unknown>) => {
          try {
            const res = await withTimeout(client.callTool({ name: t.name, arguments: args ?? {} }), CALL_TIMEOUT_MS, t.name);
            return resultText(res as never);
          } catch (e) {
            return `❌ ${name}/${t.name} failed: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      };
    });

    unregisterExternalTools(`mcp__${id}__`);
    registerExternalTools(tools, { mainVisible: !cfg.expertsOnly });
    clearMcpAutoApproved(`mcp__${id}__`);
    const auto = cfg.autoApprove === "*" ? listed.tools.map((t) => t.name) : Array.isArray(cfg.autoApprove) ? cfg.autoApprove : [];
    setMcpAutoApproved(auto.map((n) => `mcp__${id}__${slug(n)}`));
    clients.set(id, client);
    status.tools = tools.map((t) => t.definition.function.name);
    status.state = "connected";
  } catch (e) {
    status.state = "failed";
    status.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
  changed();
}

/** Connect every configured server (user + trusted project), in parallel. */
export interface DiscoveredServer {
  name: string;
  source: "user" | "project";
  origin: string;
  trusted: boolean;
  config: McpServerConfig;
}

/**
 * Every MCP server XYRO would use here. The first definition of a name wins:
 * project before user, XYRO's own files before imported ones.
 */
export function discoverMcpServers(root = process.cwd()): DiscoveredServer[] {
  const out: DiscoveredServer[] = [];
  const taken = new Set<string>();
  const add = (src: McpSource, source: "user" | "project", trusted: boolean) => {
    for (const [name, config] of Object.entries(readSource(src))) {
      if (taken.has(slug(name))) continue;
      taken.add(slug(name));
      out.push({ name, source, origin: src.origin, trusted, config });
    }
  };
  for (const src of projectSources(root)) add(src, "project", projectFileTrust(src.path) === "trusted");
  for (const src of userSources(root)) add(src, "user", true);
  return out;
}

/** Connect every configured server (yours, imported, and trusted project ones), in parallel. */
export async function connectMcpServers(root = process.cwd()): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const d of discoverMcpServers(root)) {
    if (d.trusted) jobs.push(connectOne(d.name, d.config, d.source, d.origin));
    else servers.set(slug(d.name), { name: d.name, source: d.source, origin: d.origin, state: "untrusted", tools: [], expertsOnly: Boolean(d.config.expertsOnly), transport: d.config.url ? "http" : "stdio" });
  }
  changed();
  await Promise.all(jobs);
}

/** Close every server (call on exit). */
export async function disconnectMcpServers(): Promise<void> {
  await Promise.all(
    [...clients.entries()].map(async ([id, c]) => {
      unregisterExternalTools(`mcp__${id}__`);
      try {
        await c.close();
      } catch {
        // ignore
      }
    })
  );
  clients.clear();
}

/**
 * /mcp add: a server in YOUR config (~/.config/xyro/mcp.json). `target` is a
 * URL (remote server) or a command line (local server, e.g. "npx -y @scope/server").
 */
export function addUserMcpServer(name: string, target: string): { ok: boolean; message: string } {
  const n = name.trim();
  if (!/^[A-Za-z0-9][\w.-]{0,40}$/.test(n)) return { ok: false, message: "Give the server a short name: letters, digits, - or _" };
  const t = target.trim();
  if (!t) return { ok: false, message: "Usage: /mcp add <name> <command or URL>" };
  let cfg: McpServerConfig;
  if (/^https?:\/\//i.test(t)) cfg = { url: t };
  else {
    const parts = t.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const [command, ...args] = parts.map((p) => p.replace(/^["']|["']$/g, ""));
    cfg = { command, ...(args.length ? { args } : {}) };
  }
  const p = userMcpPath();
  let file: { mcpServers?: Record<string, McpServerConfig> } = {};
  try {
    file = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    // new file
  }
  const replaced = Boolean(file.mcpServers?.[n]);
  file.mcpServers = { ...(file.mcpServers ?? {}), [n]: cfg };
  fs.mkdirSync(getConfigDir(), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(file, null, 2), { mode: 0o600 });
  return { ok: true, message: `${replaced ? "Updated" : "Added"} MCP server "${n}" (${cfg.url ?? [cfg.command, ...(cfg.args ?? [])].join(" ")}). Connecting…` };
}

/** /mcp remove: only servers in YOUR config (imported ones live in their own tool's settings). */
export function removeUserMcpServer(name: string): { ok: boolean; message: string } {
  const p = userMcpPath();
  let file: { mcpServers?: Record<string, McpServerConfig> } = {};
  try {
    file = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    // none
  }
  const key = Object.keys(file.mcpServers ?? {}).find((k) => k.toLowerCase() === name.trim().toLowerCase());
  if (!key) {
    const elsewhere = discoverMcpServers().find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
    return { ok: false, message: elsewhere ? `"${elsewhere.name}" comes from ${elsewhere.origin === "xyro" ? "this project's .xyro/mcp.json" : `your ${elsewhere.origin} settings`}; remove it there.` : `No MCP server named "${name}".` };
  }
  delete file.mcpServers![key];
  fs.writeFileSync(p, JSON.stringify(file, null, 2), { mode: 0o600 });
  return { ok: true, message: `Removed MCP server "${key}".` };
}

/** Disconnect and reconnect everything (after editing mcp.json or trusting it). */
export async function reloadMcpServers(root = process.cwd()): Promise<void> {
  await disconnectMcpServers();
  servers.clear();
  changed();
  await connectMcpServers(root);
}
