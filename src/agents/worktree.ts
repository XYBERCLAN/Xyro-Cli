// Git worktrees for parallel experts. Each writer in a team gets its own
// checkout, starting from the user's CURRENT state (uncommitted + untracked
// files are copied in as a private snapshot commit). When it finishes, only
// its own changes are applied back to the user's working tree (3-way), after
// checkpointing the affected files so /rewind still works. On conflict the
// worktree is kept and reported instead of losing work.

import { existsSync, mkdirSync, copyFileSync, appendFileSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { execa } from "execa";
import { recordBeforeChange } from "../agent/checkpoints.js";

export interface Worktree {
  path: string;
  branch: string;
  base: string;
}

async function git(cwd: string, args: string[], input?: string) {
  return execa("git", args, { cwd, reject: false, input, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
}

export async function isGitRepo(root = process.cwd()): Promise<boolean> {
  const r = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.exitCode === 0 && String(r.stdout).trim() === "true";
}

/** Keep .xyro/worktrees out of git status without touching the user's .gitignore. */
function excludeWorktreeDir(root: string): void {
  try {
    const exclude = join(root, ".git", "info", "exclude");
    if (!existsSync(dirname(exclude))) return;
    const cur = existsSync(exclude) ? readFileSync(exclude, "utf-8") : "";
    if (!cur.includes(".xyro/worktrees")) appendFileSync(exclude, `${cur.endsWith("\n") || !cur ? "" : "\n"}.xyro/worktrees/\n`);
  } catch {
    // best effort
  }
}

const DEP_DIRS = new Set(["node_modules", ".venv", "venv", "vendor"]);

/** Ignored dependency folders at the root and one or two levels down (monorepo packages). */
function findDependencyDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git" || e.name === ".xyro") continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (DEP_DIRS.has(e.name)) out.push(p);
      else if (depth < 2 && !e.name.startsWith(".")) walk(p, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

/**
 * Worktrees start without git-ignored folders, so tests and typecheckers
 * could not run there. Link the user's installed dependencies in (only
 * folders git ignores, and they are excluded so they are never committed or
 * merged back).
 */
export async function linkDependencies(root: string, wtPath: string): Promise<string[]> {
  const linked: string[] = [];
  for (const rel of findDependencyDirs(root)) {
    if ((await git(root, ["check-ignore", "-q", rel])).exitCode !== 0) continue;
    const dest = join(wtPath, rel);
    if (existsSync(dest)) continue;
    try {
      mkdirSync(dirname(dest), { recursive: true });
      symlinkSync(join(root, rel), dest, process.platform === "win32" ? "junction" : "dir");
      linked.push(rel);
    } catch {
      // best effort
    }
  }
  // A symlink is a file to git, so "node_modules/" patterns don't cover it: exclude the exact paths
  if (linked.length) {
    try {
      const exclude = join(root, ".git", "info", "exclude");
      const cur = existsSync(exclude) ? readFileSync(exclude, "utf-8") : "";
      const add = linked.map((l) => `/${l}`).filter((l) => !cur.split("\n").includes(l));
      if (add.length) appendFileSync(exclude, `${cur.endsWith("\n") || !cur ? "" : "\n"}${add.join("\n")}\n`);
    } catch {
      // best effort
    }
  }
  return linked;
}

export async function createWorktree(label: string, root = process.cwd()): Promise<Worktree | null> {
  const id = `${label.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-${Date.now().toString(36)}`;
  const path = join(root, ".xyro", "worktrees", id);
  const branch = `xyro/${id}`;
  mkdirSync(dirname(path), { recursive: true });
  excludeWorktreeDir(root);

  const add = await git(root, ["worktree", "add", "-q", "-b", branch, path, "HEAD"]);
  if (add.exitCode !== 0) return null;

  // Bring the user's uncommitted work along so the expert sees the real state
  const diff = await git(root, ["diff", "HEAD", "--binary"]);
  if (String(diff.stdout).trim()) await git(path, ["apply", "--whitespace=nowarn"], String(diff.stdout) + "\n");
  const untracked = String((await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout).split("\0").filter((f) => f && !f.startsWith(".xyro/worktrees/"));
  for (const f of untracked) {
    try {
      mkdirSync(dirname(join(path, f)), { recursive: true });
      copyFileSync(join(root, f), join(path, f));
    } catch {
      // skip unreadable
    }
  }
  await linkDependencies(root, path);
  await git(path, ["add", "-A"]);
  await git(path, ["-c", "user.name=XYRO", "-c", "user.email=xyro@localhost", "commit", "-q", "--allow-empty", "--no-verify", "-m", "xyro: snapshot of working tree"]);
  const base = String((await git(path, ["rev-parse", "HEAD"])).stdout).trim();
  return { path, branch, base };
}

export interface MergeResult {
  applied: boolean;
  files: string[];
  conflict?: string;
  keptAt?: string;
}

/** Apply the worktree's own changes onto the user's working tree, then clean up. */
export async function mergeWorktree(wt: Worktree, root = process.cwd()): Promise<MergeResult> {
  await git(wt.path, ["add", "-A"]);
  const patch = String((await git(wt.path, ["diff", "--cached", "--binary", wt.base])).stdout);
  const files = String((await git(wt.path, ["diff", "--cached", "--name-only", wt.base])).stdout).split("\n").filter(Boolean);

  if (!patch.trim()) {
    await removeWorktree(wt, root);
    return { applied: true, files: [] };
  }
  // Checkpoint the files we are about to change so /rewind can undo the merge
  for (const f of files) recordBeforeChange(join(root, f));

  const res = await git(root, ["apply", "--3way", "--whitespace=nowarn"], patch + "\n");
  if (res.exitCode !== 0) {
    return { applied: false, files, conflict: String(res.stderr || res.stdout).trim().slice(0, 500), keptAt: wt.path };
  }
  // --3way stages the result; leave the user's index as it was
  await git(root, ["reset", "-q", "--", ...files]);
  await removeWorktree(wt, root);
  return { applied: true, files };
}

export async function removeWorktree(wt: Worktree, root = process.cwd()): Promise<void> {
  await git(root, ["worktree", "remove", "--force", wt.path]);
  await git(root, ["branch", "-D", wt.branch]);
}
