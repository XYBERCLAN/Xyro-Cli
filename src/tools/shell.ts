import { runShell } from "./proc.js";
import { execa } from "execa";
import { SHELL_TIMEOUT_MS } from "../config/constants.js";
import { getDangerousPatterns } from "../config/platform.js";
import { workspaceRoot } from "../agent/workspace.js";
import { isOutsideProject } from "./safety.js";
import { homedir } from "node:os";

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

/** Commands that look through folders (searching the disk is never XYRO's job). */
const SEARCH_COMMANDS = new Set(["find", "fd", "fdfind", "grep", "egrep", "rg", "ag", "ack", "ls", "tree", "du", "dir"]);

/**
 * The folder outside the project a search command would look through, if any.
 * `locate` and `mdfind` search the whole disk by design.
 */
export function searchOutsideProject(cmd: string): string | null {
  for (const segment of cmd.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    while (words[0] && /^(sudo|time|nice|xargs|\w+=\S*)$/.test(words[0])) words.shift();
    const prog = (words[0] ?? "").split("/").pop() ?? "";
    if (prog === "locate" || prog === "mlocate" || prog === "plocate" || prog === "mdfind") return "the whole disk";
    if (!SEARCH_COMMANDS.has(prog)) continue;
    // grep-like tools: the first plain word is the pattern ("/api" is not a folder)
    let pattern = /^(grep|egrep|rg|ag|ack)$/.test(prog) && !words.some((x) => x === "-e" || x === "-f" || x.startsWith("--regexp"));
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/^["']|["']$/g, "");
      if (prog === "find" && /^-(path|ipath|wholename|regex|iregex|name|iname)$/.test(words[i - 1] ?? "")) continue;
      if (w.startsWith("-") || w === "/dev/null") continue;
      if (pattern) {
        pattern = false;
        continue;
      }
      if (!/^(\/|~|\$HOME|\$\{HOME\}|\.\.)/.test(w)) continue;
      const p = w.replace(/^(~|\$HOME|\$\{HOME\})/, homedir());
      if (isOutsideProject(p)) return w;
    }
  }
  return null;
}

export async function runCommand(args: { command: string }): Promise<string> {
  const cmd = args.command;

  if (isDangerousCommand(cmd)) {
    return "❌ Refused to execute dangerous command";
  }

  const outside = searchOutsideProject(cmd);
  if (outside) {
    return `⛔ Not run: this searches ${outside === "the whole disk" ? outside : outside + ", which is outside the project"} (${workspaceRoot()}). XYRO only looks inside the project it runs in; search here instead.`;
  }

  try {
    const res = await runShell(cmd, { cwd: workspaceRoot(), timeoutMs: SHELL_TIMEOUT_MS });

    if (res.stopped) {
      return "⛔ Command stopped by the user";
    }

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
