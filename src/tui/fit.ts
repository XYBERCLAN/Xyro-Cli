// Pop-ups taller than the screen: keep the top (title, search field) and the
// footer, scroll the middle. Lists keep their selected row — the one that
// starts with "▌", XYRO's selection marker — in view; other pop-ups scroll
// with the mouse wheel. Hidden parts are announced with "↑ N more" / "↓ N more".

import { RenderLine, line, span, visualWidth } from "./core.js";
import { currentTheme, tint } from "../ui/theme.js";

export interface Fit {
  rows: RenderLine[];
  /** First visible middle row (keep it for the next frame) */
  scroll: number;
  /** The pop-up has a selected row (the wheel should move the selection) */
  hasCursor: boolean;
}

const text = (r: RenderLine) => r.spans.map((sp) => sp.text).join("");

export function fitToScreen(rows: RenderLine[], maxH: number, stickyTop: number, scroll: number): Fit {
  const focus = rows.findIndex((r, i) => i > 0 && /^│\s?▌/.test(text(r)));
  const hasCursor = focus !== -1;
  if (rows.length <= maxH || maxH < stickyTop + 5) return { rows, scroll: 0, hasCursor };

  const top = rows.slice(0, stickyTop);
  const bottom = rows.slice(-1);
  const middle = rows.slice(stickyTop, -1);
  const win = maxH - stickyTop - 1 - 2; // two indicator rows
  const maxStart = Math.max(0, middle.length - win);
  let start = scroll;
  if (hasCursor) {
    const f = focus - stickyTop;
    if (f < start + 1) start = Math.max(0, f - 1);
    else if (f > start + win - 2) start = f - win + 2;
  }
  start = Math.max(0, Math.min(maxStart, start));

  const t = currentTheme();
  const w = visualWidth(text(rows[0]));
  const indicator = (label: string) => {
    const pad = Math.max(0, w - 2 - visualWidth(label));
    return line(
      span("│", { fg: tint(t.border, 1), bg: t.backgroundPanel }),
      span(" ".repeat(Math.floor(pad / 2)) + label + " ".repeat(Math.ceil(pad / 2)), { fg: tint(t.textMuted, 0.75), bg: t.backgroundPanel }),
      span("│", { fg: tint(t.border, 1), bg: t.backgroundPanel })
    );
  };
  const below = middle.length - start - win;
  return {
    rows: [
      ...top,
      indicator(start > 0 ? `↑ ${start} more` : ""),
      ...middle.slice(start, start + win),
      indicator(below > 0 ? `↓ ${below} more · scroll or ↑↓` : ""),
      ...bottom,
    ],
    scroll: start,
    hasCursor,
  };
}
