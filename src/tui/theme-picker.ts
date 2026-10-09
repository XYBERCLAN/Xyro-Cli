// XYRO theme gallery — two panes: themes grouped Dark / Light on the left, a
// live preview of a real XYRO session (message, tools, diff, code) on the right.
// Moving the cursor previews a theme without saving; Enter saves; Esc reverts.
// The same gallery runs as the first-launch "Welcome" step.

import { currentTheme, setTheme, previewTheme, tint, THEME_CATALOG, THEMES, ThemeInfo } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth, wrapSpans } from "./core.js";
import { renderModalTopBorder, renderModalBottomBorder } from "./overlays.js";

const LIST_W = 40;
const BODY_H = 18;

type Row = { kind: "group"; label: string } | { kind: "item"; index: number };

export class ThemePicker {
  private visible = false;
  private welcome = false;
  private cursor = 0;
  private query = "";
  private filtered: ThemeInfo[] = THEME_CATALOG.slice();
  private originalThemeId = "xyro";
  private onSelectCb: ((theme: ThemeInfo) => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }
  isWelcome(): boolean { return this.visible && this.welcome; }

  open(currentThemeId: string, welcome = false): void {
    this.visible = true;
    this.welcome = welcome;
    // First launch starts on the recommended default (XYRO Cyber, dark)
    this.originalThemeId = welcome ? "xyro" : currentThemeId;
    if (welcome) previewTheme("xyro");
    this.query = "";
    this.filtered = ordered(THEME_CATALOG);
    const idx = this.filtered.findIndex((t) => t.id === this.originalThemeId);
    this.cursor = idx >= 0 ? idx : 0;
  }

  close(): void {
    if (this.visible) {
      previewTheme(this.originalThemeId);
      this.visible = false;
    }
  }

  onSelect(cb: (theme: ThemeInfo) => void): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    const n = this.filtered.length;

    if (key === "\u001b") {
      // Revert the preview. In welcome mode this means "keep the default".
      if (this.welcome) setTheme(this.originalThemeId);
      else previewTheme(this.originalThemeId);
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }

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

    if (key === "\u001b[A" || cp === 16) {
      if (n) this.cursor = (this.cursor - 1 + n) % n;
      this.preview();
      return true;
    }
    if (key === "\u001b[B" || cp === 14 || cp === 9) {
      if (n) this.cursor = (this.cursor + 1) % n;
      this.preview();
      return true;
    }

    if (cp === 127 || cp === 8) {
      this.query = this.query.slice(0, -1);
      this.refilter();
      return true;
    }
    if (cp === 21) {
      this.query = "";
      this.refilter();
      return true;
    }
    if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this.refilter();
      return true;
    }
    return true;
  }

  private preview(): void {
    const item = this.filtered[this.cursor];
    if (item) previewTheme(item.id);
  }

  private refilter(): void {
    const q = this.query.trim().toLowerCase();
    const all = ordered(THEME_CATALOG);
    this.filtered = q
      ? all.filter((t) => [t.id, t.name, t.category, t.desc].some((f) => f.toLowerCase().includes(q)))
      : all;
    this.cursor = 0;
    this.preview();
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(52, Math.min(termWidth - 6, 104));
    const innerW = boxW - 2;
    const withPreview = innerW >= LIST_W + 34;
    const listW = withPreview ? LIST_W : innerW;
    const prevW = withPreview ? innerW - listW - 1 : 0;
    const panel = t.backgroundPanel;
    const frame = tint(t.border, 1);
    const muted = tint(t.textMuted, 0.9);

    // ── left pane: intro, filter, grouped list ───────────────────────────
    const left: StyledSpan[][] = [];
    left.push([]);
    if (this.welcome) {
      left.push([span("  Pick a look for your terminal.", { fg: t.text, bold: true })]);
      left.push([span("  Change it anytime with ", { fg: muted }), span("/theme", { fg: t.accent, bold: true })]);
      left.push([]);
    }
    left.push([
      span("  ❯ ", { fg: t.accent, bold: true }),
      ...(this.query ? [span(this.query, { fg: t.text, bold: true })] : [span("filter themes", { fg: tint(t.textMuted, 0.6), italic: true })]),
      span("▌", { fg: t.accent }),
    ]);
    left.push([]);

    const rows: Row[] = [];
    let lastGroup = "";
    this.filtered.forEach((th, i) => {
      const group = THEMES[th.id]?.light ? "Light" : "Dark";
      if (group !== lastGroup) {
        rows.push({ kind: "group", label: group });
        lastGroup = group;
      }
      rows.push({ kind: "item", index: i });
    });

    const listH = BODY_H - left.length;
    const cursorRow = rows.findIndex((r) => r.kind === "item" && r.index === this.cursor);
    const start = Math.max(0, Math.min(cursorRow - Math.floor(listH / 2), rows.length - listH));
    const windowRows = rows.slice(start, start + listH);

    if (this.filtered.length === 0) {
      left.push([span("  No theme matches ", { fg: muted }), span(`"${this.query}"`, { fg: t.text })]);
    }
    for (const r of windowRows) {
      if (r.kind === "group") {
        left.push([span("  " + r.label, { fg: tint(t.textMuted, 0.75), bold: true })]);
        continue;
      }
      const th = this.filtered[r.index];
      const sel = r.index === this.cursor;
      const bg = sel ? t.backgroundMenu : undefined;
      const tag = th.id === this.originalThemeId ? (this.welcome ? "default" : "current") : "";
      const nameW = listW - 2 - 2 - 10 - 1 - 8;
      const name = th.name.length > nameW ? th.name.slice(0, nameW - 1) + "…" : th.name.padEnd(nameW);
      left.push([
        span(sel ? " ▌" : "  ", { fg: t.accent, bold: true, bg }),
        span(" ", { bg }),
        span(name, { fg: sel ? t.text : tint(t.text, 0.85), bold: sel, bg }),
        ...swatch(th.id, bg),
        span(" " + tag.padEnd(8), { fg: tint(t.textMuted, 0.7), bg }),
      ]);
    }
    if (rows.length > listH) {
      left.push([span(`  ${this.cursor + 1} of ${this.filtered.length}`, { fg: tint(t.textMuted, 0.6) })]);
    }

    // ── right pane: live sample of the session in this theme ─────────────
    const right = withPreview ? previewPane(prevW, this.filtered[this.cursor]) : [];

    // ── assemble ──────────────────────────────────────────────────────────
    const out: RenderLine[] = [];
    out.push(renderModalTopBorder(this.welcome ? "Welcome to XYRO" : "Theme", innerW, ""));
    for (let r = 0; r < BODY_H; r++) {
      const l = fit(left[r] ?? [], listW, panel);
      const spans: StyledSpan[] = [span("│", { fg: frame, bg: panel }), ...l];
      if (withPreview) spans.push(span("│", { fg: tint(t.border, 0.6), bg: panel }), ...(right[r] ?? fit([], prevW, panel)));
      spans.push(span("│", { fg: frame, bg: panel }));
      out.push(line(...spans));
    }
    out.push(
      renderModalBottomBorder(this.welcome ? "↑↓ preview · enter choose · esc keep default" : "↑↓ preview · enter apply · esc cancel", innerW, "")
    );
    return out;
  }
}

/** Dark themes first (XYRO first of all), then light ones. */
function ordered(list: ThemeInfo[]): ThemeInfo[] {
  const rank = (t: ThemeInfo) => (THEMES[t.id]?.light ? 1 : 0) * 100 + (t.id.startsWith("xyro") ? 0 : 1);
  return list.slice().sort((a, b) => rank(a) - rank(b));
}

/** Five real colours from the theme: primary, secondary, accent, success, error. */
function swatch(id: string, bg?: string): StyledSpan[] {
  const th = THEMES[id];
  if (!th) return [span(" ".repeat(10), { bg })];
  return [th.primary, th.secondary, th.accent, th.success, th.error].map((c) => span("██", { fg: c, bg }));
}

/** Clip/pad spans to exactly w cells, filling with `bg` where spans have none. */
function fit(spans: StyledSpan[], w: number, bg: string): StyledSpan[] {
  const out: StyledSpan[] = [];
  let used = 0;
  for (const s of spans) {
    let text = "";
    for (const ch of Array.from(s.text)) {
      const cw = visualWidth(ch);
      if (used + cw > w) break;
      text += ch;
      used += cw;
    }
    if (text) out.push({ ...s, text, bg: s.bg ?? bg });
    if (used >= w) break;
  }
  if (used < w) out.push(span(" ".repeat(w - used), { bg }));
  return out;
}

/** A miniature XYRO session rendered in the active (previewed) theme. */
function previewPane(w: number, info: ThemeInfo | undefined): StyledSpan[][] {
  const t = currentTheme();
  const bg = t.background;
  const inner = w - 4;
  const rows: StyledSpan[][] = [];
  const add = (spans: StyledSpan[], rowBg = bg) => rows.push(fit([span("  ", { bg: rowBg }), ...spans.map((s) => ({ ...s, bg: s.bg ?? rowBg }))], w, rowBg));
  const dim = tint(t.textMuted, 0.65);

  add([]);
  add([span("▍ ", { fg: t.secondary, bg: t.backgroundPanel }), span("you", { fg: t.secondary, bold: true, bg: t.backgroundPanel }), span(" ".repeat(Math.max(1, inner - 5)), { bg: t.backgroundPanel })], bg);
  add([span("▍ ", { fg: t.secondary, bg: t.backgroundPanel }), span("add retries to the API client".padEnd(inner - 2).slice(0, inner - 2), { fg: t.text, bg: t.backgroundPanel })], bg);
  add([]);
  add([span("◆ ", { fg: t.accent }), span("xyro", { fg: t.primary, bold: true })]);
  add([span(" ✓ ", { fg: t.success, bold: true }), span("Read     ", { fg: t.primary, bold: true }), span("src/api.ts", { fg: tint(t.text, 0.8) }), span(" · 0.2s", { fg: dim })]);
  add([span(" ⠹ ", { fg: t.warning }), span("Run      ", { fg: t.warning, bold: true }), span("npm test", { fg: t.text })]);
  add([]);
  add([span(" - return fetch(url)".padEnd(inner), { fg: t.diffRemoved, bg: t.diffRemovedBg })]);
  add([span(" + return retry(() => fetch(url), 3)".padEnd(inner), { fg: t.diffAdded, bg: t.diffAddedBg })]);
  add([]);
  add([span(" const ", { fg: t.secondary }), span("delay", { fg: t.text }), span(" = ", { fg: t.textMuted }), span("250", { fg: t.warning }), span(" // ms", { fg: dim, italic: true })]);
  add([span(" ✗ ", { fg: t.error, bold: true }), span("429 rate limited, retrying", { fg: tint(t.text, 0.85) })]);
  add([]);
  if (info) {
    add([span(info.name, { fg: t.text, bold: true })]);
    for (const wl of wrapSpans([span(info.desc, { fg: tint(t.textMuted, 0.95) })], inner).slice(0, 2)) add(wl.spans);
  }
  while (rows.length < BODY_H) add([]);
  return rows.slice(0, BODY_H);
}
