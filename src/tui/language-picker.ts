// First launch (and /language): which language should XYRO speak?
// XYRO answers in the chosen language; experts write their reports in it too.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span } from "./core.js";
import { modalFrame } from "./overlays.js";
import { LANGUAGES, Language } from "../config/languages.js";

export { LANGUAGES, languageByCode } from "../config/languages.js";
export type { Language } from "../config/languages.js";

export class LanguagePicker {
  private visible = false;
  private welcome = false;
  private cursor = 0;
  private onSelectCb: ((lang: Language) => void) | null = null;

  isOpen(): boolean {
    return this.visible;
  }

  open(current?: string, welcome = false): void {
    this.visible = true;
    this.welcome = welcome;
    this.cursor = Math.max(0, LANGUAGES.findIndex((l) => l.code === current));
  }

  close(): void {
    // Closing the welcome step keeps English and moves on
    if (this.visible && this.welcome) this.onSelectCb?.(LANGUAGES[0]);
    this.visible = false;
  }

  onSelect(cb: (lang: Language) => void): void {
    this.onSelectCb = cb;
  }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    const n = LANGUAGES.length;
    if (key === "\u001b[A") this.cursor = (this.cursor - 1 + n) % n;
    else if (key === "\u001b[B" || cp === 9) this.cursor = (this.cursor + 1) % n;
    else if (cp === 13) {
      this.visible = false;
      this.onSelectCb?.(LANGUAGES[this.cursor]);
    } else if (key === "\u001b") this.close();
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(46, Math.min(64, termWidth - 6));
    const muted = tint(t.textMuted, 0.9);
    // The greeting cycles through the languages, so everyone sees one they read
    const greet = LANGUAGES[Math.floor(Date.now() / 1600) % LANGUAGES.length].choose;
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [];
    if (this.welcome) {
      body.push([span("   Welcome to XYRO.", { fg: t.text, bold: true })]);
      body.push([span("   Which language should XYRO speak with you?", { fg: muted })]);
    } else {
      body.push([span("   Which language should XYRO speak with you?", { fg: t.text, bold: true })]);
    }
    body.push([span(`   ${greet}`, { fg: t.accent, italic: true })]);
    body.push([]);
    LANGUAGES.forEach((l, i) => {
      const sel = i === this.cursor;
      const bg = sel ? t.backgroundMenu : t.backgroundPanel;
      body.push({
        spans: [
          span(sel ? " ▌ " : "   ", { fg: t.accent, bold: true }),
          span(l.native, { fg: sel ? t.text : tint(t.text, 0.9), bold: sel }),
          ...(l.native !== l.name ? [span(`  ${l.name}`, { fg: tint(t.textMuted, 0.7) })] : []),
        ],
        bg,
      });
    });
    return modalFrame(this.welcome ? "Welcome" : "Language", boxW, body, "↑↓ choose · enter confirm · /language to change later", t.accent);
  }
}
