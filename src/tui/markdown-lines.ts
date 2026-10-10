import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, emptyLine, wrapSpans, visualWidth } from "./core.js";

// Markdown → styled lines at XYRO terminal gutter (paddingLeft: 3).

const GUTTER = "   ";

// Theme-driven accents (identity colours under the XYRO themes)
const XYRO_FAMILY = new Set(["xyro", "midnight"]);
const brandOf = () => {
  const t = currentTheme();
  return XYRO_FAMILY.has(t.name)
    ? { lemon: "#C6F135", sky: "#38BDF8", cyan: "#4FC3E0", code: "#7DD3FC" }
    : { lemon: t.accent, sky: t.primary, cyan: t.info, code: t.info };
};

export function markdownToLines(md: string, contentWidth = 70): RenderLine[] {
  const t = currentTheme();
  const out: RenderLine[] = [];
  const src = md.split("\n");
  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = "";
  let table: string[] = [];

  const flushTable = () => {
    if (table.length) out.push(...tableLines(table, contentWidth));
    table = [];
  };

  for (const raw of src) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      flushTable();
      if (inCode) {
        out.push(...codeBlock(codeBuf, codeLang, contentWidth));
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
        codeLang = trimmed.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    if (trimmed.startsWith("|")) {
      table.push(trimmed);
      continue;
    }
    flushTable();

    if (!trimmed) {
      out.push(emptyLine());
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      const level = (trimmed.match(/^#+/) || ["#"])[0].length;
      const text = trimmed.replace(/^#+\s*/, "");
      if (level <= 2) {
        out.push(line(span(GUTTER), span("▍", { fg: brandOf().lemon }), span(text, { fg: t.text, bold: true })));
      } else {
        out.push(line(span(GUTTER), span(text, { fg: brandOf().sky, bold: true })));
      }
      continue;
    }

    if (trimmed.startsWith(">")) {
      const wrapped = wrapSpans(inline(trimmed.replace(/^>\s?/, ""), { italic: true, fg: tint(t.textMuted, 1) }), contentWidth - 2);
      for (const w of wrapped) out.push(line(span(GUTTER), span("▎ ", { fg: brandOf().sky }), ...w.spans));
      continue;
    }

    const indent = Math.floor((raw.length - raw.trimStart().length) / 2);
    const pad = "  ".repeat(Math.min(indent, 4));

    const task = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (task) {
      const done = task[1] !== " ";
      const wrapped = wrapSpans(inline(task[2], done ? { fg: tint(t.textMuted, 0.8), strikethrough: true } : {}), contentWidth - 2 - pad.length);
      wrapped.forEach((w, i) =>
        out.push(line(span(GUTTER + pad), span(i === 0 ? (done ? "✓ " : "○ ") : "  ", { fg: done ? t.success : brandOf().sky }), ...w.spans))
      );
      continue;
    }

    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      const bullet = indent === 0 ? "• " : "◦ ";
      const wrapped = wrapSpans(inline(ul[1]), contentWidth - 2 - pad.length);
      wrapped.forEach((w, i) => out.push(line(span(GUTTER + pad), span(i === 0 ? bullet : "  ", { fg: indent === 0 ? brandOf().sky : brandOf().cyan }), ...w.spans)));
      continue;
    }
    const ol = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (ol) {
      const num = `${ol[1]}. `;
      const wrapped = wrapSpans(inline(ol[2]), contentWidth - num.length - pad.length);
      wrapped.forEach((w, i) =>
        out.push(line(span(GUTTER + pad), span(i === 0 ? num : " ".repeat(num.length), { fg: brandOf().sky, bold: true }), ...w.spans))
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push(line(span(GUTTER), span("─".repeat(Math.min(contentWidth, 48)), { fg: tint(t.border, 0.7) })));
      continue;
    }

    const wrapped = wrapSpans(inline(trimmed), contentWidth);
    for (const w of wrapped) out.push(line(span(GUTTER), ...w.spans));
  }

  flushTable();
  if (inCode && codeBuf.length) out.push(...codeBlock(codeBuf, codeLang, contentWidth));
  return out;
}

/** Inline markdown: `code`, **bold**, *italic*, [links](url). */
function inline(text: string, base: Omit<StyledSpan, "text"> = {}): StyledSpan[] {
  const t = currentTheme();
  const spans: StyledSpan[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push(...withLinks(text.slice(last, m.index), base));
    const tok = m[0];
    if (tok.startsWith("`")) spans.push(span(` ${tok.slice(1, -1)} `, { fg: brandOf().code, bg: t.backgroundElement }));
    else if (tok.startsWith("**")) spans.push(span(tok.slice(2, -2), { ...base, bold: true, fg: base.fg ?? t.text }));
    else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = lm && /^https?:\/\//.test(lm[2].trim()) ? lm[2].trim() : undefined;
      spans.push(span(lm ? lm[1] : tok, { fg: brandOf().sky, bold: true, underline: Boolean(href), link: href }));
    } else spans.push(span(tok.slice(1, -1), { ...base, italic: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push(...withLinks(text.slice(last), base));
  return spans.length ? spans : [span(text, base)];
}

/** Plain text with its web addresses underlined and clickable. */
function withLinks(text: string, base: Omit<StyledSpan, "text">): StyledSpan[] {
  const out: StyledSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const at = m.index ?? 0;
    if (at > last) out.push(span(text.slice(last, at), base));
    out.push(span(url, { ...base, fg: brandOf().sky, underline: true, link: url }));
    last = at + url.length;
  }
  if (last < text.length) out.push(span(text.slice(last), base));
  return out;
}

/** GitHub-style table → box-drawn grid with a bold sky header. */
function tableLines(rows: string[], contentWidth: number): RenderLine[] {
  const t = currentTheme();
  const border = tint(t.border, 0.9);
  const cells = rows
    .filter((r) => !(/^[|\s:-]+$/.test(r) && r.includes("-"))) // drop the |---|---| separator
    .map((r) => r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, "").replace(/`/g, "")));
  if (!cells.length) return [];
  const cols = Math.max(...cells.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...cells.map((r) => visualWidth(r[c] ?? ""))));
  // Shrink the widest columns until the table fits
  const budget = contentWidth - (cols * 3 + 1);
  while (widths.reduce((a, b) => a + b, 0) > budget && Math.max(...widths) > 6) {
    widths[widths.indexOf(Math.max(...widths))]--;
  }
  const fit = (s: string, w: number) => (visualWidth(s) > w ? s.slice(0, Math.max(1, w - 1)) + "…" : s + " ".repeat(w - visualWidth(s)));
  const rule = (l: string, m: string, r: string) => line(span(GUTTER), span(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r, { fg: border }));

  const out: RenderLine[] = [rule("╭", "┬", "╮")];
  cells.forEach((r, i) => {
    const spans: StyledSpan[] = [span(GUTTER), span("│", { fg: border })];
    widths.forEach((w, c) => {
      spans.push(span(" " + fit(r[c] ?? "", w) + " ", i === 0 ? { fg: brandOf().sky, bold: true } : { fg: t.text }));
      spans.push(span("│", { fg: border }));
    });
    out.push(line(...spans));
    if (i === 0 && cells.length > 1) out.push(rule("├", "┼", "┤"));
  });
  out.push(rule("╰", "┴", "╯"));
  return out;
}

/** Rounded code card: language tag in lemon, dim line numbers, aligned right edge. */
function codeBlock(code: string[], lang: string, contentWidth: number): RenderLine[] {
  const t = currentTheme();
  const border = tint(t.border, 0.9);
  const bg = t.backgroundPanel;
  const numW = String(code.length).length;
  // Size to the longest line (at least wide enough for the tag), capped by the view
  const longest = Math.max(0, ...code.map((l) => visualWidth(l.replace(/\t/g, "  "))));
  const innerW = Math.max(lang.length + 8, Math.min(contentWidth - 2, 110, longest + numW + 4)); // between the side borders
  const codeW = innerW - numW - 2;
  const out: RenderLine[] = [];

  const label = lang ? ` ${lang} ` : "";
  out.push(
    line(
      span(GUTTER),
      span("╭─", { fg: border }),
      ...(label ? [span(label, { fg: brandOf().lemon, bold: true })] : []),
      span("─".repeat(Math.max(1, innerW - 1 - label.length)), { fg: border }),
      span("╮", { fg: border })
    )
  );
  code.forEach((l, i) => {
    const wrapped = wrapSpans(highlight(l.replace(/\t/g, "  ")), codeW);
    wrapped.forEach((w, j) => {
      const used = w.spans.reduce((a, s) => a + visualWidth(s.text), 0);
      const num = j === 0 ? String(i + 1).padStart(numW) : " ".repeat(numW);
      out.push(
        line(
          span(GUTTER),
          span("│", { fg: border }),
          span(` ${num} `, { fg: tint(t.textMuted, 0.5), bg }),
          ...w.spans.map((s) => ({ ...s, bg })),
          span(" ".repeat(Math.max(0, codeW - used)), { bg }),
          span("│", { fg: border })
        )
      );
    });
  });
  out.push(line(span(GUTTER), span("╰" + "─".repeat(innerW) + "╯", { fg: border })));
  return out;
}

function highlight(code: string): StyledSpan[] {
  const t = currentTheme();
  type Tok = { start: number; end: number; fg: string };
  const toks: Tok[] = [];
  const rules: [RegExp, string][] = [
    [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, t.success],
    [/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, tint(t.textMuted, 0.7)],
    [/\b(const|let|var|function|return|if|else|for|while|class|new|await|async|import|from|export|default|try|catch|throw|typeof|null|undefined|true|false|this|interface|type|enum|public|private|readonly)\b/g, t.secondary],
    [/\b(\d+(?:\.\d+)?)\b/g, t.warning],
    [/\b([A-Z][a-zA-Z0-9_]*)\b/g, t.primary],
    [/\b([a-z_][a-zA-Z0-9_]*)(?=\()/g, t.info],
  ];
  const consumed = new Array<boolean>(code.length).fill(false);
  for (const [re, fg] of rules) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      let free = true;
      for (let i = m.index; i < m.index + m[0].length && free; i++) if (consumed[i]) free = false;
      if (!free) continue;
      for (let i = m.index; i < m.index + m[0].length; i++) consumed[i] = true;
      toks.push({ start: m.index, end: m.index + m[0].length, fg });
    }
  }
  toks.sort((a, b) => a.start - b.start);
  const spans: StyledSpan[] = [];
  let pos = 0;
  for (const tok of toks) {
    if (tok.start > pos) spans.push(span(code.slice(pos, tok.start)));
    spans.push(span(code.slice(tok.start, tok.end), { fg: tok.fg }));
    pos = tok.end;
  }
  if (pos < code.length) spans.push(span(code.slice(pos)));
  return spans.length ? spans : [span(code)];
}

export function diffLines(diff: string, maxLines = 40): RenderLine[] {
  const t = currentTheme();
  const out: RenderLine[] = [];
  const lines = diff.split("\n");
  for (const l of lines.slice(0, maxLines)) {
    if (l.startsWith("+")) out.push(line(span(GUTTER), span(l, { fg: t.diffAdded })));
    else if (l.startsWith("-")) out.push(line(span(GUTTER), span(l, { fg: t.diffRemoved })));
    else if (l.startsWith("@@")) out.push(line(span(GUTTER), span(l, { fg: t.info })));
    else out.push(line(span(GUTTER), span(l, { fg: tint(t.textMuted, 0.85) })));
  }
  if (lines.length > maxLines) {
    out.push(line(span(GUTTER), span(`⌃ ${lines.length - maxLines} more lines`, { fg: tint(t.textMuted, 0.6) })));
  }
  return out;
}
