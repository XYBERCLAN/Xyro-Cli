// XYRO Model Picker Overlay
// A full-screen-width pop-out panel that slides in over the prompt.
// Models are grouped: RECENTLY USED → FREE providers → PAID providers,
// each provider gets its own small title row, and big separators split
// the free/paid tiers and the recently-used block.
// Nav: ↑↓ to move (skips headers), type to filter, Enter to select, Esc to close.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth } from "./core.js";
import { getAllModels, filterModelCatalog, ModelEntry, buildModelSections, ModelSection, ProviderGroup } from "../models/catalog.js";
import { getRecentModelIds } from "../models/recents.js";

// Brand colours used inside the picker
const BRAND_BLUE      = "#38BDF8";
const BRAND_GREEN     = "#22C55E";
const BRAND_LEMON     = "#C6F135";
const BRAND_AMBER     = "#F59E0B";
const BRAND_RED       = "#EF4444";
const BADGE_FREE_FG   = "#0D1117";
const BADGE_PAID_FG   = "#0D1117";
const BADGE_LOCAL_FG  = "#0D1117";

// ── Row types used for grouped rendering & navigation ────────────────────────
type Row =
  | { kind: "section"; section: ModelSection }
  | { kind: "provider"; group: ProviderGroup; sectionKind: ModelSection["kind"] }
  | { kind: "model"; model: ModelEntry; index: number }; // index = position among selectable rows

export class ModelPicker {
  private visible    = false;
  private query      = "";
  private rows       : Row[] = [];
  private selectable : ModelEntry[] = [];
  private cursor     = 0;          // index into selectable[]
  private scrollOff  = 0;          // index of first visible row (across rows[])
  private maxVisible = 14;         // max rows shown before scrolling (incl. headers)

  /** Currently active model – used to mark CURRENT */
  private currentModel = "";

  /** Callback invoked when user picks a model */
  private onSelectCb: ((id: string, baseURL?: string) => void) | null = null;
  /** Callback invoked when user closes without selecting */
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(currentModel: string): void {
    this.visible      = true;
    this.currentModel = currentModel;
    this.query        = "";
    this._rebuild();
    // Start cursor on the currently selected model
    const idx = this.selectable.findIndex(m => m.id === currentModel);
    this.cursor   = idx >= 0 ? idx : 0;
    this.scrollOff = Math.max(0, this._rowOfSelectable(this.cursor) - Math.floor(this.maxVisible / 2));
  }

  close(): void { this.visible = false; }

  onSelect(cb: (id: string, baseURL?: string) => void): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void  { this.onCloseCb = cb; }

  /** Feed a raw key press into the picker. Returns true if consumed. */
  handleKey(key: string): boolean {
    if (!this.visible) return false;

    const cp = key.codePointAt(0) ?? 0;

    // Escape → close
    if (key === "\u001b") {
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }

    // Enter → select
    if (cp === 13) {
      const entry = this.selectable[this.cursor];
      if (entry) {
        this.visible = false;
        this.onSelectCb?.(entry.id, entry.baseURL);
      }
      return true;
    }

    // Arrow up
    if (key === "\u001b[A") {
      this.cursor = Math.max(0, this.cursor - 1);
      this._clampScroll();
      return true;
    }

    // Arrow down
    if (key === "\u001b[B") {
      this.cursor = Math.min(this.selectable.length - 1, this.cursor + 1);
      this._clampScroll();
      return true;
    }

    // Backspace
    if (cp === 127 || cp === 8) {
      this.query = this.query.slice(0, -1);
      this._rebuild();
      return true;
    }

    // Ctrl+U clear search
    if (cp === 21) {
      this.query = "";
      this._rebuild();
      return true;
    }

    // Printable characters → search filter
    if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this._rebuild();
      return true;
    }

    return true; // consume all keys while open
  }

  // ── Grouped list construction ──────────────────────────────────────────────

  private _rebuild(): void {
    const models = filterModelCatalog(this.query);
    const sections = buildModelSections(models, getRecentModelIds());

    const rows: Row[] = [];
    const selectable: ModelEntry[] = [];

    for (const section of sections) {
      rows.push({ kind: "section", section });
      for (const group of section.groups) {
        rows.push({ kind: "provider", group, sectionKind: section.kind });
        for (const m of group.models) {
          rows.push({ kind: "model", model: m, index: selectable.length });
          selectable.push(m);
        }
      }
    }

    this.rows = rows;
    this.selectable = selectable;
    this.cursor = 0;
    this.scrollOff = 0;
  }

  /** Row-array index of the n-th selectable model */
  private _rowOfSelectable(n: number): number {
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (r.kind === "model" && r.index === n) return i;
    }
    return 0;
  }

  private _clampScroll(): void {
    const curRow = this._rowOfSelectable(this.cursor);
    // Keep the selected model's row inside the visible window
    if (curRow < this.scrollOff) {
      this.scrollOff = curRow;
    } else if (curRow >= this.scrollOff + this.maxVisible) {
      this.scrollOff = curRow - this.maxVisible + 1;
    }
    // Never scroll past the end
    if (this.scrollOff > Math.max(0, this.rows.length - 1)) {
      this.scrollOff = Math.max(0, this.rows.length - this.maxVisible);
    }
  }

  /** Render the picker overlay as a list of RenderLine rows. */
  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const out: RenderLine[] = [];

    const boxW   = Math.max(60, Math.min(88, termWidth - 4));
    const innerW = boxW - 2;
    const leftM  = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin  = " ".repeat(leftM);

    // ── helpers ──────────────────────────────────────────────────────────────
    const pad = (s: string, w: number) => {
      const v = visualWidth(s);
      return v >= w ? s.slice(0, w) : s + " ".repeat(w - v);
    };

    // ── Row 1: Top border with XYRO branding ─────────────────────────────────
    const title     = " Switch Model ";
    const badge     = " [XYRO] ";
    const dashCount = Math.max(1, innerW - title.length - badge.length - 1);
    out.push(line(
      span(margin),
      span("╭─",            { fg: BRAND_BLUE }),
      span(title,           { fg: "#F3F4F6", bold: true }),
      span("─".repeat(dashCount), { fg: BRAND_BLUE }),
      span(badge,           { fg: BRAND_LEMON, bold: true }),
      span("╮",             { fg: BRAND_BLUE }),
    ));

    // ── Row 2: Search filter bar ──────────────────────────────────────────────
    const searchLabel = "  🔍 Search: ";
    const cursor      = this.query.length < innerW - 30
      ? this.query + "▌"
      : this.query.slice(-(innerW - 32)) + "▌";
    const hint        = " (↑↓ nav · Esc close)  ";
    const searchUsed  = visualWidth(searchLabel) + visualWidth(cursor) + visualWidth(hint);
    const searchPad   = Math.max(0, innerW - searchUsed);
    out.push(line(
      span(margin),
      span("│",            { fg: BRAND_BLUE }),
      span(searchLabel,    { fg: BRAND_BLUE, bg: t.backgroundElement }),
      span(cursor,         { fg: "#F3F4F6", bg: t.backgroundElement }),
      span(" ".repeat(searchPad), { bg: t.backgroundElement }),
      span(hint,           { fg: tint(t.textMuted, 0.65), bg: t.backgroundElement }),
      span("│",            { fg: BRAND_BLUE }),
    ));

    // ── Row 3: Separator ─────────────────────────────────────────────────────
    out.push(line(
      span(margin),
      span("├",           { fg: BRAND_BLUE }),
      span("─".repeat(innerW), { fg: t.border }),
      span("┤",           { fg: BRAND_BLUE }),
    ));

    // ── Rows 4…N: Grouped model list ──────────────────────────────────────────
    if (this.selectable.length === 0) {
      const noMatch = "  No models match your search.";
      const noPad   = Math.max(0, innerW - visualWidth(noMatch));
      out.push(line(
        span(margin),
        span("│",          { fg: BRAND_BLUE }),
        span(noMatch,      { fg: tint(t.textMuted, 0.7), bg: t.backgroundElement }),
        span(" ".repeat(noPad), { bg: t.backgroundElement }),
        span("│",          { fg: BRAND_BLUE }),
      ));
    } else {
      const visibleEnd = Math.min(this.scrollOff + this.maxVisible, this.rows.length);
      for (let i = this.scrollOff; i < visibleEnd; i++) {
        const row = this.rows[i];

        if (row.kind === "section") {
          // ── Big section separator: ═══ RECENTLY USED ═══ ──
          const sec = row.section;
          const label = ` ${sec.title} `;
          const labelW = visualWidth(label);
          const side = Math.max(1, Math.floor((innerW - labelW) / 2));

          let fgCol = BRAND_AMBER;
          if (sec.kind === "RECENT") fgCol = BRAND_LEMON;
          else if (sec.kind === "FREE") fgCol = BRAND_GREEN;
          else fgCol = BRAND_AMBER;

          out.push(line(
            span(margin),
            span("│",                  { fg: BRAND_BLUE }),
            span("═".repeat(side),     { fg: fgCol }),
            span(label,                { fg: "#0D1117", bg: fgCol, bold: true }),
            span("═".repeat(Math.max(1, innerW - side - labelW)), { fg: fgCol }),
            span("│",                  { fg: BRAND_BLUE }),
          ));
          continue;
        }

        if (row.kind === "provider") {
          // ── Small provider title: ── Provider Name (N) ──
          const g = row.group;
          const gLabel = `${g.provider} (${g.models.length})`;
          const smallTitle = `─ ${gLabel} `;
          const rest = Math.max(1, innerW - visualWidth(smallTitle));
          out.push(line(
            span(margin),
            span("│",              { fg: BRAND_BLUE }),
            span(smallTitle,        { fg: BRAND_BLUE, bg: t.backgroundPanel, bold: true }),
            span("─".repeat(rest),  { fg: tint(t.border, 0.8), bg: t.backgroundPanel }),
            span("│",              { fg: BRAND_BLUE }),
          ));
          continue;
        }

        // ── Model row ────────────────────────────────────────────────────────
        const m = row.model;
        const selected   = row.index === this.cursor;
        const isCurrent  = m.id === this.currentModel;
        const bg         = selected ? t.backgroundMenu : t.backgroundElement;
        const pointer    = selected ? "› " : "  ";

        // Badge colours
        let badgeSpan: StyledSpan;
        if (m.badge === "FREE") {
          badgeSpan = span("[FREE] ", { fg: BADGE_FREE_FG, bg: BRAND_GREEN, bold: true });
        } else if (m.badge === "LOCAL") {
          badgeSpan = span("[LCL]  ", { fg: BADGE_LOCAL_FG, bg: BRAND_LEMON, bold: true });
        } else {
          badgeSpan = span("[PAID] ", { fg: BADGE_PAID_FG, bg: "#F59E0B", bold: true });
        }

        // Model id column — 24 chars
        const modelCol    = pad(m.id, 24);
        // Provider column — 17 chars
        const providerCol = pad(m.provider, 17);
        // Description — remaining space
        const descRaw     = isCurrent ? "● CURRENT" : m.desc;
        const fixedUsed   = 2 + 24 + 1 + 17 + 1 + 7 + 1;  // pointer + cols
        const descW       = Math.max(8, innerW - fixedUsed - 1);
        const descCol     = descRaw.length > descW ? descRaw.slice(0, descW - 1) + "…" : pad(descRaw, descW);
        const usedRowW    = 2 + visualWidth(modelCol) + 1 + visualWidth(providerCol) + 1 + 7 + 1 + visualWidth(descCol);
        const rowPad      = Math.max(0, innerW - usedRowW);

        out.push(line(
          span(margin),
          span("│",          { fg: BRAND_BLUE }),
          span(pointer,      { fg: selected ? BRAND_LEMON : tint(t.textMuted, 0.6), bg, bold: selected }),
          span(modelCol,     { fg: selected ? "#F3F4F6" : tint(t.text, 0.9), bg, bold: selected }),
          span(" ",          { bg }),
          span(providerCol,  { fg: tint(t.textMuted, 0.85), bg }),
          span(" ",          { bg }),
          { ...badgeSpan, bg: m.badge === "FREE" ? BRAND_GREEN : m.badge === "LOCAL" ? BRAND_LEMON : "#F59E0B" },
          span(" ",          { bg }),
          span(descCol,      {
            fg: isCurrent ? BRAND_BLUE : tint(t.textMuted, selected ? 0.95 : 0.75),
            bg, bold: isCurrent,
          }),
          span(" ".repeat(rowPad), { bg }),
          span("│",          { fg: BRAND_BLUE }),
        ));
      }
    }

    // ── Scroll hint row if list is taller than maxVisible ────────────────────
    if (this.rows.length > this.maxVisible) {
      const shown = Math.min(this.scrollOff + this.maxVisible, this.rows.length);
      const scrollInfo = `  ${this.selectable.length} models · rows ${this.scrollOff + 1}–${shown} of ${this.rows.length}  `;
      const scrollPad  = Math.max(0, innerW - visualWidth(scrollInfo));
      out.push(line(
        span(margin),
        span("│",             { fg: BRAND_BLUE }),
        span(scrollInfo,      { fg: tint(t.textMuted, 0.6), bg: t.backgroundPanel }),
        span(" ".repeat(scrollPad), { bg: t.backgroundPanel }),
        span("│",             { fg: BRAND_BLUE }),
      ));
    }

    // ── Bottom border ─────────────────────────────────────────────────────────
    const btmHint  = " ↑↓ Navigate · Enter Select · Ctrl+U Clear ";
    const btmDash  = Math.max(1, innerW - btmHint.length - 1);
    out.push(line(
      span(margin),
      span("╰─",          { fg: BRAND_BLUE }),
      span(btmHint,        { fg: tint(t.textMuted, 0.7) }),
      span("─".repeat(btmDash), { fg: BRAND_BLUE }),
      span("╯",            { fg: BRAND_BLUE }),
    ));

    return out;
  }
}
