import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { Tool } from "../agent/types.js";
import { getConfigDir } from "./platform.js";
import { PLUGIN_DIR_NAME } from "./constants.js";

/**
 * Plugin definition — what a plugin file must export.
 * Each plugin exports a `tools` array of Tool objects.
 */
export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
}

export interface PluginModule {
  manifest: PluginManifest;
  tools: Tool[];
}

/**
 * Get the plugins directory path.
 * - Windows: %APPDATA%/xyro/plugins/
 * - macOS/Linux: ~/.config/xyro/plugins/
 */
/** plugin name → the tool names it provides (filled by loadPlugins). */
const pluginTools = new Map<string, string[]>();

/** Tool names a loaded plugin provides (matched by manifest name or folder name). */
export function getPluginToolNames(name: string): string[] {
  return pluginTools.get(name.trim().toLowerCase()) ?? [];
}

export interface PluginStatus {
  /** Folder name in the plugins directory */
  folder: string;
  name: string;
  version?: string;
  description?: string;
  tools: string[];
  /** Why it did not load (shown in /plugins instead of printed over the UI) */
  error?: string;
}

const statuses: PluginStatus[] = [];

/** Every plugin folder found, loaded or not, with the reason when it failed. */
export function pluginStatuses(): PluginStatus[] {
  return statuses.slice();
}

/** Loaded plugins with their tools (for /experts and diagnostics). */
export function listLoadedPlugins(): { name: string; tools: string[] }[] {
  return [...pluginTools.entries()].map(([name, tools]) => ({ name, tools }));
}

function getPluginDir(): string {
  return join(getConfigDir(), PLUGIN_DIR_NAME);
}

/**
 * Discover and load all plugins from the plugins directory.
 * Each plugin is a directory containing a `plugin.ts` (or `.js`) file.
 */
export async function loadPlugins(opts: { fresh?: boolean } = {}): Promise<Tool[]> {
  const pluginDir = getPluginDir();
  statuses.length = 0;
  pluginTools.clear();

  if (!existsSync(pluginDir)) {
    return [];
  }

  const tools: Tool[] = [];

  try {
    const entries = readdirSync(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginPath = join(pluginDir, entry.name);
      const pluginFile = findPluginFile(pluginPath);

      if (!pluginFile) {
        statuses.push({ folder: entry.name, name: entry.name, tools: [], error: "no plugin.ts, plugin.js, index.ts or index.js in the folder" });
        continue;
      }

      const plugin = await loadPlugin(pluginFile, opts.fresh);
      if ("error" in plugin) {
        // Recorded for /plugins: printing here would draw over the full-screen UI
        statuses.push({ folder: entry.name, name: entry.name, tools: [], error: plugin.error });
        continue;
      }
      tools.push(...plugin.tools);
      const names = plugin.tools.map((t) => t.definition.function.name);
      pluginTools.set(entry.name.toLowerCase(), names);
      if (plugin.manifest?.name) pluginTools.set(plugin.manifest.name.toLowerCase(), names);
      statuses.push({ folder: entry.name, name: plugin.manifest?.name || entry.name, version: plugin.manifest?.version, description: plugin.manifest?.description, tools: names });
    }
  } catch {
    // Plugin directory read error — skip
  }

  return tools;
}

/**
 * Find the plugin entry file in a plugin directory.
 */
function findPluginFile(dir: string): string | null {
  const candidates = ["plugin.ts", "plugin.js", "index.ts", "index.js"];
  for (const name of candidates) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Load a single plugin from a file path.
 * Uses dynamic import for TypeScript/JavaScript plugins.
 */
async function loadPlugin(filePath: string, fresh = false): Promise<PluginModule | { error: string }> {
  try {
    // A reload must not get the module cached at start-up
    const url = pathToFileURL(filePath).href + (fresh ? `?v=${Date.now()}` : "");
    const mod = await import(url);
    if (!Array.isArray(mod.tools)) return { error: "it does not export a `tools` array" };
    const bad = mod.tools.find((t: Tool) => !t?.definition?.function?.name || typeof t.execute !== "function");
    if (bad) return { error: "a tool is missing definition.function.name or execute()" };
    return { manifest: mod.manifest || { name: filePath }, tools: mod.tools };
  } catch (e) {
    return { error: `failed to load: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200)}` };
  }
}

/**
 * Get the plugin directory path (for UI display).
 */
export function getPluginDirectory(): string {
  return getPluginDir();
}
