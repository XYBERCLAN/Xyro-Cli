// Background shell jobs: start a dev server, a watcher or a long build, keep
// working, and read its output later. Every job is stopped when XYRO exits.

import { execa, ResultPromise } from "execa";
import { isDangerousCommand } from "./shell.js";
import { workspaceRoot } from "../agent/workspace.js";

interface Job {
  id: number;
  name: string;
  command: string;
  proc: ResultPromise;
  output: string;
  startedAt: number;
  exitCode: number | null;
  done: boolean;
}

const MAX_OUTPUT = 200_000;
const jobs = new Map<number, Job>();
let nextId = 1;

function append(job: Job, chunk: string): void {
  job.output += chunk;
  if (job.output.length > MAX_OUTPUT) job.output = job.output.slice(-MAX_OUTPUT);
}

function status(j: Job): string {
  const secs = Math.round((Date.now() - j.startedAt) / 1000);
  return j.done ? `exited ${j.exitCode ?? "?"} after ${secs}s` : `running ${secs}s`;
}

function tail(text: string, lines: number): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(-lines).join("\n").trim();
}

export async function bgStart(args: { command: string; name?: string }): Promise<string> {
  const command = (args.command || "").trim();
  if (!command) return "❌ bg_start: `command` is required.";
  if (isDangerousCommand(command)) return "❌ Refused to execute dangerous command";

  const proc = execa(command, { shell: true, cwd: workspaceRoot(), reject: false, all: true, buffer: false, env: { ...process.env, FORCE_COLOR: "0" } });
  const job: Job = { id: nextId++, name: args.name || command.slice(0, 40), command, proc, output: "", startedAt: Date.now(), exitCode: null, done: false };
  jobs.set(job.id, job);
  proc.all?.on("data", (d: Buffer) => append(job, d.toString()));
  void proc.then((r) => {
    job.done = true;
    job.exitCode = r.exitCode ?? null;
  });

  // Give it a moment so early errors (bad command, port in use) show up now
  await new Promise((r) => setTimeout(r, 1500));
  const first = tail(job.output, 15);
  return `Started background job #${job.id} (${job.name}) — ${status(job)}.${first ? `\nFirst output:\n${first}` : ""}\nUse bg_output to read more, bg_stop to end it.`;
}

export async function bgOutput(args: { id: number; tail_lines?: number }): Promise<string> {
  const job = jobs.get(Number(args.id));
  if (!job) return `❌ No background job #${args.id}. Running: ${[...jobs.keys()].join(", ") || "none"}`;
  const out = tail(job.output, Math.max(5, Math.min(args.tail_lines ?? 50, 400)));
  return `Job #${job.id} (${job.name}) — ${status(job)}\n${out || "(no output yet)"}`;
}

export async function bgStop(args: { id: number }): Promise<string> {
  const job = jobs.get(Number(args.id));
  if (!job) return `❌ No background job #${args.id}.`;
  if (!job.done) {
    job.proc.kill("SIGTERM");
    const killer = setTimeout(() => job.proc.kill("SIGKILL"), 3000);
    await Promise.race([job.proc.then(() => undefined), new Promise((r) => setTimeout(r, 3500))]);
    clearTimeout(killer);
  }
  jobs.delete(job.id);
  return `Stopped job #${job.id} (${job.name}).\nLast output:\n${tail(job.output, 10) || "(none)"}`;
}

export async function bgList(): Promise<string> {
  if (!jobs.size) return "No background jobs.";
  return [...jobs.values()].map((j) => `#${j.id} ${j.name} — ${status(j)}`).join("\n");
}

/** Stop every job (called on exit). */
export function stopAllBackgroundJobs(): void {
  for (const j of jobs.values()) if (!j.done) j.proc.kill("SIGTERM");
  jobs.clear();
}

process.once("exit", stopAllBackgroundJobs);
