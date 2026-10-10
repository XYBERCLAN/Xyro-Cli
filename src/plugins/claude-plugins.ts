// Claude Code plugins in XYRO — added the same way Claude Code adds them.
//
//   /plugin marketplace add anthropics/some-marketplace     (GitHub owner/repo, git URL or local folder)
//   /plugin marketplace list | remove <name>
//   /plugin install <plugin>@<marketplace>
//   /plugin uninstall <plugin> · /plugin list
//   (also from the shell: xyro plugin …)
//
// A marketplace is a repository with .claude-plugin/marketplace.json listing
// plugins. A plugin bundles skills/, agents/, commands/ and .mcp.json; XYRO
// uses all four: skills join /skills, agents join the expert team, commands
// become slash commands, MCP servers connect like your own. Plugin hooks are
// not run (they execute shell commands on every tool call).
//
//   ~/.config/xyro/plugin-marketplaces.json   known marketplaces
//   ~/.config/xyro/marketplaces/<name>/       their checkout
//   ~/.config/xyro/claude-plugins/<name>/     installed plugins
//   ~/.config/xyro/claude-plugins.json        what is installed, from where

import * as fs from "node:fs";
import { join, resolve, basename, isAbsolute } from "node:path";
import { execa } from "execa";
import { getConfigDir } from "../config/platform.js";
import { parseFrontmatter, invalidateSkillCache } from "../agents/skills-catalog.js";

export interface MarketplaceEntry {
  name: string;
  /** What the user added: owner/repo, a git URL or a folder */
  source: string;
  dir: string;
  addedAt: string;
}

export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version?: string;
  description?: string;
  dir: string;
  installedAt: string;
}

export interface PluginContents {
  skills: string[];
  agents: string[];
  commands: string[];
  mcpServers: string[];
  hooks: boolean;
}

const SAFE_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;

const marketsFile = () => join(getConfigDir(), "plugin-marketplaces.json");
const installedFile = () => join(getConfigDir(), "claude-plugins.json");
const marketsDir = () => join(getConfigDir(), "marketplaces");
export const pluginsRoot = () => join(getConfigDir(), "claude-plugins");

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(p: string, v: unknown): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

export function listMarketplaces(): MarketplaceEntry[] {
  return Object.values(readJson<Record<string, MarketplaceEntry>>(marketsFile(), {}));
}

export function listInstalled(): InstalledPlugin[] {
  return Object.values(readJson<Record<string, InstalledPlugin>>(installedFile(), {})).filter((p) => fs.existsSync(p.dir));
}

/** owner/repo → GitHub URL; URLs and folders as given. */
export function gitUrlFor(source: string): string | null {
  const s = source.trim().replace(/\/+$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !fs.existsSync(s)) return `https://github.com/${s}.git`;
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(s)) return s;
  return null;
}

async function fetchInto(source: string, dest: string): Promise<string | null> {
  fs.rmSync(dest, { recursive: true, force: true });
  const url = gitUrlFor(source);
  if (url) {
    const r = await execa("git", ["clone", "--depth", "1", "--quiet", url, dest], { reject: false, timeout: 120_000 });
    return r.exitCode === 0 ? null : `git clone failed: ${String(r.stderr || r.stdout).trim().split("\n").at(-1)?.slice(0, 200)}`;
  }
  const local = resolve(source.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (!fs.existsSync(local)) return `no such repository or folder: ${source}`;
  fs.cpSync(local, dest, { recursive: true, filter: (p) => !p.includes(`${"/"}.git${"/"}`) && basename(p) !== ".git" });
  return null;
}

interface MarketplaceJson {
  name?: string;
  plugins?: { name: string; source: string | { source?: string; repo?: string; url?: string; path?: string }; description?: string; version?: string }[];
}

function readMarketplace(dir: string): MarketplaceJson | null {
  return readJson<MarketplaceJson | null>(join(dir, ".claude-plugin", "marketplace.json"), null);
}

export async function addMarketplace(source: string): Promise<string> {
  if (!source.trim()) return "❌ Usage: /plugin marketplace add <owner/repo | git url | folder>";
  fs.mkdirSync(marketsDir(), { recursive: true });
  const tmp = join(marketsDir(), `.incoming-${Date.now()}`);
  const err = await fetchInto(source, tmp);
  if (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return `❌ Could not add the marketplace: ${err}`;
  }
  const mj = readMarketplace(tmp);
  if (!mj?.plugins?.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return "❌ That repository has no .claude-plugin/marketplace.json listing plugins.";
  }
  const name = (mj.name || basename(source).replace(/\.git$/, "")).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const dir = join(marketsDir(), name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  const all = readJson<Record<string, MarketplaceEntry>>(marketsFile(), {});
  all[name] = { name, source, dir, addedAt: new Date().toISOString() };
  writeJson(marketsFile(), all);
  return `✅ Added marketplace "${name}" with ${mj.plugins.length} plugin${mj.plugins.length === 1 ? "" : "s"}: ${mj.plugins.map((p) => p.name).join(", ").slice(0, 300)}\nInstall one with /plugin install <plugin>@${name}`;
}

export function removeMarketplace(name: string): string {
  const all = readJson<Record<string, MarketplaceEntry>>(marketsFile(), {});
  if (!all[name]) return `❌ No marketplace named "${name}".`;
  fs.rmSync(all[name].dir, { recursive: true, force: true });
  delete all[name];
  writeJson(marketsFile(), all);
  return `✅ Removed marketplace "${name}" (installed plugins stay; /plugin uninstall removes them).`;
}

/** What a marketplace offers (for /plugin browse). */
export function marketplacePlugins(): { marketplace: string; name: string; description?: string; version?: string }[] {
  return listMarketplaces().flatMap((m) => (readMarketplace(m.dir)?.plugins ?? []).map((p) => ({ marketplace: m.name, name: p.name, description: p.description, version: p.version })));
}

export function pluginContents(dir: string): PluginContents {
  const list = (sub: string, pick: (f: string) => boolean) => {
    try {
      return fs.readdirSync(join(dir, sub)).filter(pick);
    } catch {
      return [];
    }
  };
  const mcp = readJson<{ mcpServers?: Record<string, unknown> }>(join(dir, ".mcp.json"), {});
  return {
    skills: list("skills", (f) => fs.existsSync(join(dir, "skills", f, "SKILL.md"))),
    agents: list("agents", (f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
    commands: list("commands", (f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
    mcpServers: Object.keys(mcp.mcpServers ?? {}),
    hooks: fs.existsSync(join(dir, "hooks", "hooks.json")),
  };
}

export async function installPlugin(spec: string): Promise<string> {
  const [pluginName, marketName] = spec.trim().split("@");
  if (!pluginName) return "❌ Usage: /plugin install <plugin>@<marketplace>";
  // The name becomes a folder: never a path (a marketplace could list "../../something")
  if (!SAFE_NAME.test(pluginName)) return `❌ "${pluginName}" is not a valid plugin name.`;
  const markets = listMarketplaces();
  const candidates = markets.filter((m) => !marketName || m.name === marketName);
  if (!candidates.length) return markets.length ? `❌ No marketplace named "${marketName}". Known: ${markets.map((m) => m.name).join(", ")}` : "❌ Add a marketplace first: /plugin marketplace add <owner/repo>";
  let found: { market: MarketplaceEntry; entry: NonNullable<MarketplaceJson["plugins"]>[number] } | null = null;
  for (const m of candidates) {
    const e = readMarketplace(m.dir)?.plugins?.find((p) => p.name === pluginName);
    if (e) {
      found = { market: m, entry: e };
      break;
    }
  }
  if (!found) return `❌ No plugin "${pluginName}"${marketName ? ` in ${marketName}` : " in your marketplaces"}. See /plugin browse`;

  const dest = join(pluginsRoot(), pluginName);
  const src = found.entry.source;
  let err: string | null = null;
  if (typeof src === "string" && !gitUrlFor(src)) {
    // A folder inside the marketplace ("./plugins/foo")
    const from = resolve(found.market.dir, src);
    if (!isPathInside(from, found.market.dir) || !fs.existsSync(from) || !isPathInside(fs.realpathSync(from), fs.realpathSync(found.market.dir))) return "❌ That plugin's folder points outside its marketplace.";
    err = await fetchInto(from, dest);
  } else {
    const remote = typeof src === "string" ? src : src.repo ?? src.url ?? "";
    err = await fetchInto(remote, dest);
    if (!err && typeof src === "object" && src.path) {
      // A sub-folder of the downloaded repository: it must stay inside it
      const inner = resolve(dest, src.path);
      if (isAbsolute(src.path) || src.path.split(/[\\/]/).includes("..") || !isPathInside(inner, dest) || inner === resolve(dest) || !fs.existsSync(inner) || !isPathInside(fs.realpathSync(inner), fs.realpathSync(dest))) {
        fs.rmSync(dest, { recursive: true, force: true });
        return `❌ ${pluginName}'s folder points outside its repository.`;
      }
      const tmp = `${dest}.inner`;
      fs.renameSync(inner, tmp);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
    }
  }
  if (err) return `❌ Could not install ${pluginName}: ${err}`;

  const manifest = readJson<{ version?: string; description?: string }>(join(dest, ".claude-plugin", "plugin.json"), {});
  const all = readJson<Record<string, InstalledPlugin>>(installedFile(), {});
  all[pluginName] = {
    name: pluginName,
    marketplace: found.market.name,
    version: manifest.version ?? found.entry.version,
    description: manifest.description ?? found.entry.description,
    dir: dest,
    installedAt: new Date().toISOString(),
  };
  writeJson(installedFile(), all);
  invalidateSkillCache();
  const c = pluginContents(dest);
  const parts = [
    c.skills.length && `${c.skills.length} skill${c.skills.length === 1 ? "" : "s"}`,
    c.agents.length && `${c.agents.length} agent${c.agents.length === 1 ? "" : "s"} (now experts)`,
    c.commands.length && `commands ${c.commands.map((x) => `/${x}`).join(" ")}`,
    c.mcpServers.length && `MCP server${c.mcpServers.length === 1 ? "" : "s"} ${c.mcpServers.join(", ")}`,
  ].filter(Boolean);
  return `✅ Installed ${pluginName}${all[pluginName].version ? ` v${all[pluginName].version}` : ""} from ${found.market.name}: ${parts.join(", ") || "nothing XYRO can use"}${c.hooks ? "\n(its hooks are not run by XYRO)" : ""}`;
}

export function uninstallPlugin(name: string): string {
  if (!SAFE_NAME.test(name)) return `❌ "${name}" is not a valid plugin name.`;
  const all = readJson<Record<string, InstalledPlugin>>(installedFile(), {});
  if (!all[name]) return `❌ "${name}" is not installed. /plugin list shows what is.`;
  fs.rmSync(all[name].dir, { recursive: true, force: true });
  delete all[name];
  writeJson(installedFile(), all);
  invalidateSkillCache();
  return `✅ Uninstalled ${name}.`;
}

// ─── what installed plugins add to XYRO ─────────────────────────────────────

/** Skill folders of installed plugins (scanned by /skills and the experts). */
export function pluginSkillDirs(): string[] {
  return listInstalled().map((p) => join(p.dir, "skills")).filter((d) => fs.existsSync(d));
}

/** Agent folders of installed plugins (loaded as experts). */
export function pluginAgentDirs(): string[] {
  return listInstalled().map((p) => join(p.dir, "agents")).filter((d) => fs.existsSync(d));
}

/** MCP servers of installed plugins, with ${CLAUDE_PLUGIN_ROOT} pointing at the plugin. */
export function pluginMcpServers(): { name: string; plugin: string; config: Record<string, unknown> }[] {
  const out: { name: string; plugin: string; config: Record<string, unknown> }[] = [];
  for (const p of listInstalled()) {
    const raw = readJson<{ mcpServers?: Record<string, Record<string, unknown>> }>(join(p.dir, ".mcp.json"), {});
    for (const [name, cfg] of Object.entries(raw.mcpServers ?? {})) {
      const text = JSON.stringify(cfg).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, p.dir.replace(/\\/g, "\\\\"));
      out.push({ name, plugin: p.name, config: JSON.parse(text) });
    }
  }
  return out;
}

export interface PluginCommand {
  name: string;
  plugin: string;
  description: string;
  body: string;
}

/** Slash commands from installed plugins (commands/<name>.md; $ARGUMENTS = what follows). */
export function pluginCommands(): PluginCommand[] {
  const out: PluginCommand[] = [];
  for (const p of listInstalled()) {
    const dir = join(p.dir, "commands");
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const { fields, body } = parseFrontmatter(fs.readFileSync(join(dir, f), "utf-8"));
        out.push({ name: f.replace(/\.md$/, ""), plugin: p.name, description: fields.description ?? "", body: body.trim() });
      } catch {
        // unreadable command file
      }
    }
  }
  return out;
}

/** The prompt a plugin command sends, or null when `text` is not one. Accepts /name and /plugin:name. */
export function expandPluginCommand(text: string): string | null {
  const m = text.trim().match(/^\/([\w.-]+)(?::([\w.-]+))?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const [, a, b, args = ""] = m;
  const cmd = pluginCommands().find((c) => (b ? c.plugin === a && c.name === b : c.name === a));
  if (!cmd) return null;
  return cmd.body.includes("$ARGUMENTS") ? cmd.body.replace(/\$ARGUMENTS/g, args.trim()) : `${cmd.body}${args.trim() ? `\n\n${args.trim()}` : ""}`;
}

export function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || (c.startsWith(p + "/") && !isAbsolute(c.slice(p.length + 1)));
}
