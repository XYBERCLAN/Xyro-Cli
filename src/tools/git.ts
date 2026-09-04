import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const GIT_TIMEOUT = 15_000;
const GIT_PUSH_TIMEOUT = 60_000; // push over HTTPS can take 20-30s

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
    // Commit using the temp file for the message, with XYRO as author
    const authorName = "XYRO";
    const authorEmail = "antigr4vity237@gmail.com";
    const result = runGit(`commit -F "${tmpFile}" --author="${authorName} <${authorEmail}>"`);
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

/**
 * git push — push committed changes to the remote repository
 */
export async function gitPush(args?: { remote?: string; branch?: string; force?: boolean }): Promise<string> {
  const remote = args?.remote || "origin";
  const branch = args?.branch || "";
  const force = args?.force ? " --force-with-lease" : "";
  const target = branch ? `${remote} ${branch}` : remote;
  const cmd = `git push${force} ${target}`;
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: GIT_PUSH_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
      cwd: process.cwd(),
    });
    return `✅ Pushed to ${remote}${branch ? ` (${branch})` : ""}\n${output.trim() || "(no output)"}`;
  } catch (err: unknown) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("timed out")) return `❌ git push timed out after ${GIT_PUSH_TIMEOUT / 1000}s`;
      return `❌ git push error: ${msg.slice(0, 300)}`;
    }
    return "❌ Unknown git push error";
  }
}

/**
 * Helper to parse owner/repo from a git remote URL
 */
function parseRepoFromRemote(remoteName: string): string | null {
  try {
    const url = execSync(`git remote get-url ${remoteName}`, {
      encoding: "utf-8",
      timeout: GIT_TIMEOUT,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/i);
    return match ? match[1].replace(/\.git$/i, "") : null;
  } catch {
    return null;
  }
}

/**
 * git create pr — open a pull request on GitHub using gh CLI
 */
export async function gitCreatePr(args?: {
  title?: string;
  body?: string;
  repo?: string;
  base?: string;
  head?: string;
  draft?: boolean;
}): Promise<string> {
  // Check if gh CLI is available
  try {
    execSync("gh --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    const target = args?.repo || parseRepoFromRemote("upstream") || parseRepoFromRemote("origin") || "repository";
    const base = args?.base || "main";
    const head = args?.head || runGit("branch --show-current") || "main";
    return `❌ GitHub CLI ('gh') is not installed or not in PATH.\nYou can create the pull request manually in your browser:\nhttps://github.com/${target}/compare/${base}...${head}?expand=1`;
  }

  // Determine target repo (prefer upstream if exists, else origin)
  const targetRepo = args?.repo || parseRepoFromRemote("upstream") || parseRepoFromRemote("origin");
  if (!targetRepo) {
    return "❌ Could not determine GitHub repository from git remotes (neither upstream nor origin found).";
  }

  const currentBranch = runGit("branch --show-current") || "main";
  const originRepo = parseRepoFromRemote("origin");
  const originOwner = originRepo ? originRepo.split("/")[0] : "";

  // If targeting an upstream fork, head should be owner:branch
  let head = args?.head;
  if (!head) {
    if (originOwner && targetRepo !== originRepo) {
      head = `${originOwner}:${currentBranch}`;
    } else {
      head = currentBranch;
    }
  }

  const base = args?.base || "main";

  // Check if a PR already exists for this branch
  try {
    const existingPrOutput = execSync(`gh pr view "${head}" --repo "${targetRepo}"`, {
      encoding: "utf-8",
      timeout: 15_000,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (existingPrOutput) {
      const urlMatch = existingPrOutput.match(/url:\s*(https:\/\/github\.com\/[^\s]+)/i);
      const prUrl = urlMatch ? urlMatch[1] : `https://github.com/${targetRepo}/pulls`;
      return `ℹ️ A pull request already exists for branch "${head}" into "${base}":\n🔗 ${prUrl}\n\nAll commits pushed to this branch are automatically synced with this pull request.\n\n${existingPrOutput.slice(0, 500)}`;
    }
  } catch {
    // No existing PR found, proceed to create
  }

  // Determine title and body
  const title = args?.title || runGit("log -1 --pretty=%s") || "Update from XYRO";
  const body = args?.body || `## Summary\n\nAutomated PR opened by XYRO agent.\n\n### Branch\n- Head: \`${head}\`\n- Base: \`${base}\`\n\n🤖 Generated with XYRO\nCo-Authored-By: XYRO <antigr4vity237@gmail.com>`;

  // Write body to a temporary file to avoid shell escaping issues
  const tmpBodyPath = path.join(os.tmpdir(), `xyro_pr_body_${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpBodyPath, body, "utf-8");

    const draftFlag = args?.draft ? " --draft" : "";
    const cleanTitle = title.replace(/"/g, "'");
    const cmd = `gh pr create --repo "${targetRepo}" --base "${base}" --head "${head}" --title "${cleanTitle}" --body-file "${tmpBodyPath}"${draftFlag}`;

    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 45_000,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return `✅ Pull request created successfully:\n${output.trim()}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    if (msg.includes("already exists")) {
      const urlMatch = msg.match(/https:\/\/github\.com\/[^\s]+/);
      const prUrl = urlMatch ? urlMatch[0] : "";
      return `ℹ️ A pull request already exists for this branch:\n${prUrl || msg}\nAll pushed commits on ${head} are automatically included.`;
    }
    return `❌ Failed to create PR: ${msg.slice(0, 300)}`;
  } finally {
    try {
      if (fs.existsSync(tmpBodyPath)) {
        fs.unlinkSync(tmpBodyPath);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * git pr view — view PR status and details
 */
export async function gitPrView(args?: { pr?: string; repo?: string }): Promise<string> {
  try {
    execSync("gh --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    return "❌ GitHub CLI ('gh') is not installed or not in PATH.";
  }

  const targetRepo = args?.repo || parseRepoFromRemote("upstream") || parseRepoFromRemote("origin");
  const repoFlag = targetRepo ? ` --repo "${targetRepo}"` : "";
  const prArg = args?.pr ? ` "${args.pr}"` : "";

  try {
    const output = execSync(`gh pr view${prArg}${repoFlag}`, {
      encoding: "utf-8",
      timeout: 30_000,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim() || "(no output)";
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return `❌ Failed to view PR: ${msg.slice(0, 300)}`;
  }
}

