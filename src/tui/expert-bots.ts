// The team, animated: tiny XYRO-style robots for each expert, drawn in the
// free space at the bottom of the side panel.
//
//     ✦           working: bobs, looks around, blinks, antenna sparkles
//   ╭──B──╮       done:    happy eyes and a smile
//   │ ● ● │       failed:  crossed eyes, frown
//   ╰─────╯       idle:    dozing, a "z" drifts up
//   builder
//
// Single-width characters only (no emoji), so every terminal lays it out
// the same way. Colours come from the expert's name, so each one keeps its
// own look from turn to turn.

import { StyledSpan, span } from "./core.js";
import { currentTheme, tint } from "../ui/theme.js";

export type BotState = "running" | "ready" | "done" | "failed" | "idle";

export interface Bot {
  name: string;
  title: string;
  state: BotState;
  /** Workers show their lead's emblem in lower case */
  worker?: boolean;
  /** ms since this expert was given its task (drives the wake-up) */
  since?: number;
}

/** How long the wake-up takes before the work animation starts. */
export const WAKE_MS = 1200;

type WorkStyle = "build" | "inspect" | "hunt" | "write" | "plan" | "ship";

const STYLE: Record<string, WorkStyle> = {
  builder: "build", refactorer: "build", frontend: "build", api: "build", database: "build", migrator: "build",
  designer: "build", performance: "build", healer: "build",
  scout: "inspect", researcher: "inspect", reviewer: "inspect", security: "inspect", verifier: "inspect", sentinel: "inspect",
  tester: "hunt", debugger: "hunt",
  docs: "write", explainer: "write", "memory-keeper": "write",
  architect: "plan", critic: "plan",
  git: "ship", devops: "ship", dependencies: "ship",
};

export function workStyle(name: string): WorkStyle {
  return STYLE[name.replace(/-worker$/, "")] ?? "build";
}

const pad7 = (s: string) => (s + "       ").slice(0, 7);

/**
 * One beat of the role's work animation: what floats above the head, and
 * where the eyes look (they follow the action).
 */
export function workBeat(style: WorkStyle, beat: number): { top: string; eyes: string } {
  const b = beat % 4;
  const look = (p: number) => (p <= 1 ? "● ●  " : p >= 4 ? "  ● ●" : " ● ● ");
  switch (style) {
    case "build":
      return { top: pad7(["  ·*·", " * · *", "·  *", " ·* ·"][b]), eyes: " ● ● " };
    case "inspect": {
      const p = [0, 2, 4, 2][b];
      return { top: pad7(" ".repeat(p) + "o─"), eyes: look(p) };
    }
    case "hunt": {
      const p = [1, 2, 3, 3][b];
      return { top: pad7(" ".repeat(p) + (b === 3 ? "x" : "~")), eyes: b === 3 ? " ^ ^ " : look(p + 1) };
    }
    case "write":
      return { top: pad7(" " + "─".repeat(b + 1)), eyes: " . . " };
    case "plan":
      return { top: pad7(["   ?", "   ?", "   !", "   ✦"][b]), eyes: b >= 2 ? " ● ● " : "● ●  " };
    case "ship": {
      const p = [0, 1, 2, 3][b];
      return { top: pad7(" ".repeat(p) + "→"), eyes: look(p + 1) };
    }
  }
}

export const BOT_W = 9;
export const BOT_H = 6;

const EMBLEMS: Record<string, string> = {
  scout: "S", architect: "A", builder: "B", debugger: "D", tester: "T", reviewer: "R", security: "#", docs: "¶",
  researcher: "?", git: "G", designer: "*", refactorer: "%", performance: "»", devops: "=", dependencies: "&",
  database: "≡", frontend: "<", api: "@", migrator: ">", critic: "!", explainer: "i", verifier: "V", sentinel: "o",
  healer: "+", "memory-keeper": "M",
};

const PALETTE = ["#7DD3FC", "#C6F135", "#F9A8D4", "#FCD34D", "#A7F3D0", "#C4B5FD", "#FDBA74", "#93C5FD", "#86EFAC", "#FDA4AF"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function botColor(name: string): string {
  return PALETTE[hash(name.replace(/-worker$/, "")) % PALETTE.length];
}

export function emblem(name: string, worker = false): string {
  const base = name.replace(/-worker$/, "");
  const e = EMBLEMS[base] ?? (base[0] ?? "?").toUpperCase();
  return worker ? e.toLowerCase() : e;
}

/** One bot as BOT_H rows of exactly BOT_W cells. Pure: same inputs, same frame. */
export function botFrame(bot: Bot, tick: number, seed = 0): StyledSpan[][] {
  const t = currentTheme();
  const color = bot.state === "failed" ? t.error : bot.state === "idle" ? tint(botColor(bot.name), 0.55) : botColor(bot.name);
  const eyeColor = bot.state === "idle" ? tint(t.text, 0.5) : "#FFFFFF";
  const local = tick + seed * 7; // bots don't move in lockstep

  // Waking up: dozing → eyes pop open "!" → a happy hop. Then work.
  const since = bot.since ?? WAKE_MS;
  const waking = (bot.state === "running" || bot.state === "ready") && since < WAKE_MS;
  const phase = since < WAKE_MS * 0.33 ? "doze" : since < WAKE_MS * 0.66 ? "pop" : "hop";
  const work = workBeat(workStyle(bot.name), Math.floor(local / 4));

  // eyes (inner width 5)
  let eyes = " ● ● ";
  if (waking) eyes = phase === "doze" ? " - - " : phase === "pop" ? " O O " : " ^ ^ ";
  else if (bot.state === "running") {
    eyes = work.eyes;
    if (local % 37 === 0 || local % 37 === 1) eyes = " ─ ─ ";
  } else if (bot.state === "ready") {
    eyes = local % 41 === 0 ? " ─ ─ " : " ● ● "; // awake and attentive, waiting for its step
  } else if (bot.state === "done") eyes = " ^ ^ ";
  else if (bot.state === "failed") eyes = " x x ";
  else if (bot.state === "idle") eyes = " - - ";

  const mouth = bot.state === "done" ? "╰──‿──╯" : bot.state === "failed" ? "╰──^──╯" : "╰─────╯";

  // antenna / thought row
  let top = "       ";
  if (waking) top = phase === "doze" ? "    z  " : phase === "pop" ? "   !   " : "   ✦   ";
  else if (bot.state === "running") top = work.top;
  else if (bot.state === "ready") top = Math.floor(local / 6) % 2 ? "   ·   " : "   •   ";
  else if (bot.state === "done") top = "   ✓   ";
  else if (bot.state === "idle") {
    const z = Math.floor(local / 6) % 4;
    top = ["    z  ", "     z ", "     Z ", "       "][z];
  }

  const sprite: StyledSpan[][] = [
    [span(top, { fg: bot.state === "idle" ? tint(t.textMuted, 0.6) : bot.state === "done" ? t.success : bot.state === "ready" ? color : BRAND_SPARK, bold: bot.state !== "idle" })],
    [span("╭──", { fg: color }), span(emblem(bot.name, bot.worker), { fg: bot.state === "idle" ? color : "#FFFFFF", bold: true }), span("──╮", { fg: color })],
    [span("│", { fg: color }), span(eyes, { fg: bot.state === "failed" ? t.error : eyeColor, bold: true }), span("│", { fg: color })],
    [span(mouth, { fg: color })],
  ];

  // Bob: a working bot hops up every other beat (and once when it wakes), leaving a faint shadow
  const up = waking ? phase === "hop" : bot.state === "running" && Math.floor(local / 5) % 2 === 0;
  const area: StyledSpan[][] = up ? [...sprite, [span("  ───  ", { fg: tint(t.border, 0.5) })]] : [[span("       ")], ...sprite];
  const label = (bot.worker ? `·${bot.title.replace(/ worker.*$/i, "")}` : bot.title).toLowerCase().slice(0, BOT_W);
  const pad = Math.floor((BOT_W - label.length) / 2);
  return [
    ...area.map((r) => [span(" "), ...r, span(" ")]),
    [span(" ".repeat(pad) + label + " ".repeat(BOT_W - pad - label.length), { fg: bot.state === "running" ? t.text : tint(t.textMuted, 0.8), bold: bot.state === "running" })],
  ];
}

const BRAND_SPARK = "#C6F135";

/** Lay bots out in a grid that fits `width` × `maxRows`. Returns [] when not even one row fits. */
export function teamGrid(bots: Bot[], width: number, tick: number, maxRows: number): StyledSpan[][] {
  const perRow = Math.max(1, Math.floor((width + 1) / (BOT_W + 1)));
  const rowsOfBots = Math.min(Math.ceil(bots.length / perRow), Math.floor(maxRows / BOT_H));
  if (!bots.length || rowsOfBots < 1) return [];
  const out: StyledSpan[][] = [];
  for (let g = 0; g < rowsOfBots; g++) {
    const group = bots.slice(g * perRow, (g + 1) * perRow);
    const frames = group.map((b, i) => botFrame(b, tick, g * perRow + i));
    const used = group.length * (BOT_W + 1) - 1;
    const lead = " ".repeat(Math.max(0, Math.floor((width - used) / 2)));
    for (let r = 0; r < BOT_H; r++) {
      const row: StyledSpan[] = [span(lead)];
      frames.forEach((f, i) => {
        if (i) row.push(span(" "));
        row.push(...f[r]);
      });
      out.push(row);
    }
  }
  return out;
}

/** Who to draw: this request's experts (working first), else a few dozing teammates. */
export function botsFor(agents: { expert: string; title: string; status: "running" | "ready" | "done" | "failed"; startedAt?: number }[], roster: { name: string; title: string }[], now = Date.now()): Bot[] {
  if (agents.length) {
    const latest = new Map<string, Bot>();
    for (const a of agents) {
      const worker = a.expert.endsWith("-worker");
      const key = worker ? `${a.expert}:${a.title}` : a.expert;
      latest.set(key, { name: a.expert, title: worker ? a.title : a.expert, state: a.status, worker, since: a.startedAt !== undefined ? now - a.startedAt : undefined });
    }
    const order = { running: 0, ready: 1, failed: 2, done: 3, idle: 4 };
    return [...latest.values()].sort((x, y) => order[x.state] - order[y.state]);
  }
  return roster.map((r) => ({ name: r.name, title: r.name, state: "idle" as const }));
}
