import { execSync } from "node:child_process";
import { SHELL_TIMEOUT_MS } from "../config/constants.js";
import { getDangerousPatterns } from "../config/platform.js";

/**
 * Normalize a shell command for safety inspection:
 * - Collapse repeated whitespace ("rm -rf  /x" === "rm -rf /x")
 * - Collapse repeated forward slashes ("//tmp" === "/tmp")
 * - Strip harmless quoting characters for pattern matching
 * - Lowercase for comparison
 */
function normalizeForInspection(cmd: string): string {
  return cmd
    .replace(/\s+/g, " ")
    .replace(/\/+/g, "/")
    .replace(/\\\s/g, " ")
    .replace(/["'`]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Split a command into its logical statements so that a dangerous command
 * hidden behind `cd dir && rm -rf x`, `true; rm -rf /`, or `a | b` is still caught.
 */
function splitStatements(cmd: string): string[] {
  return cmd
    .split(/\s*(?:&&|\|\||;|\||`|\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check if a command is dangerous and should be blocked.
 * Checks both Unix and Windows patterns regardless of platform
 * for defense in depth (e.g., WSL on Windows, or cross-platform scripts).
 *
 * Hardened: normalizes whitespace/slashes, inspects every `&&`/`;`/`|` segment
 * separately, and matches tokens so `rm -r -f`, `rm --recursive --force`,
 * `cd /tmp && rm -rf x`, and `rm -rf/tmp` all equal `rm -rf /tmp`.
 */
export function isDangerousCommand(cmd: string): boolean {
  const { unix, windows } = getDangerousPatterns();
  const allStatements = splitStatements(cmd);
  const normalizedSegments = allStatements.map((s) => normalizeForInspection(s));
  const allNormalized = normalizedSegments.join(" ");

  // 1) Token-level detection: `rm` in combination with recursive/force flags,
  //    or destructive system tools on any path, are always refused.
  for (const seg of normalizedSegments) {
    const tokens = seg.split(/\s+/);
    if (tokens[0] === "rm") {
      const flags = tokens.slice(1, 3).join(" ");
      const hasRecursive = /-.*r|--recursive/.test(flags);
      const hasForce = /-.*f|--force/.test(flags);
      if (hasRecursive || hasForce) return true;
    }
  }

  // 2) Substring match against a broad set of always-forbidden constructs
  //    (after normalization, so spacing/slash doubling can't hide them).
  const forbiddenPatterns = [
    ...unix.map((p) => p.toLowerCase()),
    ...windows.map((p) => p.toLowerCase()),
    "mkfs",
    "shutdown",
    "reboot",
    "poweroff",
    "halt",
    "init 0",
    "chmod -r 000",
    "move / /dev/null",
    "format c:",
  ];
  for (const pat of forbiddenPatterns) {
    if (allNormalized.includes(pat)) return true;
  }

  return false;
}

export async function runCommand(args: { command: string }): Promise<string> {
  const cmd = args.command;

  if (isDangerousCommand(cmd)) {
    return "❌ Refused to execute dangerous command";
  }

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.trim() || "(Command completed with no output)";
  } catch (err: unknown) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("timed out")) {
        return "❌ Command timed out after 30s";
      }
      if (msg.includes("stdout")) {
        const match = msg.match(/stdout:\s*"([^"]+)"/);
        if (match) return match[1].trim();
      }
      if (msg.includes("stderr")) {
        const match = msg.match(/stderr:\s*"([^"]+)"/);
        if (match) return `❌ stderr: ${match[1].trim()}`;
      }
      return `❌ ${msg.slice(0, 500)}`;
    }
    return "❌ Unknown error";
  }
}