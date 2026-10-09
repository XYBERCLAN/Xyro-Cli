import { simpleGit, SimpleGit } from "simple-git";
import { execa } from "execa";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const git: SimpleGit = simpleGit({
  baseDir: process.cwd(),
  timeout: { block: 30_000 },
});

const GIT_PUSH_TIMEOUT = 60_000;

/**
 * git status — show working tree status
 */
export async function gitStatus(): Promise<string> {
  try {
    const status = await git.status();
    const branch = status.current || "main";
    const files = [
      ...status.not_added.map((f) => `?? ${f}`),
      ...status.created.map((f) => `A  ${f}`),
      ...status.modified.map((f) => ` M ${f}`),
      ...status.deleted.map((f) => ` D ${f}`),
      ...status.renamed.map((f) => ` R ${f.from} -> ${f.to}`),
    ];
    const summary = files.length > 0 ? files.join("\n") : "(clean working tree)";
    return `🌿 Branch: ${branch}\n${summary}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git diff — show unstaged changes
 */
export async function gitDiff(): Promise<string> {
  try {
    const summary = await git.diffSummary();
    const fullDiff = await git.diff();
    const stat = `${summary.changed} files changed, ${summary.insertions} insertions(+), ${summary.deletions} deletions(-)`;
    return `${stat}\n\n${fullDiff}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git log — show recent commits
 */
export async function gitLog(args?: { count?: number }): Promise<string> {
  const count = args?.count || 10;
  try {
    const log = await git.log({ maxCount: count });
    return log.all.map((c) => `${c.hash.slice(0, 7)} ${c.message}`).join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
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

  const fullMessage = args.message.trim() + XYRO_FOOTER;

  try {
    await git.add("-A");
    const commitResult = await git.commit(fullMessage, undefined, {
      "--author": "XYRO <antigr4vity237@gmail.com>",
    });
    return `[${commitResult.branch || "main"} ${commitResult.commit || "HEAD"}] ${args.message.trim()}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git branch — list branches or create a new one
 */
export async function gitBranch(args?: { name?: string }): Promise<string> {
  try {
    if (args?.name) {
      await git.checkoutLocalBranch(args.name);
      return `✅ Created and switched to branch: ${args.name}`;
    }
    const branchSummary = await git.branch(["-v"]);
    return Object.values(branchSummary.branches)
      .map((b) => `${b.current ? "* " : "  "}${b.name.padEnd(20)} ${b.commit}`)
      .join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git checkout — switch branches
 */
export async function gitCheckout(args: { branch: string }): Promise<string> {
  if (!args.branch) return "❌ Branch name is required";
  try {
    await git.checkout(args.branch);
    return `Switched to branch '${args.branch}'`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git init — initialize a new repository
 */
export async function gitInit(): Promise<string> {
  try {
    await git.init();
    return "Initialized empty Git repository";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git stash — stash working tree changes
 */
export async function gitStash(): Promise<string> {
  try {
    const res = await git.stash();
    return res || "Saved working directory and index state";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git stash pop — apply stashed changes
 */
export async function gitStashPop(): Promise<string> {
  try {
    const res = await git.stash(["pop"]);
    return res || "Dropped refs/stash@{0}";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git error: ${msg.slice(0, 300)}`;
  }
}

/**
 * git push — push committed changes to the remote repository
 */
export async function gitPush(args?: { remote?: string; branch?: string; force?: boolean }): Promise<string> {
  const remote = args?.remote || "origin";
  const branch = args?.branch || "";
  const pushOptions = args?.force ? ["--force-with-lease"] : [];
  try {
    await git.push(remote, branch || undefined, pushOptions);
    return `✅ Pushed to ${remote}${branch ? ` (${branch})` : ""}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ git push error: ${msg.slice(0, 300)}`;
  }
}

/**
 * Helper to parse owner/repo from a git remote URL
 */
async function parseRepoFromRemote(remoteName: string): Promise<string | null> {
  try {
    const url = (await git.raw(["remote", "get-url", remoteName])).trim();
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
    await execa({ timeout: 5000, reject: true })`gh --version`;
  } catch {
    const target = args?.repo || (await parseRepoFromRemote("upstream")) || (await parseRepoFromRemote("origin")) || "repository";
    const base = args?.base || "main";
    let head = "main";
    try { head = (await git.raw(["branch", "--show-current"])).trim() || "main"; } catch { /* ignore */ }
    return `❌ GitHub CLI ('gh') is not installed or not in PATH.\nYou can create the pull request manually in your browser:\nhttps://github.com/${target}/compare/${base}...${head}?expand=1`;
  }

  // Determine target repo (prefer upstream if exists, else origin)
  const targetRepo = args?.repo || (await parseRepoFromRemote("upstream")) || (await parseRepoFromRemote("origin"));
  if (!targetRepo) {
    return "❌ Could not determine GitHub repository from git remotes (neither upstream nor origin found).";
  }

  let currentBranch = "main";
  try { currentBranch = (await git.raw(["branch", "--show-current"])).trim() || "main"; } catch { /* ignore */ }
  const originRepo = await parseRepoFromRemote("origin");
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
    const existingRes = await execa({ timeout: 15_000, reject: false })`gh pr view ${head} --repo ${targetRepo}`;
    const existingPrOutput = existingRes.stdout?.trim();
    if (existingPrOutput) {
      const urlMatch = existingPrOutput.match(/url:\s*(https:\/\/github\.com\/[^\s]+)/i);
      const prUrl = urlMatch ? urlMatch[1] : `https://github.com/${targetRepo}/pulls`;
      return `ℹ️ A pull request already exists for branch "${head}" into "${base}":\n🔗 ${prUrl}\n\nAll commits pushed to this branch are automatically synced with this pull request.\n\n${existingPrOutput.slice(0, 500)}`;
    }
  } catch {
    // No existing PR found, proceed to create
  }

  // Determine title and body
  let defaultTitle = "Update from XYRO";
  try {
    defaultTitle = (await git.raw(["log", "-1", "--pretty=%s"])).trim() || defaultTitle;
  } catch { /* ignore */ }

  const title = args?.title || defaultTitle;
  const body = args?.body || `## Summary\n\nAutomated PR opened by XYRO agent.\n\n### Branch\n- Head: \`${head}\`\n- Base: \`${base}\`\n\n🤖 Generated with XYRO\nCo-Authored-By: XYRO <antigr4vity237@gmail.com>`;

  // Write body to a temporary file to avoid shell escaping issues
  const tmpBodyPath = path.join(os.tmpdir(), `xyro_pr_body_${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpBodyPath, body, "utf-8");

    const ghArgs = [
      "pr", "create",
      "--repo", targetRepo,
      "--base", base,
      "--head", head,
      "--title", title,
      "--body-file", tmpBodyPath,
    ];
    if (args?.draft) ghArgs.push("--draft");

    const res = await execa({ timeout: 45_000, reject: false })("gh", ghArgs);
    if (res.failed) {
      const msg = res.stderr || res.stdout || "Unknown error";
      if (msg.includes("already exists")) {
        const urlMatch = msg.match(/https:\/\/github\.com\/[^\s]+/);
        const prUrl = urlMatch ? urlMatch[0] : "";
        return `ℹ️ A pull request already exists for this branch:\n${prUrl || msg}\nAll pushed commits on ${head} are automatically included.`;
      }
      return `❌ Failed to create PR: ${msg.slice(0, 300)}`;
    }

    return `✅ Pull request created successfully:\n${res.stdout.trim()}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
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
    await execa({ timeout: 5000, reject: true })`gh --version`;
  } catch {
    return "❌ GitHub CLI ('gh') is not installed or not in PATH.";
  }

  const targetRepo = args?.repo || (await parseRepoFromRemote("upstream")) || (await parseRepoFromRemote("origin"));
  const ghArgs = ["pr", "view"];
  if (args?.pr) ghArgs.push(args.pr);
  if (targetRepo) ghArgs.push("--repo", targetRepo);

  try {
    const res = await execa({ timeout: 30_000, reject: false })("gh", ghArgs);
    if (res.failed) {
      const msg = res.stderr || res.stdout || "Error";
      return `❌ Failed to view PR: ${msg.slice(0, 300)}`;
    }
    return res.stdout.trim() || "(no output)";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Failed to view PR: ${msg.slice(0, 300)}`;
  }
}


function gitError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `❌ git error: ${msg.slice(0, 300)}`;
}

export async function gitAdd(args?: { files?: string[] }): Promise<string> {
  try {
    await git.add(args?.files && args.files.length > 0 ? args.files : "-A");
    return `✅ Staged ${args?.files?.length ? args.files.join(", ") : "all changes"}`;
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitDiffStaged(): Promise<string> {
  try {
    const stat = await git.diff(["--cached", "--stat"]);
    const diff = await git.diff(["--cached"]);
    return diff.trim() ? `${stat.trim()}\n\n${diff}` : "(no staged changes)";
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitDiffUnstaged(): Promise<string> {
  try {
    const stat = await git.diff(["--stat"]);
    const diff = await git.diff();
    return diff.trim() ? `${stat.trim()}\n\n${diff}` : "(no unstaged changes)";
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitReset(): Promise<string> {
  try {
    await git.reset();
    return "✅ Unstaged all changes";
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitShow(args: { revision: string }): Promise<string> {
  if (!args.revision) return "❌ Revision is required";
  try {
    return (await git.show(["--no-color", args.revision])).trim() || "(no output)";
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitCreateBranch(args: { branch: string; base?: string }): Promise<string> {
  if (!args.branch) return "❌ Branch name is required";
  try {
    if (args.base) {
      await git.checkoutBranch(args.branch, args.base);
    } else {
      await git.checkoutLocalBranch(args.branch);
    }
    return `✅ Created and switched to branch ${args.branch}`;
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitPull(args?: { remote?: string; branch?: string }): Promise<string> {
  try {
    const res = await git.pull(args?.remote || "origin", args?.branch);
    return `✅ Pulled: ${res.summary.changes} changes, ${res.summary.insertions} insertions(+), ${res.summary.deletions} deletions(-)`;
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitFetch(args?: { remote?: string; prune?: boolean }): Promise<string> {
  try {
    const remote = args?.remote || "origin";
    await git.fetch(args?.prune ? [remote, "--prune"] : [remote]);
    return `✅ Fetched from ${remote}`;
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitRemote(): Promise<string> {
  try {
    const remotes = await git.getRemotes(true);
    return remotes.map((r) => `${r.name}\t${r.refs.fetch} (fetch)\n${r.name}\t${r.refs.push} (push)`).join("\n") || "(no remotes)";
  } catch (err: unknown) {
    return gitError(err);
  }
}

export async function gitRebase(args: { branch: string }): Promise<string> {
  if (!args.branch) return "❌ Branch is required";
  try {
    return (await git.rebase([args.branch])).trim() || `✅ Rebased onto ${args.branch}`;
  } catch (err: unknown) {
    return gitError(err);
  }
}

async function runGh(ghArgs: string[], emptyMsg: string, failMsg: string): Promise<string> {
  try {
    await execa({ timeout: 5000, reject: true })`gh --version`;
  } catch {
    return "❌ GitHub CLI ('gh') is not installed or not in PATH.";
  }
  const res = await execa({ timeout: 30_000, reject: false })("gh", ghArgs);
  if (res.failed) {
    return `❌ ${failMsg}: ${(res.stderr || res.stdout || "Error").slice(0, 300)}`;
  }
  return res.stdout.trim() || emptyMsg;
}

export async function gitPrList(args?: { repo?: string; state?: string }): Promise<string> {
  const ghArgs = ["pr", "list", "--state", args?.state || "open"];
  if (args?.repo) ghArgs.push("--repo", args.repo);
  return runGh(ghArgs, "(no pull requests found)", "Failed to list PRs");
}

export async function gitPrStatus(args?: { repo?: string }): Promise<string> {
  const ghArgs = ["pr", "status"];
  if (args?.repo) ghArgs.push("--repo", args.repo);
  return runGh(ghArgs, "(no PR status available)", "Failed to get PR status");
}
