import { execSync } from "node:child_process";

const GIT_TIMEOUT = 15_000;

function runGit(args: string): string {
  try {
    const output = execSync(`git ${args}`, {
      encoding: "utf-8",
      timeout: GIT_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
      cwd: process.cwd(),
    });
    return output.trim() || "(no output)";
  } catch (err: unknown) {
    if (err instanceof Error) {
      const msg = err.message;
      // Extract stderr from the error
      const stderrMatch = msg.match(/stderr:\\s*(.+)$/s);
      if (stderrMatch) return `❌ git error: ${stderrMatch[1].trim()}`;
      return `❌ git error: ${msg.slice(0, 300)}`;
    }
    return "❌ Unknown git error";
  }
}

/**
 * git status — show working tree status
 */
export async function gitStatus(): Promise<string> {
  const status = runGit("status --short");
  const branch = runGit("branch --show-current");
  return `🌿 Branch: ${branch}\n${status || "(clean working tree)"}`;
}

/**
 * git diff — show unstaged changes
 */
export async function gitDiff(): Promise<string> {
  return runGit("diff --stat") + "\n\n" + runGit("diff");
}

/**
 * git log — show recent commits
 */
export async function gitLog(args?: { count?: number }): Promise<string> {
  const count = args?.count || 10;
  return runGit(`log --oneline -${count}`);
}

/**
 * XYRO footer — always appended to commit messages
 */
const XYRO_FOOTER = [
  "",
  "Assisted by XYRO",
  "",
  "🤖 Generated with XYRO",
  "Co-Authored-By: XYRO <antigr4vity237@gmail.com>",
].join("\n");

/**
 * git commit — stage all changes and commit.
 * Automatically appends the XYRO attribution footer.
 */
export async function gitCommit(args: { message: string }): Promise<string> {
  if (!args.message || !args.message.trim()) {
    return "❌ Commit message is required";
  }

  // Build full commit message with XYRO footer
  const fullMessage = args.message.trim() + XYRO_FOOTER;

  // Escape for shell — use a temp file to avoid quoting issues
  const tmpFile = ".git_commit_msg_tmp";
  const { writeFileSync, unlinkSync } = await import("node:fs");
  writeFileSync(tmpFile, fullMessage, "utf-8");

  try {
    // Stage all changes
    runGit("add -A");
    // Commit using the temp file for the message
    const result = runGit(`commit -F "${tmpFile}"`);
    return result;
  } finally {
    // Clean up temp file
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * git branch — list branches or create a new one
 */
export async function gitBranch(args?: { name?: string }): Promise<string> {
  if (args?.name) {
    // Create and switch to new branch
    const result = runGit(`checkout -b ${args.name}`);
    return `✅ Created and switched to branch: ${args.name}\n${result}`;
  }
  // List branches
  return runGit("branch -v");
}

/**
 * git checkout — switch branches
 */
export async function gitCheckout(args: { branch: string }): Promise<string> {
  if (!args.branch) return "❌ Branch name is required";
  return runGit(`checkout ${args.branch}`);
}

/**
 * git init — initialize a new repository
 */
export async function gitInit(): Promise<string> {
  return runGit("init");
}

/**
 * git stash — stash working tree changes
 */
export async function gitStash(): Promise<string> {
  return runGit("stash");
}

/**
 * git stash pop — apply stashed changes
 */
export async function gitStashPop(): Promise<string> {
  return runGit("stash pop");
}
