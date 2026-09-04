/**
 * propose_write_file — Show a diff and prompt the user for approval before writing.
 * Works like write_file but with a confirmation gate: the user can accept, reject, or
 * optionally edit in-place. On rejection the file is left untouched.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { generateDiff } from "./diff.js";

async function promptUser(question: string): Promise<string> {
  // In non-TTY mode (piped/JSON), auto-accept so sub-agents don't stall
  if (!process.stdout.isTTY || !process.stdin.isTTY) return "y";

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function proposeWriteFile(args: {
  path: string;
  content: string;
  reason?: string;
}): Promise<string> {
  const { path: filePath, content, reason } = args;

  const oldContent = existsSync(filePath)
    ? readFileSync(filePath, { encoding: "utf-8" })
    : "";

  if (oldContent === content) {
    return `✅ No changes needed for ${filePath}`;
  }

  const isNew = oldContent === "";
  const diff = isNew
    ? `[NEW FILE] ${filePath}\n+ ${content.split("\n").join("\n+ ")}`
    : generateDiff(oldContent, content, filePath);

  const header = reason ? `Reason: ${reason}\n\n` : "";
  const preview = `\n${header}Proposed changes to ${filePath}:\n${"─".repeat(60)}\n${diff}\n${"─".repeat(60)}\n`;

  process.stdout.write(preview);

  const answer = await promptUser("Apply these changes? [y/N/e(edit)]: ");

  if (answer === "y" || answer === "yes") {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    return `✅ Changes applied to ${filePath}`;
  } else if (answer === "e" || answer === "edit") {
    // Give the user a chance to type replacement content interactively
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const lines: string[] = [];
    process.stdout.write('Enter new content (type "EOF" on a new line to finish):\n');
    await new Promise<void>((resolve) => {
      rl.on("line", (line) => {
        if (line === "EOF") {
          rl.close();
          resolve();
        } else {
          lines.push(line);
        }
      });
    });
    const newContent = lines.join("\n");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, newContent, "utf-8");
    return `✅ Custom content written to ${filePath}`;
  } else {
    return `⏭️ Changes rejected — ${filePath} was not modified`;
  }
}
