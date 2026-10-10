// /skills and /plugins — see what XYRO can use, and read it.
//
// Skills: every SKILL.md XYRO and its experts can load (this project, yours,
// your Claude Code skills, plugin skills), grouped by where they come from,
// with their track record. Enter opens one to read in full.
// Plugins: every folder in the plugins directory, what it adds, and why it
// did not load when it didn't.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, wrapSpans } from "./core.js";
import { modalFrame } from "./overlays.js";

type Body = (StyledSpan[] | { spans: StyledSpan[]; bg: string })[];

export interface SkillRow {
  name: string;
  description: string;
  source: "project" | "user" | "claude" | "plugin";
  path: string;
  record: string;
}

const SOURCE_LABEL: Record<SkillRow["source"], string> = {
  project: "THIS PROJECT",
  user: "YOURS",
  claude: "FROM CLAUDE CODE",
  plugin: "FROM PLUGINS",
};

export class SkillsModal {
  private visible = false;
  private rows: SkillRow[] = [];
  private query = "";
  private cursor = 0;
  /** Open skill (reading view) and its scroll position */
  private reading: { row: SkillRow; text: string } | null = null;
  private offset = 0;
  private loadBody: (name: string) => string | null = () => null;

  isOpen(): boolean {
    return this.visible;
  }

  open(rows: SkillRow[], loadBody: (name: string) => string | null): void {
    this.visible = true;
    this.rows = rows;
    this.loadBody = loadBody;
    this.query = "";
    this.cursor = 0;
    this.reading = null;
  }

  close(): void {
    // Esc while reading goes back to the list first
    if (this.reading) {
      this.reading = null;
      return;
    }
    this.visible = false;
  }

  private filtered(): SkillRow[] {
    const q = this.query.trim().toLowerCase();
    const order = { project: 0, user: 1, claude: 2, plugin: 3 } as const;
    return this.rows
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      .sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
  }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    if (key === "\u001b") {
      this.close();
      return true;
    }
    if (this.reading) {
      if (key === "\u001b[A") this.offset = Math.max(0, this.offset - 1);
      else if (key === "\u001b[B") this.offset++;
      else if (key === "\u001b[5~") this.offset = Math.max(0, this.offset - 10);
      else if (key === "\u001b[6~" || key === " ") this.offset += 10;
      return true;
    }
    const list = this.filtered();
    const n = list.length;
    if (key === "\u001b[A") this.cursor = n ? (this.cursor - 1 + n) % n : 0;
    else if (key === "\u001b[B" || cp === 9) this.cursor = n ? (this.cursor + 1) % n : 0;
    else if (cp === 13 && list[this.cursor]) {
      const row = list[this.cursor];
      this.reading = { row, text: this.loadBody(row.name) ?? "(this skill has no text)" };
      this.offset = 0;
    } else if (cp === 127 || cp === 8) {
      this.query = this.query.slice(0, -1);
      this.cursor = 0;
    } else if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this.cursor = 0;
    }
    return true;
  }

  /** `maxRows`: screen rows available, so a long skill scrolls inside the pop-up */
  render(termWidth: number, maxRows = 40): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(100, termWidth - 6));
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.9);
    const body: Body = [];

    if (this.reading) {
      const r = this.reading.row;
      body.push([span(`   ${r.name}`, { fg: t.text, bold: true }), span(`  ${SOURCE_LABEL[r.source].toLowerCase()}${r.record ? ` · ${r.record}` : ""}`, { fg: muted })]);
      for (const w of wrapSpans([span(r.description, { fg: muted, italic: true })], innerW - 6)) body.push([span("   "), ...w.spans]);
      body.push([span(`   ${r.path}`, { fg: tint(t.textMuted, 0.6) })]);
      body.push([]);
      const lines: StyledSpan[][] = [];
      for (const raw of this.reading.text.split("\n")) {
        const heading = /^#{1,6}\s/.test(raw);
        const text = raw.replace(/^#{1,6}\s/, "");
        const style = heading ? { fg: t.accent, bold: true } : /^\s*[-*]\s/.test(raw) ? { fg: tint(t.text, 0.92) } : { fg: tint(t.text, 0.88) };
        if (!text.trim()) lines.push([]);
        else for (const w of wrapSpans([span(text, style)], innerW - 6)) lines.push([span("   "), ...w.spans]);
      }
      const room = Math.max(6, maxRows - body.length - 6);
      this.offset = Math.min(this.offset, Math.max(0, lines.length - room));
      body.push(...lines.slice(this.offset, this.offset + room));
      const more = lines.length - this.offset - room;
      body.push([]);
      body.push([span(`   ${this.offset > 0 ? `↑ ${this.offset} lines above  ` : ""}${more > 0 ? `↓ ${more} more` : "end of skill"}`, { fg: tint(t.textMuted, 0.7) })]);
      return modalFrame("Skill", boxW, body, "↑↓ scroll · space page · esc back to the list", t.accent);
    }

    const list = this.filtered();
    body.push([span(`   ${this.rows.length} skills XYRO and its experts can load when a task needs them.`, { fg: muted })]);
    body.push([span("   ❯ ", { fg: t.accent, bold: true }), ...(this.query ? [span(this.query, { fg: t.text, bold: true })] : [span("type to filter", { fg: tint(t.textMuted, 0.6), italic: true })]), span("▌", { fg: t.accent })]);
    body.push([]);
    if (!list.length) {
      body.push([span(this.rows.length ? "   Nothing matches." : "   No skills yet. Find some: /skills search <topic>, then /skills install <github url>", { fg: muted })]);
    }
    let group = "";
    list.forEach((r, i) => {
      if (r.source !== group) {
        if (group) body.push([]);
        group = r.source;
        body.push([span(`   ${SOURCE_LABEL[r.source]}`, { fg: tint(t.textMuted, 0.7), bold: true })]);
      }
      const sel = i === this.cursor;
      const nameW = 26;
      const tail = r.record ? `  ${r.record}` : "";
      const descW = Math.max(8, innerW - 3 - nameW - tail.length - 2);
      const desc = r.description.length > descW ? r.description.slice(0, descW - 1) + "…" : r.description;
      body.push({
        spans: [
          span(sel ? " ▌ " : "   ", { fg: t.accent, bold: true }),
          span(r.name.slice(0, nameW - 1).padEnd(nameW), { fg: sel ? t.text : tint(t.text, 0.9), bold: sel }),
          span(desc, { fg: sel ? tint(t.text, 0.85) : muted }),
          ...(tail ? [span(tail, { fg: /quarantined/.test(tail) ? t.error : t.success })] : []),
        ],
        bg: sel ? t.backgroundMenu : t.backgroundPanel,
      });
    });
    return modalFrame("Skills", boxW, body, "enter read · type to filter · /skills search · /skills install <url> · esc close", t.accent);
  }
}

export interface PluginRow {
  folder: string;
  name: string;
  version?: string;
  description?: string;
  tools: string[];
  error?: string;
}

export class PluginsModal {
  private visible = false;
  private rows: PluginRow[] = [];
  private dir = "";

  isOpen(): boolean {
    return this.visible;
  }

  open(rows: PluginRow[], dir: string): void {
    this.visible = true;
    this.rows = rows;
    this.dir = dir;
  }

  close(): void {
    this.visible = false;
  }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    if (key === "\u001b" || key.codePointAt(0) === 13) this.visible = false;
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(96, termWidth - 6));
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.9);
    const body: Body = [];
    const loaded = this.rows.filter((r) => !r.error);
    body.push([span(`   ${loaded.length} plugin${loaded.length === 1 ? "" : "s"} loaded`, { fg: t.text, bold: true }), span(`  ·  every expert can use their tools`, { fg: muted })]);
    body.push([]);
    if (!this.rows.length) {
      body.push([span("   No plugins yet.", { fg: muted })]);
    }
    for (const r of this.rows) {
      const ok = !r.error;
      body.push([span(ok ? "   ● " : "   ✗ ", { fg: ok ? t.success : t.error, bold: true }), span(r.name, { fg: t.text, bold: true }), span(`${r.version ? `  v${r.version}` : ""}${r.folder !== r.name ? `  (${r.folder})` : ""}`, { fg: muted })]);
      if (r.description) for (const w of wrapSpans([span(r.description, { fg: muted })], innerW - 8)) body.push([span("     "), ...w.spans]);
      if (ok) for (const w of wrapSpans([span(`tools: ${r.tools.join(", ") || "none"}`, { fg: tint(t.text, 0.85) })], innerW - 8)) body.push([span("     "), ...w.spans]);
      else for (const w of wrapSpans([span(`not loaded: ${r.error}`, { fg: t.error })], innerW - 8)) body.push([span("     "), ...w.spans]);
      body.push([]);
    }
    body.push([span("   Add one: a folder with plugin.ts (or .js) exporting `tools` in", { fg: muted })]);
    body.push([span(`   ${this.dir}`, { fg: t.accent })]);
    body.push([span("   then /plugins reload", { fg: muted })]);
    return modalFrame("Plugins", boxW, body, "/plugins reload · esc close", t.accent);
  }
}
