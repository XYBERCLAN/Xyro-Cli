import { execa } from "execa";
import { SHELL_TIMEOUT_MS } from "../config/constants.js";
import { getDangerousPatterns } from "../config/platform.js";

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
    const res = await execa({
      shell: true,
      timeout: SHELL_TIMEOUT_MS,
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
