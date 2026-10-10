import { isAbsolute, resolve, relative, dirname, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { workspaceRoot } from "../agent/workspace.js";

/**
 * Resolve a user-supplied path and ensure it stays inside the current working
 * directory (the "project root" the agent operates in). Blocks `../` traversal,
 * symlink escapes at the string level, and absolute paths outside the workspace.
 *
 * Returns `{ ok: true, path }` on success, or `{ ok: false, message }` with a
 * user-facing error string on refusal.
 */
/** Folders outside the project the user allowed XYRO to read this session. */
const approvedReadRoots: string[] = [];

/** The user said yes to reading this folder (and everything in it) for the rest of the session. */
export function approveOutsideRead(dir: string): void {
  const real = realOrSelf(resolve(dir));
  if (!approvedReadRoots.includes(real)) approvedReadRoots.push(real);
}

export function _resetOutsideReads(): void {
  approvedReadRoots.length = 0;
}

/** Is this path outside the project (after following symlinks) and not in a folder the user allowed? */
export function isOutsideProject(filePath: string): boolean {
  const cwd = workspaceRoot();
  const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const rel = relative(realOrSelf(cwd), realOfNearest(abs));
  return (rel.startsWith("..") || isAbsolute(rel)) && !insideApprovedRead(abs);
}

function insideApprovedRead(absPath: string): boolean {
  const real = realOfNearest(absPath);
  return approvedReadRoots.some((root) => {
    const rel = relative(root, real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/**
 * `mode: "read"` also accepts folders the user approved for reading this
 * session; writes always stay inside the project.
 */
export function resolveProjectPath(filePath: string, mode: "read" | "write" = "write"): { ok: true; path: string } | { ok: false; message: string } {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { ok: false, message: `❌ Invalid path: "${filePath}"` };
  }

  const cwd = workspaceRoot();
  const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  if (mode === "read" && insideApprovedRead(absPath)) return { ok: true, path: absPath };
  const rel = relative(cwd, absPath);

  if (rel === "" ) {
    return { ok: true, path: absPath };
  }

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      message: `❌ Path is outside the project directory (${cwd}): "${filePath}". XYRO only reads outside the project when the user asks for it.`,
    };
  }

  // A symlink inside the project can point anywhere: compare real locations too
  const realRel = relative(realOrSelf(cwd), realOfNearest(absPath));
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    return { ok: false, message: `❌ Path leads outside the project through a symlink: "${filePath}"` };
  }

  return { ok: true, path: absPath };
}

function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Real path of `p`, resolving its nearest existing ancestor (for files not created yet). */
function realOfNearest(p: string): string {
  let cur = p;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return p;
    cur = parent;
  }
  return join(realOrSelf(cur), relative(cur, p));
}