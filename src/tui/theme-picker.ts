// XYRO Theme Gallery Pop-Out Overlay
// Browse, filter, live-preview, and select themes with real-time swatch rendering.
// Follows universal TUI design guidelines from tui-design and impeccable craft.

import { currentTheme, setTheme, tint, THEME_CATALOG, ThemeInfo, Theme } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth } from "./core.js";

const BRAND_BLUE = "#38BDF8";
const BRAND_LEMON = "#C6F135";
const BRAND_GREEN = "#22C55E";

export class ThemePicker {
  private visible = false;
  private cursor = 0;
  private query = "";
  private filtered: ThemeInfo[] = THEME_CATALOG.slice();
  private originalThemeId = "xyro";
  private scrollOff = 0;
  private maxVisible = 8;
  private onSelectCb: ((theme: ThemeInfo) => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(currentThemeId: string): void {
    this.visible = true;
    this.originalThemeId = currentThemeId;
    this.query = "";
    this.filtered = THEME_CATALOG.slice();
    const idx = this.filtered.findIndex((t) => t.id === currentThemeId);
    this.cursor = idx >= 0 ? idx : 0;
    this.scrollOff = Math.max(0, this.cursor - Math.floor(this.maxVisible / 2));
  }

  close(): void {
    if (this.visible) {
      setTheme(this.originalThemeId);
      this.visible = false;
    }
  }

  onSelect(cb: (theme: ThemeInfo) => void): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;

    // Esc: revert preview and close
    if (key === "\u001b") {
      setTheme(this.originalThemeId);
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }

    // Enter: commit selection
    if (cp === 13) {
      const chosen = this.filtered[this.cursor];
      if (chosen) {
        setTheme(chosen.id);
        this.originalThemeId = chosen.id;
        this.visible = false;
        this.onSelectCb?.(chosen);
      }
      return true;
    }

    // Up Arrow
    if (key === "\u001b[A") {
      this.cursor = Math.max(0, this.cursor - 1);
      this._clampScroll();
      this._livePreview();
      return true;
    }

    // Down Arrow
    if (key === "\u001b[B") {
      this.cursor = Math.min(this.filtered.length - 1, this.cursor + 1);
      this._clampScroll();
      this._livePreview();
      return true;
    }

    // Backspace
    if (cp === 127 || cp === 8) {
      this.query = this.query.slice(0, -1);
      this._refilter();
      return true;
    }

    // Ctrl+U
    if (cp === 21) {
      this.query = "";
      this._refilter();
      return true;
    }

    // Filter typing
    if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this._refilter();
      return true;
    }

    return true;
  }

  private _livePreview(): void {
    const item = this.filtered[this.cursor];
    if (item) {
      setTheme(item.id);
    }
  }

  private _refilter(): void {
    const q = this.query.trim().toLowerCase();
    if (!q) {
      this.filtered = THEME_CATALOG.slice();
    } else {
      this.filtered = THEME_CATALOG.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.desc.toLowerCase().includes(q)
      );
    }
    this.cursor = 0;
    this.scrollOff = 0;
    this._livePreview();
  }

  private _clampScroll(): void {
    if (this.cursor < this.scrollOff) {
      this.scrollOff = this.cursor;
    } else if (this.cursor >= this.scrollOff + this.maxVisible) {
      this.scrollOff = this.cursor - this.maxVisible + 1;
    }
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(78, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const out: RenderLine[] = [];

    const borderCol = t.primary || BRAND_BLUE;

    // 1. Top border
    const titleStr = " Theme Gallery ";
    const badge = " [XYRO] ";
    const topDash = Math.max(1, innerW - visualWidth(titleStr) - visualWidth(badge) - 1);
    out.push(
      line(
        span(margin),
        span("╭─", { fg: borderCol }),
        span(titleStr, { fg: "#F3F4F6", bold: true }),
        span("─".repeat(topDash), { fg: borderCol }),
        span(badge, { fg: BRAND_LEMON, bold: true }),
        span("╮", { fg: borderCol })
      )
    );

    // 2. Search row
    const searchLbl = "  🔍 Search: ";
    const cursorStr = this.query + "▌";
    const searchHint = "(↑↓ live preview · Enter apply · Esc revert)  ";
    const usedSearch = visualWidth(searchLbl) + visualWidth(cursorStr) + visualWidth(searchHint);
    const searchPad = Math.max(0, innerW - usedSearch);
    out.push(
      line(
        span(margin),
        span("│", { fg: borderCol }),
        span(searchLbl, { fg: borderCol, bg: t.backgroundElement }),
        span(cursorStr, { fg: "#F3F4F6", bg: t.backgroundElement }),
        span(" ".repeat(searchPad), { bg: t.backgroundElement }),
        span(searchHint, { fg: tint(t.textMuted, 0.65), bg: t.backgroundElement }),
        span("│", { fg: borderCol })
      )
    );

    // 3. Separator
    out.push(
      line(
        span(margin),
        span("├", { fg: borderCol }),
        span("─".repeat(innerW), { fg: t.border }),
        span("┤", { fg: borderCol })
      )
    );

    // 4. Rows
    if (this.filtered.length === 0) {
      const noMatch = "  No themes match your search query.";
      const pad = Math.max(0, innerW - visualWidth(noMatch));
      out.push(
        line(
          span(margin),
          span("│", { fg: borderCol }),
          span(noMatch, { fg: tint(t.textMuted, 0.7), bg: t.backgroundElement }),
          span(" ".repeat(pad), { bg: t.backgroundElement }),
          span("│", { fg: borderCol })
        )
      );
    } else {
      const visibleEnd = Math.min(this.scrollOff + this.maxVisible, this.filtered.length);
      for (let i = this.scrollOff; i < visibleEnd; i++) {
        const item = this.filtered[i];
        const selected = i === this.cursor;
        const isCurrent = item.id === this.originalThemeId;
        const bg = selected ? t.backgroundMenu : t.backgroundElement;
        const pointer = selected ? "› " : "  ";

        const nameCol = item.name.padEnd(17);
        const catCol = `[${item.category}]`.padEnd(9);

        // Color swatches: ● ■ ▲ in primary, secondary, and accent colors
        const swatch1 = span("●", { fg: item.primary, bg });
        const swatch2 = span("■", { fg: item.secondary, bg });
        const swatch3 = span("▲ ", { fg: item.accent, bg });

        const activeTag = isCurrent ? "● CURRENT" : "";
        const fixedUsed = 2 + 17 + 9 + 4 + (activeTag ? 10 : 0);
        const descW = Math.max(8, innerW - fixedUsed - 2);
        const descCol = item.desc.length > descW ? item.desc.slice(0, descW - 1) + "…" : item.desc.padEnd(descW);

        const usedW = 2 + visualWidth(nameCol) + visualWidth(catCol) + 4 + visualWidth(descCol) + (activeTag ? 10 : 0);
        const pad = Math.max(0, innerW - usedW);

        out.push(
          line(
            span(margin),
            span("│", { fg: borderCol }),
            span(pointer, { fg: selected ? BRAND_LEMON : tint(t.textMuted, 0.5), bg, bold: selected }),
            span(nameCol, { fg: selected ? "#FFFFFF" : tint(t.text, 0.95), bg, bold: selected }),
            span(catCol, { fg: item.primary, bg }),
            swatch1,
            swatch2,
            swatch3,
            span(descCol, { fg: selected ? "#F3F4F6" : tint(t.textMuted, 0.8), bg }),
            ...(activeTag ? [span("  "), span(activeTag, { fg: BRAND_GREEN, bg, bold: true })] : []),
            span(" ".repeat(pad), { bg }),
            span("│", { fg: borderCol })
          )
        );
      }
    }

    // 5. Scroll info
    if (this.filtered.length > this.maxVisible) {
      const shown = Math.min(this.scrollOff + this.maxVisible, this.filtered.length);
      const scrollInfo = `  ${this.scrollOff + 1}–${shown} of ${this.filtered.length} themes  `;
      const scrollPad = Math.max(0, innerW - visualWidth(scrollInfo));
      out.push(
        line(
          span(margin),
          span("│", { fg: borderCol }),
          span(scrollInfo, { fg: tint(t.textMuted, 0.6), bg: t.backgroundPanel }),
          span(" ".repeat(scrollPad), { bg: t.backgroundPanel }),
          span("│", { fg: borderCol })
        )
      );
    }

    // 6. Bottom border
    const btmHint = " ↑↓ Preview · Enter Apply · Esc Cancel ";
    const btmDash = Math.max(1, innerW - visualWidth(btmHint) - 1);
    out.push(
      line(
        span(margin),
        span("╰─", { fg: borderCol }),
        span(btmHint, { fg: tint(t.textMuted, 0.75) }),
        span("─".repeat(btmDash), { fg: borderCol }),
        span("╯", { fg: borderCol })
      )
    );

    return out;
  }
}
