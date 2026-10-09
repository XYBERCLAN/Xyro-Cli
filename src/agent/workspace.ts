// Workspace root per task. Normally the project directory; an expert running
// in its own git worktree gets that worktree instead — even while other
// experts run in parallel — because the root follows the async call chain.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** Directory tools should treat as the project root for the current task. */
export function workspaceRoot(): string {
  return store.getStore() ?? process.cwd();
}

/** Run `fn` (and everything it awaits) with `root` as the workspace. */
export function runInWorkspace<T>(root: string, fn: () => Promise<T>): Promise<T> {
  return store.run(root, fn);
}
