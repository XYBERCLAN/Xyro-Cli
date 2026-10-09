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
export function resolveProjectPath(filePath: string): { ok: true; path: string } | { ok: false; message: string } {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { ok: false, message: `❌ Invalid path: "${filePath}"` };
  }

  const cwd = workspaceRoot();
  const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const rel = relative(cwd, absPath);

  if (rel === "" ) {
    return { ok: true, path: absPath };
  }

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      message: `❌ Path is outside the project directory (${cwd}): "${filePath}"`,
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