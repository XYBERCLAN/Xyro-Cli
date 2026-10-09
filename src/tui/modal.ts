// Modal compositor: every menu opens as a centred pop-up over a dimmed copy of
// the screen, with a soft drop shadow and a short rise + fade animation.

import { currentTheme } from "../ui/theme.js";
import { RenderLine, StyledSpan, visualWidth } from "./core.js";
import { mix } from "./components.js";

export const MODAL_OPEN_MS = 180;
export const MODAL_CLOSE_MS = 120;

/** Remove the shared left margin the pickers add, so the box can be re-centred. */
function trimMargin(rows: RenderLine[]): RenderLine[] {
  const lead = (r: RenderLine) => {
    let n = 0;
    for (const s of r.spans) {
      if (s.bg) break;
      const m = s.text.match(/^ */)![0].length;
      n += m;
      if (m < s.text.length) break;
    }
    return n;
  };
  const cut = Math.min(...rows.filter((r) => r.spans.some((s) => s.text.trim())).map(lead));
  if (!isFinite(cut) || cut <= 0) return rows;
  return rows.map((r) => {
    let left = cut;
    const spans: StyledSpan[] = [];
    for (const s of r.spans) {
      if (left > 0) {
        const chars = Array.from(s.text);
        const drop = Math.min(left, chars.length);
        left -= drop;
        if (drop < chars.length) spans.push({ ...s, text: chars.slice(drop).join("") });
      } else spans.push(s);
    }
    return { spans };
  });
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/** Cells [from, to) of a row as spans, padded with `fill` when the row is short. */
function sliceRow(row: RenderLine | undefined, from: number, to: number, fill: Omit<StyledSpan, "text">): StyledSpan[] {
  const out: StyledSpan[] = [];
  let col = 0;
  for (const s of row?.spans ?? []) {
    if (col >= to) break;
    let text = "";
    for (const ch of Array.from(s.text)) {
      const w = visualWidth(ch);
      if (col >= from && col + w <= to) text += ch;
      else if (col < to && col + w > from) text += " "; // split wide glyph
      col += w;
      if (col >= to) break;
    }
    if (text) out.push({ ...s, text });
  }
  const used = Math.max(0, Math.min(col, to) - from);
  if (used < to - from) out.push({ ...fill, text: " ".repeat(to - from - used) });
  return out;
}

/**
 * Composite `modal` over `base`. `progress` 0 → 1 drives the backdrop dim,
 * the box's rise (3 rows) and its fade-in. Works on whole spans (not cells)
 * so a frame stays well under the 16ms animation budget.
 */
export function composeModal(base: RenderLine[], modalRows: RenderLine[], width: number, height: number, progress: number): RenderLine[] {
  const t = currentTheme();
  const p = easeOut(Math.max(0, Math.min(1, progress)));
  const shade = mix(t.background, "#000000", 0.45);
  const shadowBg = mix(shade, mix(t.background, "#000000", 0.75), p);
  const backBg = mix(t.background, shade, 0.7 * p);
  const dimSpan = (s: StyledSpan): StyledSpan => ({ ...s, fg: mix(s.fg ?? t.text, shade, 0.62 * p), bg: mix(s.bg ?? t.background, shade, 0.7 * p), bold: false });
  const fadeSpan = (s: StyledSpan): StyledSpan => ({ ...s, bg: mix(shade, s.bg ?? t.backgroundPanel, p), fg: mix(shade, s.fg ?? t.text, 0.25 + 0.75 * p) });

  const box = trimMargin(modalRows);
  const bw = Math.min(width, Math.max(...box.map((r) => r.spans.reduce((w, s) => w + visualWidth(s.text), 0))));
  const bh = Math.min(height - 2, box.length);
  const x0 = Math.max(0, Math.floor((width - bw) / 2));
  const y0 = Math.max(1, Math.floor((height - bh) / 2.4) + Math.round((1 - p) * 3));

  const out: RenderLine[] = [];
  for (let y = 0; y < height; y++) {
    const row = base[y];
    const inBox = y >= y0 && y < y0 + bh;
    const isShadowRow = y === y0 + bh;
    if (!inBox && !isShadowRow) {
      out.push({ spans: sliceRow(row, 0, width, { bg: backBg }).map(dimSpan) });
      continue;
    }
    const spans: StyledSpan[] = sliceRow(row, 0, inBox ? x0 : x0 + 1, { bg: backBg }).map(dimSpan);
    if (inBox) {
      spans.push(...sliceRow(box[y - y0], 0, bw, { bg: t.backgroundPanel }).map(fadeSpan));
      // Drop shadow: one cell to the right (from the second row down)
      if (x0 + bw < width) {
        if (y > y0) spans.push({ text: " ", bg: shadowBg });
        else spans.push(...sliceRow(row, x0 + bw, x0 + bw + 1, { bg: backBg }).map(dimSpan));
        spans.push(...sliceRow(row, x0 + bw + 1, width, { bg: backBg }).map(dimSpan));
      }
    } else {
      // Shadow under the box, shifted one cell right
      const end = Math.min(width, x0 + bw + 1);
      spans.push({ text: " ".repeat(Math.max(0, end - x0 - 1)), bg: shadowBg });
      spans.push(...sliceRow(row, end, width, { bg: backBg }).map(dimSpan));
    }
    out.push({ spans });
  }
  return out;
}
