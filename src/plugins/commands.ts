// The `plugin` and `mcp` commands, shared by the full-screen UI, line mode
// and the shell (xyro plugin …, xyro mcp add …). Each returns plain text.

import {
  addMarketplace, removeMarketplace, listMarketplaces, installPlugin, uninstallPlugin, listInstalled, marketplacePlugins, pluginContents,
} from "./claude-plugins.js";
import { parseMcpAdd, saveMcpServer, removeUserMcpServer, discoverMcpServers } from "../mcp/manager.js";

export const PLUGIN_HELP = `Plugins (Claude Code format):
  plugin marketplace add <owner/repo | git url | folder>
  plugin marketplace list | remove <name>
  plugin browse                      what your marketplaces offer
  plugin install <plugin>@<marketplace>
  plugin uninstall <plugin>
  plugin list                        installed plugins and what they add`;

export const MCP_HELP = `MCP servers:
  mcp add <name> -- <command> [args…]          a local server
  mcp add --transport http <name> <url>        a remote server
     options: --scope project · -e KEY=value · -H "Header: value"
  mcp remove <name>
  mcp list`;

/** Returns the text to show and whether XYRO should reload (skills, experts, MCP servers). */
export async function runPluginCommand(args: string[]): Promise<{ text: string; changed: boolean }> {
  const [sub, a, b] = args;
  if (sub === "marketplace" || sub === "marketplaces") {
    if (a === "add") return { text: await addMarketplace(b ?? ""), changed: false };
    if (a === "remove" || a === "rm") return { text: removeMarketplace(b ?? ""), changed: false };
    const ms = listMarketplaces();
    return { text: ms.length ? `Marketplaces:\n${ms.map((m) => `- ${m.name}  (${m.source})`).join("\n")}` : "No marketplaces yet. Add one: plugin marketplace add <owner/repo>", changed: false };
  }
  if (sub === "browse" || sub === "available") {
    const list = marketplacePlugins();
    return {
      text: list.length ? `Available plugins:\n${list.map((p) => `- ${p.name}@${p.marketplace}${p.version ? ` v${p.version}` : ""}${p.description ? `: ${p.description.slice(0, 100)}` : ""}`).join("\n")}\n\nInstall: plugin install <plugin>@<marketplace>` : "No marketplaces yet. Add one: plugin marketplace add <owner/repo>",
      changed: false,
    };
  }
  if (sub === "install" || sub === "add") {
    const text = await installPlugin(a ?? "");
    return { text, changed: text.startsWith("✅") };
  }
  if (sub === "uninstall" || sub === "remove" || sub === "rm") {
    const text = uninstallPlugin(a ?? "");
    return { text, changed: text.startsWith("✅") };
  }
  if (!sub || sub === "list") {
    const list = listInstalled();
    if (!list.length) return { text: `No plugins installed.\n\n${PLUGIN_HELP}`, changed: false };
    return {
      text: `Installed plugins:\n${list
        .map((p) => {
          const c = pluginContents(p.dir);
          const parts = [c.skills.length && `${c.skills.length} skills`, c.agents.length && `agents ${c.agents.join(", ")}`, c.commands.length && `commands ${c.commands.map((x) => `/${x}`).join(" ")}`, c.mcpServers.length && `MCP ${c.mcpServers.join(", ")}`].filter(Boolean);
          return `- ${p.name}${p.version ? ` v${p.version}` : ""} (from ${p.marketplace}): ${parts.join(" · ") || "nothing XYRO uses"}`;
        })
        .join("\n")}`,
      changed: false,
    };
  }
  return { text: PLUGIN_HELP, changed: false };
}

export async function runMcpCommand(args: string[], root = process.cwd()): Promise<{ text: string; changed: boolean; name?: string }> {
  const [sub, ...rest] = args;
  if (sub === "add") {
    const parsed = parseMcpAdd(rest);
    if ("error" in parsed) return { text: `❌ ${parsed.error}`, changed: false };
    return { text: `✅ ${saveMcpServer(parsed.name, parsed.config, parsed.scope, root)}`, changed: true, name: parsed.name };
  }
  if (sub === "remove" || sub === "rm") {
    const r = removeUserMcpServer(rest[0] ?? "");
    return { text: `${r.ok ? "✅" : "❌"} ${r.message}`, changed: r.ok };
  }
  if (sub === "list" || !sub) {
    const all = discoverMcpServers(root);
    return {
      text: all.length ? `MCP servers:\n${all.map((d) => `- ${d.name}  ${d.config.url ?? [d.config.command, ...(d.config.args ?? [])].join(" ")}  (from ${d.origin}${d.trusted ? "" : ", needs /mcp trust"})`).join("\n")}` : `No MCP servers.\n\n${MCP_HELP}`,
      changed: false,
    };
  }
  return { text: MCP_HELP, changed: false };
}

/** Split a command line like a shell would (quotes keep spaces). */
export function splitArgs(line: string): string[] {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((p) => p.replace(/^["']|["']$/g, ""));
}
