// Side panel beside the chat: mini XYRO (expresses what it is doing), the
// current plan with Approve / Revise buttons, and the live task list.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, wrapSpans, visualWidth } from "./core.js";
import { mascotRows, pickMascot, MascotMood, MASCOT_WAKE_MS, workGlance, mascotHop } from "./mascot.js";
import { BRAND, shimmerSpans, spinnerGlyph } from "./components.js";
import { botsFor, teamGrid } from "./expert-bots.js";
import type { TodoView, PlanRequest, AgentActivity } from "../agent/ui-bridge.js";

export type PanelMood = MascotMood;

export interface PlanView extends PlanRequest {
  state: "pending" | "approved" | "rejected";
  /** 0 = Approve focused, 1 = Revise focused */
  focus: number;
}

export interface PanelState {
  mood: PanelMood;
  caption: string;
  todos: TodoView[];
  plan: PlanView | null;
  /** Experts working (or recently finished) on this turn */
  agents?: AgentActivity[];
  /** Teammates who doze in the free space when nobody is working */
  roster?: { name: string; title: string }[];
  /** Experts who recognised XYRO's own current work as their trade (robots only, not the AGENTS list) */
  instinct?: { expert: string; title: string; status: "running" | "ready" | "done" | "failed"; startedAt: number }[];
  /** ms since XYRO started working on this turn (drives its wake-up) */
  workingFor?: number;
}

/** Clickable region, in panel-local coordinates (row, [col0, col1)). */
export interface PanelHit {
  action: "approve" | "reject";
  row: number;
  col0: number;
  col1: number;
}

export function panelWidth(termWidth: number): number {
  return Math.max(34, Math.min(44, Math.floor(termWidth * 0.3)));
}

/** The panel is shown only when the chat keeps a comfortable width. */
export function panelVisible(termWidth: number): boolean {
  return termWidth - panelWidth(termWidth) >= 76;
}

function moodColor(mood: PanelMood): string {
  const t = currentTheme();
  return { idle: BRAND.ramp[1], thinking: BRAND.ramp[0], happy: t.success, error: t.error, asking: BRAND.lemon }[mood];
}

/** The robots to draw: delegated experts, then experts who recognised the work, else the resting team. */
export function teamBots(state: Pick<PanelState, "agents" | "instinct" | "roster">): { team: { status: string }[]; bots: ReturnType<typeof botsFor> } {
  const delegated = state.agents ?? [];
  const instinct = (state.instinct ?? []).filter((i) => !delegated.some((a) => a.expert === i.expert && a.status === "running"));
  const team = [...delegated, ...instinct];
  return { team, bots: botsFor(team, state.roster ?? []) };
}

export function renderSidePanel(
  state: PanelState,
  width: number,
  height: number,
  tick: number,
  opts: { mascot?: boolean; reducedMotion?: boolean; team?: boolean } = {}
): { rows: RenderLine[]; hits: PanelHit[]; used: number } {
  const t = currentTheme();
  const innerW = width - 3; // "│ " on the left, 1 space on the right
  const body: StyledSpan[][] = [];
  const hits: PanelHit[] = [];
  const blank = () => body.push([]);
  const muted = tint(t.textMuted, 0.9);

  const section = (title: string, right = "") => {
    const rule = Math.max(1, innerW - visualWidth(title) - visualWidth(right) - 2);
    body.push([
      span(title, { fg: muted, bold: true }),
      span(" " + "─".repeat(rule) + (right ? " " : ""), { fg: tint(t.border, 0.7) }),
      ...(right ? [span(right, { fg: muted })] : []),
    ]);
  };

  // ── mini XYRO + caption ────────────────────────────────────────────────
  const art = opts.mascot !== false && height >= 22 ? pickMascot(innerW, 10) : null;
  if (art) {
    const mood: MascotMood = state.mood;
    const pad = " ".repeat(Math.max(0, Math.floor((innerW - art.cols) / 2)));
    const rm = Boolean(opts.reducedMotion);
    const wake = mood === "thinking" && state.workingFor !== undefined && state.workingFor < MASCOT_WAKE_MS ? state.workingFor / MASCOT_WAKE_MS : undefined;
    const hop = !rm && mascotHop(tick, mood, wake);
    // A hop moves the drawing up one row; the spare row goes underneath, so the panel never jumps
    if (!hop) blank();
    for (const r of mascotRows(art, tick, mood, rm, { wake, glance: mood === "thinking" && wake === undefined ? workGlance(tick) : 0 })) body.push([span(pad), ...r.spans]);
    if (hop) blank();
  }
  const color = moodColor(state.mood);
  const busy = state.mood === "thinking" || state.mood === "asking";
  const cap = state.caption.length > innerW - 2 ? state.caption.slice(0, innerW - 3) + "…" : state.caption;
  const capPad = " ".repeat(Math.max(0, Math.floor((innerW - visualWidth(cap) - 2) / 2)));
  body.push([
    span(capPad),
    span((state.mood === "thinking" ? spinnerGlyph(tick) : "◆") + " ", { fg: color }),
    ...(busy ? shimmerSpans(cap, tick, color, "#FFFFFF") : [span(cap, { fg: color })]),
  ]);
  blank();

  // ── plan ───────────────────────────────────────────────────────────────
  const plan = state.plan;
  if (plan) {
    const chip = plan.state === "approved" ? "approved ✓" : plan.state === "rejected" ? "rejected ✗" : "needs your OK";
    section("PLAN", chip);
    body.push([span(plan.title, { fg: t.text, bold: true })]);
    // Once approved and tracked as tasks, the plan collapses to its title
    const collapsed = plan.state === "approved" && state.todos.length > 0;
    if (collapsed) {
      blank();
    } else {
    if (plan.summary) {
      for (const w of wrapSpans([span(plan.summary, { fg: muted })], innerW)) body.push(w.spans);
    }
    plan.steps.forEach((step, i) => {
      const num = `${i + 1}. `;
      wrapSpans([span(step, { fg: plan.state === "rejected" ? muted : tint(t.text, 0.92) })], innerW - num.length).forEach((w, j) =>
        body.push([span(j === 0 ? num : " ".repeat(num.length), { fg: BRAND.lemon, bold: true }), ...w.spans])
      );
    });
    if (plan.state === "pending") {
      blank();
      const approve = " ✓ Approve ";
      const reject = " ✗ Revise ";
      const focusBg = (on: boolean, c: string) => (on ? { fg: t.background, bg: c, bold: true } : { fg: c, bg: t.backgroundElement, bold: true });
      const row = body.length;
      body.push([span(approve, focusBg(plan.focus === 0, t.success)), span("  "), span(reject, focusBg(plan.focus === 1, t.error))]);
      hits.push({ action: "approve", row, col0: 0, col1: approve.length });
      hits.push({ action: "reject", row, col0: approve.length + 2, col1: approve.length + 2 + reject.length });
      body.push([span("y approve · n revise · ←→ enter", { fg: tint(t.textMuted, 0.6) })]);
    }
    blank();
    }
  }

  // ── agents (experts) ───────────────────────────────────────────────────
  const agents = state.agents ?? [];
  if (agents.length) {
    const running = agents.filter((a) => a.status === "running").length;
    section("AGENTS", running ? `${running} working` : "done");
    for (const a of agents) {
      const glyph = a.status === "running" ? spinnerGlyph(tick + a.id) : a.status === "done" ? "✓" : "✗";
      const gColor = a.status === "running" ? BRAND.ramp[0] : a.status === "done" ? t.success : t.error;
      const secs = Math.round(((a.endedAt ?? Date.now()) - a.startedAt) / 1000);
      const tok = a.tokens ? ` · ${a.tokens >= 1000 ? `${(a.tokens / 1000).toFixed(1)}k` : a.tokens}` : "";
      const right = (a.status === "running" ? `${a.step}/${a.maxSteps}` : `${secs}s`) + tok;
      const nameW = innerW - 2 - right.length - 1;
      body.push([
        span(glyph + " ", { fg: gColor, bold: true }),
        span(a.title.padEnd(Math.max(1, nameW)).slice(0, Math.max(1, nameW)), { fg: a.status === "running" ? t.text : tint(t.text, 0.8), bold: a.status === "running" }),
        span(" " + right, { fg: tint(t.textMuted, 0.7) }),
      ]);
      const detail = a.status === "running" && a.tool ? `→ ${a.tool.replace(/_/g, " ")}` : a.task;
      body.push([span("  " + (detail.length > innerW - 2 ? detail.slice(0, innerW - 3) + "…" : detail), { fg: tint(t.textMuted, 0.75) })]);
    }
    blank();
  }

  // ── tasks ──────────────────────────────────────────────────────────────
  if (state.todos.length) {
    const done = state.todos.filter((x) => x.status === "done").length;
    section("TASKS", `${done}/${state.todos.length}`);
    const barW = Math.max(6, innerW);
    const filled = Math.round((done / state.todos.length) * barW);
    body.push([span("▰".repeat(filled), { fg: t.success }), span("▱".repeat(barW - filled), { fg: tint(t.border, 0.8) })]);
    for (const item of state.todos) {
      const glyph = item.status === "done" ? "✓" : item.status === "in_progress" ? spinnerGlyph(tick) : "○";
      const gColor = item.status === "done" ? t.success : item.status === "in_progress" ? BRAND.ramp[0] : muted;
      const style =
        item.status === "done"
          ? { fg: tint(t.textMuted, 0.8), strikethrough: true }
          : item.status === "in_progress"
            ? { fg: t.text, bold: true }
            : { fg: tint(t.text, 0.8) };
      const owner = item.expert ? [span(` · ${item.expert}`, { fg: tint(t.textMuted, item.status === "in_progress" ? 0.95 : 0.6) })] : [];
      wrapSpans([span(item.text, style), ...owner], innerW - 2).forEach((w, j) => body.push([span(j === 0 ? glyph + " " : "  ", { fg: gColor, bold: true }), ...w.spans]));
    }
  } else if (!plan) {
    section("TASKS");
    for (const w of wrapSpans([span("Multi-step work shows up here as a live checklist.", { fg: tint(t.textMuted, 0.65), italic: true })], innerW)) body.push(w.spans);
  }

  // ── the team, animated, in whatever space is left at the bottom ─────────
  // Delegated experts first; then whoever recognised XYRO's own work as theirs
  const { team, bots } = teamBots(state);
  // (When the team has its own strip beside the input box, the panel keeps its space for the plan)
  const grid = opts.team === false ? [] : teamGrid(bots, innerW, opts.reducedMotion ? 0 : tick, height - body.length - 2);
  if (grid.length) {
    while (body.length < height - grid.length - 1) blank();
    const working = team.filter((a) => a.status === "running").length;
    const ready = team.filter((a) => a.status === "ready").length;
    section("TEAM", working ? `${working} working` : ready ? `${ready} ready` : team.length ? "done" : "resting");
    body.push(...grid);
  }

  // ── frame: subtle left rule + panel background ────────────────────────
  const bg = t.backgroundPanel;
  const rows: RenderLine[] = [];
  for (let r = 0; r < height; r++) {
    const spans = body[r] ?? [];
    const used = spans.reduce((w, s) => w + visualWidth(s.text), 0);
    const clipped = used > innerW ? clip(spans, innerW) : spans;
    const usedClipped = clipped.reduce((w, s) => w + visualWidth(s.text), 0);
    rows.push(
      line(
        span("│", { fg: tint(t.border, 0.6), bg }),
        span(" ", { bg }),
        ...clipped.map((s) => ({ ...s, bg: s.bg ?? bg })),
        span(" ".repeat(Math.max(0, innerW - usedClipped) + 1), { bg })
      )
    );
  }
  // Hits are relative to the panel body: shift by the 2-cell left frame
  return { rows, used: Math.min(height, body.length), hits: hits.filter((h) => h.row < height).map((h) => ({ ...h, col0: h.col0 + 2, col1: h.col1 + 2 })) };
}

function clip(spans: StyledSpan[], w: number): StyledSpan[] {
  const out: StyledSpan[] = [];
  let used = 0;
  for (const s of spans) {
    const chars = Array.from(s.text);
    const take = chars.slice(0, Math.max(0, w - used));
    if (take.length) out.push({ ...s, text: take.join("") });
    used += take.length;
    if (used >= w) break;
  }
  return out;
}
