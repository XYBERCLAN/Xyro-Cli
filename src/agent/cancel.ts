// Stopping a turn — Esc while XYRO works.
//
// One signal per user turn, shared by everything that turn starts: the model
// request (and any hedged / fallback request), retry waits, shell commands
// and test runs, experts, workers, councils and tournaments. Stopping aborts
// it; each part winds down at its next safe point and the conversation stays
// valid (unfinished tool calls are recorded as not run).

import { AsyncLocalStorage } from "node:async_hooks";

let controller = new AbortController();
interface TaskScope {
  signal: AbortSignal;
}

const scopedSignal = new AsyncLocalStorage<TaskScope>();

export class StoppedByUser extends Error {
  constructor() {
    super("Stopped by the user");
    this.name = "StoppedByUser";
  }
}

/** A fresh signal for a new user turn. */
export function beginTurn(): AbortSignal {
  controller = new AbortController();
  return controller.signal;
}

/** The current turn's signal (experts and tools read this). */
export function turnSignal(): AbortSignal {
  return scopedSignal.getStore()?.signal ?? controller.signal;
}

/** Limit a child task without cancelling its siblings or the user's turn. */
export function runWithSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return scopedSignal.run({ signal }, fn);
}

/** Stop the current turn. Returns false when nothing was running / already stopping. */
export function cancelTurn(): boolean {
  if (controller.signal.aborted) return false;
  controller.abort(new StoppedByUser());
  return true;
}

export function isStopped(): boolean {
  return turnSignal().aborted;
}

/** Throw if the user stopped the turn (use at safe points in loops). */
export function throwIfStopped(): void {
  if (turnSignal().aborted) throw turnSignal().reason ?? new StoppedByUser();
}
