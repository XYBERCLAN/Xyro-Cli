import { join, sep, normalize, isAbsolute, resolve, relative } from "node:path";
import { homedir, platform } from "node:os";

const isWin = platform() === "win32";

/**
 * Normalize path separators to the current OS format
 */
export function normalizePath(p: string): string {
  return normalize(p);
}

/**
 * Convert backslashes to forward slashes (for display/LLM output)
 */
export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Convert forward slashes to OS-native separators (for fs operations)
 */
export function toNativeSep(p: string): string {
  if (!isWin) return p;
  return p.replace(/\//g, "\\");
}

/**
 * Get the platform-appropriate config directory
 * - Windows: %APPDATA%/xyro
 * - macOS/Linux: ~/.config/xyro (XDG convention)
 */
export function getConfigDir(): string {
  if (isWin) {
    const appData = process.env["APPDATA"] || join(homedir(), "AppData", "Roaming");
    return join(appData, "xyro");
  }
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || join(homedir(), ".config");
  return join(base, "xyro");
}

/**
 * Get the platform-appropriate history file path
 * - Windows: %LOCALAPPDATA%/xyro/history.json
 * - macOS/Linux: ~/.local/share/xyro/history.json (XDG data convention)
 */
export function getHistoryDir(): string {
  if (isWin) {
    const localAppData = process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local");
    return join(localAppData, "xyro");
  }
  const xdg = process.env["XDG_DATA_HOME"];
  const base = xdg || join(homedir(), ".local", "share");
  return join(base, "xyro");
}

/**
 * Check if a path is a child of a directory (cross-platform)
 */
export function isChildOf(child: string, parent: string): boolean {
  const rel = relative(normalize(parent), normalize(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Compare paths case-insensitively on Windows, case-sensitively on Unix
 */
export function pathEquals(a: string, b: string): boolean {
  if (isWin) {
    return normalize(a).toLowerCase() === normalize(b).toLowerCase();
  }
  return a === b;
}

/**
 * Check if a path segment matches an ignored directory name
 */
export function isIgnoredDir(entryName: string, ignoredDirs: Set<string>): boolean {
  if (isWin) {
    return ignoredDirs.has(entryName.toLowerCase());
  }
  return ignoredDirs.has(entryName);
}

/**
 * Get platform-specific dangerous command patterns
 */
export function getDangerousPatterns(): { unix: string[]; windows: string[] } {
  return {
    unix: [
      "rm -rf /",
      "mkfs",
      "dd if=",
      "> /dev/sd",
      ":(){ :|:& };:",
      "chmod -R 000 /",
      "mv / /dev/null",
    ],
    windows: [
      "del /s /q",
      "format ",
      "rd /s /q",
      "rmdir /s /q",
      "icacls \\\\",
      "takeown /f \\\\",
      "cipher /w:\\\\",
      "diskpart",
      "bcdedit",
    ],
  };
}

/**
 * Get the shell to use based on platform
 */
export function getDefaultShell(): string | undefined {
  // undefined = let Node.js pick the platform default
  // (cmd.exe on Windows, /bin/sh on Unix)
  return undefined;
}

/**
 * Check if running on Windows
 */
export { isWin as isWindows };
