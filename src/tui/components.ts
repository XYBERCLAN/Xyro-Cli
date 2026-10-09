import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, emptyLine, wrapSpans, visualWidth, SPLIT_VERTICAL } from "./core.js";
import { markdownToLines } from "./markdown-lines.js";

// ─── XYRO chat components ──────────────────────────────────────────────────
// User:      tinted card, agent-colour bar, "you · hh:mm" header
// Assistant: "◆ xyro" gradient header, markdown body at a 3-cell gutter
// Tools:     one live row per call: spinner → ✓/✗, colour-coded verb, target
// Notices:   compact one-line confirmations (model / theme / provider switch)

const BRAND_RAMP = ["#4FC3E0", "#38BDF8", "#3B82F6", "#2563EB"];

/**
 * Accent ramp + highlight for the active theme. XYRO themes use the exact
 * identity colours (cyan → deep blue, lemon); other themes derive the same
 * roles from their own palette so the chat always matches the theme.
 */
export const BRAND = {
  get ramp(): string[] {
    const t = currentTheme();
    if (t.name === "xyro" || t.name === "midnight") return BRAND_RAMP;
    return [t.info, t.primary, t.secondary, mix(t.secondary, t.text, 0.2)];
  },
  get lemon(): string {
    const t = currentTheme();
    return t.name === "xyro" || t.name === "midnight" ? "#C6F135" : t.accent;
  },
};

export const AGENT_COLORS = ["secondary", "accent", "success", "warning", "primary", "error", "info"] as const;

export function agentColor(index: number): string {
  const t = currentTheme() as unknown as Record<string, string>;
  const key = AGENT_COLORS[index % AGENT_COLORS.length];
  return t[key];
}

// ─── colour helpers ─────────────────────────────────────────────────────────

function hexToRgb(h: string): [number, number, number] {
  const m = h.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear blend of two hex colours (t = 0 → a, t = 1 → b). */
const mixCache = new Map<string, string>();

export function mix(a: string, b: string, t: number): string {
  // Animations blend the same pairs every frame: memoise (t rounded to 1/256)
  const tq = Math.round(Math.max(0, Math.min(1, t)) * 256) / 256;
  const key = a + b + tq;
  const hit = mixCache.get(key);
  if (hit) return hit;
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * tq));
  const out = "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  if (mixCache.size > 20000) mixCache.clear();
  mixCache.set(key, out);
  return out;
}

/** Colour along the brand ramp for position p ∈ [0, 1]. */
export function rampColor(p: number): string {
  const r = BRAND.ramp;
  const x = Math.max(0, Math.min(1, p)) * (r.length - 1);
  const i = Math.min(r.length - 2, Math.floor(x));
  return mix(r[i], r[i + 1], x - i);
}

/** Text with each character coloured along the brand ramp. */
export function gradientSpans(text: string, opts: Omit<StyledSpan, "text" | "fg"> = {}): StyledSpan[] {
  const chars = Array.from(text);
  return chars.map((ch, i) => ({ text: ch, fg: rampColor(chars.length > 1 ? i / (chars.length - 1) : 0), ...opts }));
}

/** A soft band of light sweeping across `text` (status labels, thinking). */
export function shimmerSpans(text: string, tick: number, base: string, highlight: string, opts: Omit<StyledSpan, "text" | "fg"> = {}): StyledSpan[] {
  const chars = Array.from(text);
  const period = chars.length + 8;
  const pos = (tick % period) - 4;
  return chars.map((ch, i) => {
    const d = Math.abs(i - pos);
    return { text: ch, fg: d >= 3 ? base : mix(highlight, base, d / 3), ...opts };
  });
}

/** Drop emoji pictographs (tool results often start with ❌ / ✅ / ⛔). */
export function stripEmoji(text: string): string {
  return text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\u{FE0F}?/gu, (m) => (m === "✓" || m === "✗" ? m : "")).replace(/^\s+/, "");
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function spinnerGlyph(tick: number): string {
  return SPINNER[tick % SPINNER.length];
}

function clock(d = new Date()): string {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

// ─── user message card ──────────────────────────────────────────────────────

export function userMessage(content: string, colorIndex = 0, width = 80): RenderLine[] {
  const t = currentTheme();
  const color = agentColor(colorIndex);
  const cardW = Math.max(30, Math.min(width - 4, 100));
  const innerW = cardW - 4; // bar + 2 pad + 1 right pad
  const bg = t.backgroundPanel;
  const row = (spans: StyledSpan[]) => {
    const used = spans.reduce((w, s) => w + visualWidth(s.text), 0);
    return line(
      span("  "),
      span("▍", { fg: color, bg }),
      span("  ", { bg }),
      ...spans.map((s) => ({ ...s, bg })),
      span(" ".repeat(Math.max(0, innerW - used) + 1), { bg })
    );
  };

  const time = clock();
  const out: RenderLine[] = [];
  out.push(row([span("you", { fg: color, bold: true }), span(" ".repeat(Math.max(1, innerW - 3 - time.length))), span(time, { fg: tint(t.textMuted, 0.7) })]));
  for (const para of content.split("\n")) {
    const wrapped = para ? wrapSpans([span(para, { fg: t.text })], innerW) : [line()];
    for (const w of wrapped) out.push(row(w.spans));
  }
  return out;
}

// ─── assistant ──────────────────────────────────────────────────────────────

/** "◆ xyro" — opens every assistant turn. */
export function assistantHeader(): RenderLine[] {
  return [line(span("  "), span("◆ ", { fg: BRAND.lemon }), ...gradientSpans("xyro", { bold: true }))];
}

// assistant markdown body (no bubble)
export function assistantText(markdown: string, contentWidth = 70): RenderLine[] {
  return markdownToLines(markdown, contentWidth);
}

/** "⠋ Thinking…" live row with a shimmer, shown until the first output. */
export function thinkingRow(tick: number, elapsedSec: number): RenderLine {
  const t = currentTheme();
  const spans: StyledSpan[] = [
    span("   "),
    span(spinnerGlyph(tick) + " ", { fg: BRAND.ramp[0] }),
    ...shimmerSpans("Thinking…", tick, tint(t.textMuted, 0.95), "#FFFFFF"),
  ];
  if (elapsedSec >= 1) spans.push(span(`  ${formatDuration(elapsedSec)}`, { fg: tint(t.textMuted, 0.6) }));
  return line(...spans);
}

/** Final line of an assistant turn: "╰─ ▣ Build · model · 12s". */
export function assistantFooter(agentName: string, model: string, durationSec?: number, colorIndex = 0): RenderLine[] {
  const t = currentTheme();
  const dim = tint(t.textMuted, 0.6);
  const spans: StyledSpan[] = [
    span("   "),
    span("▣ ", { fg: agentColor(colorIndex) }),
    span(agentName, { fg: tint(t.text, 0.9) }),
    span("  ·  ", { fg: dim }),
    span(model, { fg: t.textMuted }),
  ];
  if (durationSec !== undefined) {
    spans.push(span("  ·  ", { fg: dim }), span(formatDuration(durationSec), { fg: t.textMuted }));
  }
  return [line(...spans)];
}

// thinking (legacy line-mode helpers, kept for compatibility)
export function thinkingRunning(frameGlyph: string, title?: string): RenderLine[] {
  const t = currentTheme();
  const fg = tint(t.warning, t.thinkingOpacity + 0.3);
  return [line(span("   "), span(frameGlyph, { fg: fg }), span(` ${title ? `Thinking: ${title}` : "Thinking"}`, { fg: fg }))];
}

export function thoughtDone(title: string | null, durationSec: number): RenderLine[] {
  const t = currentTheme();
  const fg = tint(t.warning, t.thinkingOpacity);
  const detail = [title, formatDuration(durationSec)].filter(Boolean).join(" · ");
  return [line(span("   "), span(`+ Thought${detail ? `: ${detail}` : ""}`, { fg: fg }))];
}

// ─── tool rows ──────────────────────────────────────────────────────────────

interface ToolStyle {
  verb: string;
  color: string;
}

/** Friendly verb + category colour for each tool. */
export function toolStyle(name: string): ToolStyle {
  const t = currentTheme();
  if (name.startsWith("mcp__")) return { verb: name.split("__").slice(1).join(" "), color: t.info };
  if (name.startsWith("git_") || name === "git") {
    const sub = name.replace(/^git_/, "").replace(/_/g, " ");
    return { verb: `Git ${sub}`, color: BRAND.ramp[2] };
  }
  const map: Record<string, ToolStyle> = {
    read_file: { verb: "Read", color: BRAND.ramp[1] },
    list_files: { verb: "List", color: BRAND.ramp[1] },
    glob: { verb: "Glob", color: BRAND.ramp[1] },
    find_files: { verb: "Find", color: BRAND.ramp[1] },
    search_code: { verb: "Search", color: BRAND.ramp[0] },
    ast_inspect_file: { verb: "Inspect", color: BRAND.ramp[0] },
    ast_find_symbol: { verb: "Symbol", color: BRAND.ramp[0] },
    write_file: { verb: "Write", color: BRAND.lemon },
    edit_file: { verb: "Edit", color: BRAND.lemon },
    revert_file: { verb: "Revert", color: t.warning },
    run_command: { verb: "Run", color: t.warning },
    fetch_url: { verb: "Fetch", color: BRAND.ramp[3] },
    spawn_agent: { verb: "Delegate", color: t.success },
    spawn_agents: { verb: "Delegate", color: t.success },
    write_todos: { verb: "Tasks", color: t.success },
    propose_plan: { verb: "Plan", color: BRAND.lemon },
  };
  return map[name] ?? { verb: name.replace(/_/g, " "), color: t.secondary };
}

export function toolIcon(name: string): string {
  return toolStyle(name).verb.charAt(0);
}

const VERB_W = 9;

export type ToolState = "running" | "done" | "failed";

/**
 * One tool call, rendered live.
 * running: "⠹ Read      src/app.ts            1.2s"
 * done:    "✓ Read      src/app.ts · 0.2s"
 * failed:  "✗ Run       npm test · 3.1s — exit 1"
 */
export function toolRow(name: string, target: string, state: ToolState, tick: number, elapsedSec: number, detail = "", width = 80): RenderLine {
  const t = currentTheme();
  const { verb, color } = toolStyle(name);
  const maxTarget = Math.max(10, Math.min(width - 30, 70));
  const tgt = target.length > maxTarget ? target.slice(0, maxTarget - 1) + "…" : target;
  const dim = tint(t.textMuted, 0.6);

  const glyph =
    state === "running"
      ? span(spinnerGlyph(tick), { fg: color })
      : state === "done"
        ? span("✓", { fg: t.success, bold: true })
        : span("✗", { fg: t.error, bold: true });

  const verbText = verb.length >= VERB_W ? verb + " " : verb.padEnd(VERB_W);
  const spans: StyledSpan[] = [
    span("   "),
    glyph,
    span(" "),
    span(verbText, { fg: state === "failed" ? t.error : color, bold: true }),
    span(tgt, { fg: state === "running" ? t.text : tint(t.text, 0.75) }),
  ];
  if (state === "running") {
    if (elapsedSec >= 1) spans.push(span(`  ${formatDuration(elapsedSec)}`, { fg: dim }));
  } else {
    spans.push(span(` · ${elapsedSec < 10 ? `${elapsedSec.toFixed(1)}s` : formatDuration(elapsedSec)}`, { fg: dim }));
    if (state === "failed" && detail) {
      detail = stripEmoji(detail);
      const used = spans.reduce((w, s) => w + visualWidth(s.text), 0) + 4;
      const room = Math.max(8, width - used - 1);
      const msg = detail.length > room ? detail.slice(0, room - 1) + "…" : detail;
      spans.push(span(`  — ${msg}`, { fg: tint(t.error, 0.8) }));
    }
  }
  return line(...spans);
}

// Legacy single-shot rows (line mode / compatibility)
export function toolRunning(name: string, summary: string): RenderLine[] {
  return [toolRow(name, summary, "running", 0, 0)];
}

export function toolDone(name: string, summary: string, elapsed?: string, failed = false): RenderLine[] {
  return [toolRow(name, "", failed ? "failed" : "done", 0, Number(elapsed ?? 0), summary)];
}

// BlockTool — bordered panel with title + output (used for shell diffs etc.)
export function blockTool(title: string, outputLines: RenderLine[], maxLines = 10): RenderLine[] {
  const t = currentTheme();
  const out: RenderLine[] = [];
  out.push(line(span("  "), span(SPLIT_VERTICAL, { fg: tint(t.border, 0.6) }), span("  "), span(title, { fg: tint(t.textMuted, 0.9) })));
  const shown = outputLines.slice(0, maxLines);
  for (const l of shown) {
    out.push(line(span("  "), span("│", { fg: tint(t.border, 0.5) }), span("  "), ...l.spans));
  }
  if (outputLines.length > maxLines) {
    out.push(line(span("  "), span("│", { fg: tint(t.border, 0.5) }), span("  "), span(`⌃ ${outputLines.length - maxLines} more lines`, { fg: tint(t.textMuted, 0.6) })));
  }
  return out;
}

// ─── notices & errors ───────────────────────────────────────────────────────

/** Compact confirmation, e.g. "✓ Model switched to deepseek-r1 (OpenRouter)". */
export function noticeRow(text: string, kind: "success" | "info" | "warn" = "success"): RenderLine[] {
  const t = currentTheme();
  const color = kind === "success" ? t.success : kind === "warn" ? t.warning : BRAND.ramp[1];
  const glyph = kind === "success" ? "✓" : kind === "warn" ? "!" : "›";
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return [
    line(
      span("  "),
      span(glyph + " ", { fg: color, bold: true }),
      ...parts.map((p) =>
        p.startsWith("**") ? span(p.slice(2, -2), { fg: t.text, bold: true }) : span(p.replace(/\*/g, ""), { fg: tint(t.textMuted, 0.95) })
      )
    ),
  ];
}

// error card — red bar, "✗ error" header, wrapped message
export function errorMessage(content: string, width = 80): RenderLine[] {
  const t = currentTheme();
  const innerW = Math.max(30, Math.min(width - 8, 96));
  const bg = tint(t.error, 0.08);
  const out: RenderLine[] = [];
  const row = (spans: StyledSpan[]) => {
    const used = spans.reduce((w, s) => w + visualWidth(s.text), 0);
    return line(span("  "), span("▍", { fg: t.error, bg }), span("  ", { bg }), ...spans.map((s) => ({ ...s, bg })), span(" ".repeat(Math.max(0, innerW - used) + 1), { bg }));
  };
  out.push(row([span("✗ error", { fg: t.error, bold: true })]));
  for (const w of wrapSpans([span(stripEmoji(content), { fg: tint(t.text, 0.9) })], innerW)) out.push(row(w.spans));
  return out;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export { emptyLine };
