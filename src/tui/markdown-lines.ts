import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, emptyLine, wrapSpans } from "./core.js";

// Markdown → styled lines at XYRO terminal gutter (paddingLeft: 3).

const GUTTER = "   ";

export function markdownToLines(md: string, contentWidth = 70): RenderLine[] {
  const t = currentTheme();
  const out: RenderLine[] = [];
  const src = md.split("\n");
  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = "";

  for (const raw of src) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
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

    if (!trimmed) {
      out.push(emptyLine());
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      const level = (trimmed.match(/^#+/) || ["#"])[0].length;
      const text = trimmed.replace(/^#+\s*/, "");
      const color = level <= 2 ? t.primary : t.secondary;
      out.push(line(span(GUTTER), span(text, { fg: color, bold: level <= 2 })));
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const wrapped = wrapSpans([span(trimmed.slice(2))], contentWidth - 2);
      for (const w of wrapped) out.push(line(span(GUTTER), span("▎ ", { fg: tint(t.border, 0.8) }), ...w.spans));
      continue;
    }

    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      const wrapped = wrapSpans(inline(ul[1]), contentWidth - 2);
      wrapped.forEach((w, i) =>
        out.push(line(span(GUTTER), span(i === 0 ? "• " : "  ", { fg: t.accent }), ...w.spans))
      );
      continue;
    }
    const ol = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (ol) {
      const wrapped = wrapSpans(inline(ol[2]), contentWidth - 3);
      wrapped.forEach((w, i) =>
        out.push(line(span(GUTTER), span(i === 0 ? `${ol[1]}. ` : "   ", { fg: t.accent }), ...w.spans))
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push(line(span(GUTTER), span("─".repeat(Math.min(contentWidth, 44)), { fg: tint(t.border, 0.6) })));
      continue;
    }

    if (trimmed.startsWith("|")) {
      out.push(line(span(GUTTER), span(trimmed, { fg: tint(t.textMuted, 0.9) })));
      continue;
    }

    const wrapped = wrapSpans(inline(trimmed), contentWidth);
    for (const w of wrapped) out.push(line(span(GUTTER), ...w.spans));
  }

  if (inCode && codeBuf.length) out.push(...codeBlock(codeBuf, codeLang, contentWidth));
  return out;
}

function inline(text: string): StyledSpan[] {
  const t = currentTheme();
  const spans: StyledSpan[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push(span(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("`")) spans.push(span(tok.slice(1, -1), { fg: t.success }));
    else if (tok.startsWith("**")) spans.push(span(tok.slice(2, -2), { bold: true }));
    else spans.push(span(tok.slice(1, -1), { italic: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push(span(text.slice(last)));
  return spans.length ? spans : [span(text)];
}

function codeBlock(code: string[], lang: string, contentWidth: number): RenderLine[] {
  const t = currentTheme();
  const out: RenderLine[] = [];
  const innerW = Math.max(10, contentWidth - 4);
  const label = lang ? ` ${lang} ` : "";
  // top border with centered lang tag
  const topPad = Math.max(1, Math.floor((innerW - label.length) / 2));
  out.push(
    line(
      span(GUTTER),
      span("┌", { fg: tint(t.border, 0.8) }),
      span("─".repeat(topPad), { fg: tint(t.border, 0.8) }),
      ...(label ? [span(label, { fg: tint(t.accent, 0.9) })] : []),
      span("─".repeat(Math.max(1, innerW - topPad - label.length)), { fg: tint(t.border, 0.8) }),
      span("┐", { fg: tint(t.border, 0.8) })
    )
  );
  for (const l of code) {
    for (const w of wrapSpans(highlight(l), innerW)) {
      out.push(line(span(GUTTER), span("│ ", { fg: tint(t.border, 0.8) }), ...w.spans, span(" │", { fg: tint(t.border, 0.8) })));
    }
  }
  out.push(line(span(GUTTER), span("└", { fg: tint(t.border, 0.8) }), span("─".repeat(innerW + 1), { fg: tint(t.border, 0.8) }), span("┘", { fg: tint(t.border, 0.8) })));
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
