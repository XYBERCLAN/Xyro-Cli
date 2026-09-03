import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
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
function getPluginDir(): string {
  return join(getConfigDir(), PLUGIN_DIR_NAME);
}

/**
 * Discover and load all plugins from the plugins directory.
 * Each plugin is a directory containing a `plugin.ts` (or `.js`) file.
 */
export async function loadPlugins(): Promise<Tool[]> {
  const pluginDir = getPluginDir();

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

      if (!pluginFile) continue;

      try {
        const plugin = await loadPlugin(pluginFile);
        if (plugin?.tools) {
          tools.push(...plugin.tools);
        }
      } catch (err) {
        console.error(`  ⚠ Failed to load plugin "${entry.name}": ${err}`);
      }
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
async function loadPlugin(filePath: string): Promise<PluginModule | null> {
  try {
    const mod = await import(filePath);
    if (mod.tools && Array.isArray(mod.tools)) {
      return {
        manifest: mod.manifest || { name: filePath },
        tools: mod.tools,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the plugin directory path (for UI display).
 */
export function getPluginDirectory(): string {
  return getPluginDir();
}
