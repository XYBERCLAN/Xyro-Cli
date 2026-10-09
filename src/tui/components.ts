import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, emptyLine, wrapSpans, SPLIT_VERTICAL } from "./core.js";
import { markdownToLines } from "./markdown-lines.js";

// ─── XYRO message components ───────────────────────────────────────────────
// User: border=[left] ┃ in agent color, paddingLeft 2, paddingV 1, bg backgroundPanel
// Assistant: paddingLeft 3 markdown; final footer "▣ Agent · model · duration"
// InlineToolRow: paddingLeft 3, icon 2 cells; pending "~ Writing…"
// BlockTool: left-bordered panel, title "# tool input", collapsed output

export const AGENT_COLORS = ["secondary", "accent", "success", "warning", "primary", "error", "info"] as const;

export function agentColor(index: number): string {
  const t = currentTheme() as unknown as Record<string, string>;
  const key = AGENT_COLORS[index % AGENT_COLORS.length];
  return t[key];
}

// user message bubble
export function userMessage(content: string, colorIndex = 0): RenderLine[] {
  const t = currentTheme();
  const color = agentColor(colorIndex);
  const bodyW = 66;
  const out: RenderLine[] = [];
  const wrapped = wrapSpans([span(content, { fg: t.text })], bodyW);
  wrapped.forEach((w, i) => {
    if (i === 0) {
      out.push(line(span("  "), span(SPLIT_VERTICAL, { fg: color }), span("  "), ...w.spans));
    } else {
      out.push(line(span("  "), span(SPLIT_VERTICAL, { fg: color }), span("  "), ...w.spans));
    }
  });
  return out;
}

// assistant markdown body (no bubble)
export function assistantText(markdown: string, contentWidth = 70): RenderLine[] {
  return markdownToLines(markdown, contentWidth);
}

// ▣ Agent · model · duration — final line of an assistant turn
export function assistantFooter(agentName: string, model: string, durationSec?: number, colorIndex = 0): RenderLine[] {
  const t = currentTheme();
  const spans: StyledSpan[] = [
    span("   "),
    span("▣ ", { fg: agentColor(colorIndex) }),
    span(agentName, { fg: t.text }),
    span(` · ${model}`, { fg: t.textMuted }),
  ];
  if (durationSec !== undefined) {
    spans.push(span(` · ${formatDuration(durationSec)}`, { fg: t.textMuted }));
  }
  return [line(...spans)];
}

// thinking — running: spinner glyph + label; done: "+ Thought: title · duration"
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

// InlineToolRow — icon (2 cells) + "tool input…"; pending = "~ Writing command…"
const TOOL_ICONS: Record<string, string> = {
  bash: "$", run_command: "$", shell: "$",
  read: "◧", read_file: "◧",
  write: "◨", write_file: "◨",
  edit: "◈", edit_file: "◈",
  glob: "☰", list_files: "☰",
  grep: "⌕", search_code: "⌕",
  task: "▣", webfetch: "↟",
};

export function toolIcon(name: string): string {
  const base = name.startsWith("mcp_") ? "mcp" : name;
  return TOOL_ICONS[base] || "⚙";
}

export function toolRunning(name: string, summary: string): RenderLine[] {
  const t = currentTheme();
  return [
    line(
      span("     "),
      span("~ ", { fg: tint(t.textMuted, 0.8) }),
      span(`${name} `, { fg: tint(t.textMuted, 0.9) }),
      span(summary.slice(0, 60), { fg: tint(t.textMuted, 0.6) })
    ),
  ];
}

export function toolDone(name: string, summary: string, elapsed?: string, failed = false): RenderLine[] {
  const t = currentTheme();
  const color = failed ? t.error : tint(t.textMuted, 0.95);
  return [
    line(
      span("     "),
      span(toolIcon(name), { fg: failed ? t.error : tint(t.secondary, 0.9) }),
      span(" ", {}),
      span(`${name}`, { fg: color }),
      span(elapsed ? ` (${elapsed}s)` : "", { fg: tint(t.textMuted, 0.6) }),
      span(summary ? ` — ${summary.slice(0, 50)}` : "", { fg: tint(t.textMuted, 0.7) })
    ),
  ];
}

// BlockTool — bordered panel with title + output (used for shell diffs etc.)
export function blockTool(title: string, outputLines: RenderLine[], maxLines = 10): RenderLine[] {
  const t = currentTheme();
  const out: RenderLine[] = [];
  out.push(
    line(
      span("  "),
      span(SPLIT_VERTICAL, { fg: tint(t.border, 0.6) }),
      span("  "),
      span(title, { fg: tint(t.textMuted, 0.9) })
    )
  );
  const shown = outputLines.slice(0, maxLines);
  for (const l of shown) {
    out.push(line(span("  "), span("│", { fg: tint(t.border, 0.5) }), span("  "), ...l.spans));
  }
  if (outputLines.length > maxLines) {
    out.push(line(span("  "), span("│", { fg: tint(t.border, 0.5) }), span("  "), span(`⌃ ${outputLines.length - maxLines} more lines`, { fg: tint(t.textMuted, 0.6) })));
  }
  return out;
}

// error message — left red border error box
export function errorMessage(content: string): RenderLine[] {
  const t = currentTheme();
  const wrapped = wrapSpans([span(content, { fg: tint(t.textMuted, 0.95) })], 64);
  const out: RenderLine[] = [];
  wrapped.forEach((w) => out.push(line(span("  "), span(SPLIT_VERTICAL, { fg: t.error }), span("  "), ...w.spans)));
  return out;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export { emptyLine };
