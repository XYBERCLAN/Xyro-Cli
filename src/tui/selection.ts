// Mouse text-selection engine for XYRO.
// Tracks a drag from press → release in screen coordinates, exposes the
// selected plain text, and produces a highlight overlay (per-row reversed
// spans) that the renderer composes over the painted frame.

import { RenderLine, StyledSpan, span, line, visualWidth, linePlainText, copyToClipboard, tuiSize } from "./core.js";

export interface ToastState {
  text: string;
  expiresAt: number;
  kind: "info" | "success" | "error";
}

export class SelectionManager {
  private active = false;
  private anchor: { x: number; y: number } | null = null;
  private head: { x: number; y: number } | null = null;

  // Last painted frame snapshot (rows), kept in sync by TuiApp before render
  frameRows: RenderLine[] = [];

  private toast: ToastState | null = null;
  /** Where the last plain click landed (links open on click) */
  lastClick: { x: number; y: number } | null = null;

  /** The web address under a screen position (1-based), if any. */
  urlAt(x: number, y: number): string | null {
    const row = this.frameRows[y - 1];
    if (!row) return null;
    const text = linePlainText(row);
    for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
      const start = (m.index ?? 0) + 1;
      const end = start + m[0].length - 1;
      if (x >= start && x <= end) return m[0].replace(/[.,;:!?]+$/, "");
    }
    return null;
  }

  isSelecting(): boolean {
    return this.active && this.anchor !== null;
  }

  hasSelection(): boolean {
    return this.anchor !== null && this.head !== null && !this.active;
  }

  hasToast(): boolean {
    return this.toast !== null && this.toast.expiresAt > Date.now();
  }

  onMouse(e: { kind: string; x: number; y: number }): boolean {
    if (e.kind === "press") {
      // Start a new selection; any previous completed selection is cleared
      this.active = true;
      this.anchor = { x: e.x, y: e.y };
      this.head = { x: e.x, y: e.y };
      return true;
    }
    if (e.kind === "drag") {
      if (this.active && this.anchor) {
        this.head = { x: e.x, y: e.y };
        return true;
      }
      return false;
    }
    if (e.kind === "release") {
      if (!this.active || !this.anchor) {
        this.anchor = null;
        this.head = null;
        this.active = false;
        return false;
      }
      this.head = { x: e.x, y: e.y };
      this.active = false;
      // A click, or a tiny accidental drag (under 2 characters on one row), is not a selection:
      // only a real selection gets copied
      if (this.anchor.y === this.head.y && Math.abs(this.anchor.x - this.head.x) < 2) {
        this.lastClick = { x: this.head.x, y: this.head.y };
        this.anchor = null;
        this.head = null;
        return true;
      }
      this.lastClick = null;
      return true;
    }
    return false;
  }

  clear(): void {
    this.anchor = null;
    this.head = null;
    this.active = false;
  }

  /** Ordered (top-left → bottom-right) selection bounds in 1-based screen coords */
  bounds(): { x1: number; y1: number; x2: number; y2: number } | null {
    if (!this.anchor || !this.head) return null;
    const x1 = Math.min(this.anchor.x, this.head.x);
    const x2 = Math.max(this.anchor.x, this.head.x);
    const y1 = Math.min(this.anchor.y, this.head.y);
    const y2 = Math.max(this.anchor.y, this.head.y);
    return { x1, y1, x2, y2 };
  }

  /**
   * Produce an overlay array (1 row per screen line) where selected spans are
   * re-emitted with swapped fg/bg (reverse-video highlight). Non-selected rows
   * are null. Rows beyond the frame are null.
   */
  highlightOverlay(): (RenderLine | null)[] {
    const b = this.bounds();
    if (!b) return [];
    const out: (RenderLine | null)[] = [];
    for (let y = 1; y <= b.y2; y++) {
      if (y < b.y1) continue;
      const row = this.frameRows[y - 1];
      if (!row) {
        out.push(null);
        continue;
      }
      // Column coverage for this row
      let from: number, to: number;
      if (b.y1 === b.y2) {
        from = b.x1;
        to = b.x2;
      } else if (y === b.y1) {
        from = b.x1;
        to = tuiSize().width; // to end of line
      } else if (y === b.y2) {
        from = 1;
        to = b.x2;
      } else {
        from = 1;
        to = tuiSize().width;
      }
      out.push(highlightRow(row, from, to));
    }
    return out;
  }

  /** Extract the selected plain text from the last painted frame */
  selectedText(): string {
    const b = this.bounds();
    if (!b || !this.frameRows.length) return "";
    const parts: string[] = [];
    for (let y = b.y1; y <= b.y2; y++) {
      const row = this.frameRows[y - 1];
      if (!row) continue;
      const plain = linePlainText(row);
      let from: number, to: number;
      if (b.y1 === b.y2) {
        from = b.x1 - 1;
        to = b.x2;
      } else if (y === b.y1) {
        from = b.x1 - 1;
        to = plain.length;
      } else if (y === b.y2) {
        from = 0;
        to = b.x2;
      } else {
        from = 0;
        to = plain.length;
      }
      const seg = plain.slice(from, Math.max(from, to));
      parts.push(seg.replace(/\s+$/, ""));
    }
    return parts.join("\n");
  }

  /** Copy the current completed selection; shows a toast either way */
  copySelection(): boolean {
    if (!this.hasSelection()) return false;
    const text = this.selectedText();
    if (!text) {
      this.showToast("Nothing to copy", "error");
      return false;
    }
    const ok = copyToClipboard(text);
    if (ok) {
      const preview = text.replace(/\s+/g, " ").slice(0, 40) + (visualWidth(text) > 40 ? "…" : "");
      this.showToast(`Copied ${text.length} chars: ${preview}`, "success");
    } else {
      this.showToast("Copy not supported by this terminal", "error");
    }
    return ok;
  }

  showToast(text: string, kind: ToastState["kind"] = "info", ttlMs = 2500): void {
    this.toast = { text, expiresAt: Date.now() + ttlMs, kind };
  }

  currentToast(): ToastState | null {
    return this.hasToast() ? this.toast : null;
  }
}

/** Swap fg/bg on the columns [from,to] (1-based, inclusive) of a row */
function highlightRow(row: RenderLine, from: number, to: number): RenderLine | null {
  const spans: StyledSpan[] = [];
  let col = 1;
  let touched = false;

  for (const s of row.spans) {
    if (col > to) {
      spans.push(s);
      continue;
    }
    const vw = visualWidth(s.text);
    const sStart = col;
    const sEnd = col + vw - 1;
    if (sEnd < from) {
      spans.push(s);
      col += vw;
      continue;
    }
    // Overlap with [from, to]
    const lead = Math.max(0, from - sStart); // cells before highlight
    const trail = Math.max(0, sEnd - to);    // cells after highlight
    const text = s.text;
    let idx = 0;
    let leadTxt = "";
    let leadW = 0;
    while (leadW < lead && idx < text.length) {
      const ch = text[idx];
      leadTxt += ch;
      leadW += visualWidth(ch);
      idx++;
    }
    let trailTxt = "";
    let trailW = 0;
    let tIdx = text.length - 1;
    while (trailW < trail && tIdx >= idx) {
      const ch = text[tIdx];
      trailTxt = ch + trailTxt;
      trailW += visualWidth(ch);
      tIdx--;
    }
    const midEnd = trailW > 0 ? tIdx + 1 : text.length;
    const midTxt = text.slice(idx, midEnd);

    if (leadTxt) spans.push({ ...s, text: leadTxt });
    if (midTxt) {
      spans.push({
        text: midTxt,
        // swap: use bg as fg and vice versa; keep bold. Fallbacks keep contrast.
        fg: s.bg || "#0D1117",
        bg: s.fg || "#38BDF8",
        bold: s.bold,
      });
      touched = true;
    }
    if (trailTxt) spans.push({ ...s, text: trailTxt });
    col += vw;
  }

  // Highlight trailing whitespace cells on the row (past last span text)
  if (col <= to) {
    spans.push(span(" ".repeat(to - col + 1), { fg: "#0D1117", bg: "#38BDF8" }));
    touched = true;
  }

  return touched ? line(...spans) : null;
}
