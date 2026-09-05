import { isAbsolute, resolve, relative } from "node:path";

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

  const cwd = process.cwd();
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

  return { ok: true, path: absPath };
}