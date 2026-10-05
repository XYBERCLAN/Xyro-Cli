import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const GIT_TIMEOUT = 15_000;
const GIT_PUSH_TIMEOUT = 60_000;

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
      const stderrMatch = msg.match(/stderr:\s*(.+)$/s);
      if (stderrMatch) return `❌ git error: ${stderrMatch[1].trim()}`;
      return `❌ git error: ${msg.slice(0, 300)}`;
    }
    return "❌ Unknown git error";
  }
}

function parseRepoFromRemote(remote: string): string | null {
  try {
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: "utf-8",
      timeout: 5000,
      cwd: process.cwd(),
    }).trim();
    if (!remoteUrl) return null;
    const sshMatch = remoteUrl.match(/git@github\.com:([^/]+\/[^.]+)\.git/);
    if (sshMatch) return sshMatch[1];
    const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^/]+\/[^.]+)(?:\.git)?/);
    if (httpsMatch) return httpsMatch[1];
  } catch {
    return null;
  }
  return null;
}

export async function gitStatus(): Promise<string> {
  const status = runGit("status --short");
  const branch = runGit("branch --show-current");
  return `🌿 Branch: ${branch}\n${status || "(clean working tree)"}`;
}

export async function gitDiff(): Promise<string> {
  const stat = runGit("diff --stat");
  const diff = runGit("diff");
  return (stat || "") + (stat ? "\n\n" : "") + (diff || "(no unstaged changes)");
}

export async function gitLog(args?: { count?: number }): Promise<string> {
  const count = args?.count || 10;
  return runGit(`log --oneline -n ${count}`);
}

export async function gitCommit(args: { message: string }): Promise<string> {
  if (!args.message) return "❌ Commit message is required";
  runGit("add -A");
  return runGit(`commit -m "${args.message.replace(/"/g, "'")}"`);
}

export async function gitBranch(args?: { name?: string }): Promise<string> {
  if (args?.name) {
    const result = runGit(`checkout -b ${args.name}`);
    return `✅ Created and switched to branch: ${args.name}\n${result}`;
  }
  return runGit("branch -v");
}

export async function gitCheckout(args: { branch: string }): Promise<string> {
  if (!args.branch) return "❌ Branch name is required";
  return runGit(`checkout ${args.branch}`);
}

export async function gitInit(): Promise<string> {
  return runGit("init");
}

export async function gitStash(): Promise<string> {
  return runGit("stash");
}

export async function gitStashPop(): Promise<string> {
  return runGit("stash pop");
}

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

export async function gitCreatePr(args?: {
  title?: string;
  body?: string;
  repo?: string;
  base?: string;
  head?: string;
  draft?: boolean;
}): Promise<string> {
  try {
    execSync("gh --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    return "❌ GitHub CLI ('gh') is not installed or not in PATH.";
  }

  const currentBranch = runGit("branch --show-current");
  const targetRepo = args?.repo || parseRepoFromRemote("upstream") || parseRepoFromRemote("origin");
  const base = args?.base || "main";
  const head = args?.head || currentBranch;
  const repoFlag = targetRepo ? ` --repo "${targetRepo}"` : "";

  try {
    const existingPrOutput = execSync(`gh pr view "${head}"${repoFlag} --json url`, {
      encoding: "utf-8",
      timeout: 15_000,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (existingPrOutput) {
      const urlMatch = existingPrOutput.match(/url:\s*(https:\/\/github\.com\/[^\s]+)/i);
      const prUrl = urlMatch ? urlMatch[1] : targetRepo ? `https://github.com/${targetRepo}/pulls` : "pulls";
      return `ℹ️ A pull request already exists for branch "${head}" into "${base}":\n🔗 ${prUrl}`;
    }
  } catch {
    // no existing PR
  }

  const title = args?.title || runGit("log -1 --pretty=%s") || "Update from XYRO";
  const body = args?.body || `## Summary\n\nAutomated PR opened by XYRO.\n\n🤖 Generated with XYRO`;

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
      return `ℹ️ A pull request already exists for this branch:\n${urlMatch ? urlMatch[0] : msg}`;
    }
    return `❌ Failed to create PR: ${msg.slice(0, 300)}`;
  } finally {
    try {
      if (fs.existsSync(tmpBodyPath)) fs.unlinkSync(tmpBodyPath);
    } catch {}
  }
}

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

export async function gitAdd(args: { files?: string[] }): Promise<string> {
  if (args?.files && args.files.length > 0) {
    const files = args.files.map((f) => `"${f}"`).join(" ");
    return runGit(`add ${files}`);
  }
  return runGit("add -A");
}

export async function gitDiffStaged(): Promise<string> {
  const stat = runGit("diff --cached --stat");
  const diff = runGit("diff --cached");
  return (stat || "") + (stat ? "\n\n" : "") + (diff || "(no staged changes)");
}

export async function gitDiffUnstaged(): Promise<string> {
  const stat = runGit("diff --stat");
  const diff = runGit("diff");
  return (stat || "") + (stat ? "\n\n" : "") + (diff || "(no unstaged changes)");
}

export async function gitReset(): Promise<string> {
  return runGit("reset");
}

export async function gitShow(args: { revision: string }): Promise<string> {
  if (!args.revision) return "❌ Revision is required";
  return runGit(`show --no-patch ${args.revision}`) + "\n\n" + runGit(`show --no-color ${args.revision}`);
}

export async function gitCreateBranch(args: { branch: string; base?: string }): Promise<string> {
  if (!args.branch) return "❌ Branch name is required";
  const base = args.base ? ` ${args.base}` : "";
  const result = runGit(`checkout -b ${args.branch}${base}`);
  return `✅ Created and switched to branch ${args.branch}\n${result}`;
}

export async function gitPull(args?: { remote?: string; branch?: string }): Promise<string> {
  const remote = args?.remote || "origin";
  const branch = args?.branch || runGit("branch --show-current") || "";
  const target = branch ? `${remote} ${branch}` : remote;
  return runGit(`pull ${target}`);
}

export async function gitFetch(args?: { remote?: string; prune?: boolean }): Promise<string> {
  const remote = args?.remote || "origin";
  const prune = args?.prune ? " --prune" : "";
  return runGit(`fetch ${remote}${prune}`);
}

export async function gitRemote(args?: { list?: boolean }): Promise<string> {
  return runGit("remote -v");
}

export async function gitRebase(args: { branch: string }): Promise<string> {
  if (!args.branch) return "❌ Branch is required";
  return runGit(`rebase ${args.branch}`);
}

export async function gitPrList(args?: { repo?: string; state?: string }): Promise<string> {
  try {
    execSync("gh --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    return "❌ GitHub CLI ('gh') is not installed or not in PATH.";
  }
  const repo = args?.repo;
  const state = args?.state || "open";
  const repoFlag = repo ? ` --repo "${repo}"` : "";
  const cmd = `gh pr list --state "${state}"${repoFlag}`;
  try {
    const out = execSync(cmd, { encoding: "utf-8", timeout: 30_000, cwd: process.cwd() });
    return out.trim() || "(no pull requests found)";
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return `❌ Failed to list PRs: ${msg.slice(0, 300)}`;
  }
}

export async function gitPrStatus(args?: { repo?: string }): Promise<string> {
  try {
    execSync("gh --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    return "❌ GitHub CLI ('gh') is not installed or not in PATH.";
  }
  const repo = args?.repo;
  const repoFlag = repo ? ` --repo "${repo}"` : "";
  const cmd = `gh pr status${repoFlag}`;
  try {
    const out = execSync(cmd, { encoding: "utf-8", timeout: 30_000, cwd: process.cwd() });
    return out.trim() || "(no PR status available)";
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as any).stderr || err.message : String(err);
    return `❌ Failed to get PR status: ${msg.slice(0, 300)}`;
  }
}
