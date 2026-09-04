import { execSync } from "node:child_process";
import { SHELL_TIMEOUT_MS } from "../config/constants.js";
import { getDangerousPatterns, isWindows } from "../config/platform.js";

/**
 * Check if a command is dangerous and should be blocked.
 * Checks both Unix and Windows patterns regardless of platform
 * for defense in depth (e.g., WSL on Windows, or cross-platform scripts).
 */
function isDangerousCommand(cmd: string): boolean {
  const { unix, windows } = getDangerousPatterns();
  const allPatterns = [...unix, ...windows];
  const lowerCmd = cmd.toLowerCase();
  for (const pattern of allPatterns) {
    if (lowerCmd.includes(pattern.toLowerCase())) {
      return true;
    }
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
