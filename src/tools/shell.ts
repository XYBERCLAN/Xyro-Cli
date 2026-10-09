import { turnSignal } from "../agent/cancel.js";
import { execa } from "execa";
import { SHELL_TIMEOUT_MS } from "../config/constants.js";
import { getDangerousPatterns } from "../config/platform.js";
import { workspaceRoot } from "../agent/workspace.js";

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
    .split(/\s*(?:&&|\|\||;|\||`|\n|\$\()\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check if a command is dangerous and should be blocked.
 * Checks both Unix and Windows patterns regardless of platform
 * for defense in depth (e.g., WSL on Windows, or cross-platform scripts).
 *
 * Normalizes whitespace/slashes, inspects every `&&`/`;`/`|` segment
 * separately, and matches tokens so `rm -r -f`, `rm --recursive --force`,
 * `sudo rm -rf x` and `cd /tmp && rm -rf x` are all caught.
 */
export function isDangerousCommand(cmd: string): boolean {
  const { unix, windows } = getDangerousPatterns();
  const normalizedSegments = splitStatements(cmd).map((s) => normalizeForInspection(s));
  const allNormalized = normalizedSegments.join(" ") + "\n" + normalizeForInspection(cmd);

  // 1) Token-level detection: `rm` with recursive/force flags is always refused.
  for (const seg of normalizedSegments) {
    let tokens = seg.split(/\s+/);
    while (tokens[0] === "sudo" || tokens[0] === "doas" || tokens[0] === "command") tokens = tokens.slice(1);
    if (tokens[0] === "rm" || tokens[0]?.endsWith("/rm")) {
      const flags = tokens.slice(1).filter((t) => t.startsWith("-")).join(" ");
      if (/-[a-z]*[rf]|--recursive|--force/.test(flags)) return true;
    }
  }

  // 2) Substring match (after normalization, so spacing/slash doubling can't hide them).
  for (const pat of [...unix, ...windows]) {
    if (allNormalized.includes(pat.toLowerCase())) return true;
  }

  return false;
}

export async function runCommand(args: { command: string }): Promise<string> {
  const cmd = args.command;

  if (isDangerousCommand(cmd)) {
    return "❌ Refused to execute dangerous command";
  }

  try {
    const res = await execa({
      shell: true,
      cwd: workspaceRoot(),
      timeout: SHELL_TIMEOUT_MS,
      cancelSignal: turnSignal(),
      reject: false,
      maxBuffer: 10 * 1024 * 1024,
    })(cmd);

    if (res.timedOut) {
      return "❌ Command timed out after 30s";
    }

    if (res.failed) {
      const errOut = res.stderr?.trim() || res.stdout?.trim() || `Exit code ${res.exitCode}`;
      return `❌ ${errOut.slice(0, 500)}`;
    }

    const output = (res.stdout || "").trim();
    return output || "(Command completed with no output)";
  } catch (err: unknown) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("timed out")) {
        return "❌ Command timed out after 30s";
      }
      return `❌ ${msg.slice(0, 500)}`;
    }
    return "❌ Unknown error";
  }
}
