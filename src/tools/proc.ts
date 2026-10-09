// Shell commands that can really be stopped.
//
// `sh -c "…"` may run the command as a child of the shell (dash on Ubuntu
// does), so killing the shell leaves the real work running. Each command gets
// its own process group on POSIX; a stop (Esc) or a timeout ends the whole
// group, and anything that ignores SIGTERM is killed 2s later.

import { execa, type Options } from "execa";
import { turnSignal } from "../agent/cancel.js";

const GRACE_MS = 2000;

export interface ShellResult {
  stdout: string;
  stderr: string;
  all: string;
  exitCode: number | undefined;
  timedOut: boolean;
  stopped: boolean;
  failed: boolean;
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal); // the whole group
  } catch {
    // already gone
  }
}

export async function runShell(command: string, opts: { cwd: string; timeoutMs: number; env?: Record<string, string>; maxBuffer?: number }): Promise<ShellResult> {
  const signal = turnSignal();
  const child = execa(command, {
    shell: true,
    cwd: opts.cwd,
    reject: false,
    all: true,
    maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    detached: process.platform !== "win32",
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  } as Options);

  let timedOut = false;
  let stopped = false;
  let grace: NodeJS.Timeout | undefined;
  const end = (why: "timeout" | "stop") => {
    if (why === "timeout") timedOut = true;
    else stopped = true;
    killGroup(child.pid, "SIGTERM");
    grace = setTimeout(() => killGroup(child.pid, "SIGKILL"), GRACE_MS);
    grace.unref();
  };
  const timer = setTimeout(() => end("timeout"), opts.timeoutMs);
  const onStop = () => end("stop");
  if (signal.aborted) onStop();
  else signal.addEventListener("abort", onStop, { once: true });

  try {
    const res = await child;
    return {
      stdout: String(res.stdout ?? ""),
      stderr: String(res.stderr ?? ""),
      all: String(res.all ?? ""),
      exitCode: res.exitCode,
      timedOut,
      stopped,
      failed: Boolean(res.failed) || timedOut || stopped,
    };
  } finally {
    clearTimeout(timer);
    if (grace && child.exitCode !== null) clearTimeout(grace);
    signal.removeEventListener("abort", onStop);
  }
}
