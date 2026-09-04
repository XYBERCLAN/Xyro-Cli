import pc from "picocolors";
import { DIFF_MAX_LINES } from "../config/constants.js";

/**
 * Generate a simple unified diff between two strings.
 * Returns colored output for terminal display.
 */
export function generateDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diff: string[] = [];

  diff.push(pc.bold(`--- a/${filePath}`));
  diff.push(pc.bold(`+++ b/${filePath}`));

  // Simple line-by-line diff (LCS-based would be better but this is lightweight)
  const maxLen = Math.max(oldLines.length, newLines.length);
  let removed = 0;
  let added = 0;

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      continue; // unchanged line — skip for brevity
    }

    if (oldLine !== undefined && newLine === undefined) {
      removed++;
      diff.push(pc.red(`- ${oldLine}`));
    } else if (oldLine === undefined && newLine !== undefined) {
      added++;
      diff.push(pc.green(`+ ${newLine}`));
    } else {
      removed++;
      added++;
      diff.push(pc.red(`- ${oldLine}`));
      diff.push(pc.green(`+ ${newLine}`));
    }

    if (diff.length > DIFF_MAX_LINES + 2) {
      diff.push(pc.dim(`  ... ${maxLen - i - 1} more lines`));
      break;
    }
  }

  if (removed === 0 && added === 0) {
    return pc.dim("(no changes)");
  }

  diff.push(pc.dim(`\n  ${removed} removal(s), ${added} addition(s)`));
  return diff.join("\n");
}

/**
 * Generate a compact inline diff showing old → new for a replacement.
 */
export function generateInlineDiff(
  oldText: string,
  newText: string,
  filePath: string
): string {
  const lines: string[] = [];
  lines.push(pc.bold(`  ${filePath}:`));
  lines.push(pc.red(`  - ${oldText.slice(0, 120)}${oldText.length > 120 ? "..." : ""}`));
  lines.push(pc.green(`  + ${newText.slice(0, 120)}${newText.length > 120 ? "..." : ""}`));
  return lines.join("\n");
}
