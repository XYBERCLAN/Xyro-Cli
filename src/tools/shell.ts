import { execSync } from "node:child_process";
import { DANGEROUS_COMMANDS, SHELL_TIMEOUT_MS } from "../config/constants.js";

export async function runCommand(args: { command: string }): Promise<string> {
  const cmd = args.command;

  for (const pattern of DANGEROUS_COMMANDS) {
    if (cmd.includes(pattern)) {
      return "❌ Refused to execute dangerous command";
    }
  }

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: SHELL_TIMEOUT_MS,
      shell: "/bin/sh",
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
