// XYRO TUI Overlays: Command Center, Agent Persona Selector, Status & Cost Dashboards
// Built with impeccable craft, visual hierarchy, and authentic XYRO brand aesthetics.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth } from "./core.js";

const BRAND_BLUE  = "#38BDF8";
const BRAND_GREEN = "#22C55E";
const BRAND_LEMON = "#C6F135";
const BRAND_AMBER = "#F59E0B";

export interface CommandItem {
  cmd: string;
  name: string;
  category: "AI" | "MODE" | "CONFIG" | "SYSTEM" | "METRICS" | "CONTEXT" | "SESSION" | "HELP";
  desc: string;
}

export const COMMAND_ITEMS: CommandItem[] = [
  { cmd: "/model",    name: "Switch Model",     category: "AI",      desc: "Switch AI model & inspect free/paid providers" },
  { cmd: "/agent",    name: "Agent Mode",       category: "MODE",    desc: "Switch persona (Build, Plan, Review, Explore)" },
  { cmd: "/theme",    name: "Theme Gallery",    category: "CONFIG",  desc: "Choose from 11 curated cyber & developer palettes" },
  { cmd: "/status",   name: "Session Status",   category: "SYSTEM",  desc: "Inspect model, context history & active tools" },
  { cmd: "/cost",     name: "Token Usage",      category: "METRICS", desc: "View token consumption & estimated session cost" },
  { cmd: "/provider", name: "Provider Setup",   category: "CONFIG",  desc: "Reconfigure API provider credentials & endpoints" },
  { cmd: "/compact",  name: "Compact History",  category: "CONTEXT", desc: "Compress session context history via LLM summary" },
  { cmd: "/clear",    name: "Clear History",    category: "SESSION", desc: "Reset conversation history and start fresh" },
  { cmd: "/help",     name: "Help & Shortcuts", category: "HELP",    desc: "Show full XYRO command list and keyboard controls" },
  { cmd: "/exit",     name: "Save & Exit",      category: "SYSTEM",  desc: "Save session checkpoints and exit the XYRO CLI" },
];

export interface AgentModeDef {
  name: string;
  colorIdx: number;
  tag: string;
  desc: string;
  color: string;
}

export const AGENT_MODE_DEFS: AgentModeDef[] = [
  { name: "Build",   colorIdx: 4, tag: "CODE",  desc: "Autonomous coding, implementation & refactoring",  color: "#38BDF8" },
  { name: "Plan",    colorIdx: 0, tag: "ARCH",  desc: "System architecture, task planning & spec design", color: "#3B82F6" },
  { name: "Review",  colorIdx: 1, tag: "AUDIT", desc: "Deep code review, security audits & QA tests",      color: "#C6F135" },
  { name: "Explore", colorIdx: 2, tag: "READ",  desc: "Read-only survey, AST inspection & search",        color: "#22C55E" },
];

/** Renders a standardized modal top border with title and [XYRO] badge pill */
export function renderModalTopBorder(title: string, innerW: number, margin: string, borderColor = BRAND_BLUE): RenderLine {
  const badge = " [XYRO] ";
  const titleStr = ` ${title} `;
  const dashCount = Math.max(1, innerW - visualWidth(titleStr) - visualWidth(badge) - 1);
  return line(
    span(margin),
    span("╭─", { fg: borderColor }),
    span(titleStr, { fg: "#F3F4F6", bold: true }),
    span("─".repeat(dashCount), { fg: borderColor }),
    span(badge, { fg: BRAND_LEMON, bold: true }),
    span("╮", { fg: borderColor })
  );
}

/** Renders a standardized modal bottom border with key action hints */
export function renderModalBottomBorder(hint: string, innerW: number, margin: string, borderColor = BRAND_BLUE): RenderLine {
  const t = currentTheme();
  const hintStr = ` ${hint} `;
  const dashCount = Math.max(1, innerW - visualWidth(hintStr) - 1);
  return line(
    span(margin),
    span("╰─", { fg: borderColor }),
    span(hintStr, { fg: tint(t.textMuted, 0.75) }),
    span("─".repeat(dashCount), { fg: borderColor }),
    span("╯", { fg: borderColor })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. COMMAND PICKER POP-OUT
// ─────────────────────────────────────────────────────────────────────────────

export class CommandPicker {
  private visible = false;
  private cursor = 0;
  private query = "";
  private filtered: CommandItem[] = COMMAND_ITEMS.slice();
  private onSelectCb: ((cmd: string) => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(): void {
    this.visible = true;
    this.cursor = 0;
    this.query = "";
    this.filtered = COMMAND_ITEMS.slice();
  }

  close(): void { this.visible = false; }

  onSelect(cb: (cmd: string) => void): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;

    if (key === "\u001b") {
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }

    if (cp === 13) {
      const item = this.filtered[this.cursor];
      if (item) {
        this.visible = false;
        this.onSelectCb?.(item.cmd);
      }
      return true;
    }

    if (key === "\u001b[A") {
      this.cursor = Math.max(0, this.cursor - 1);
      return true;
    }

    if (key === "\u001b[B") {
      this.cursor = Math.min(this.filtered.length - 1, this.cursor + 1);
      return true;
    }

    if (cp === 127 || cp === 8) {
      this.query = this.query.slice(0, -1);
      this._refilter();
      return true;
    }

    if (cp === 21) {
      this.query = "";
      this._refilter();
      return true;
    }

    if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this._refilter();
      return true;
    }

    return true;
  }

  private _refilter(): void {
    const q = this.query.trim().toLowerCase();
    if (!q) {
      this.filtered = COMMAND_ITEMS.slice();
    } else {
      this.filtered = COMMAND_ITEMS.filter(
        (c) =>
          c.cmd.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          c.desc.toLowerCase().includes(q)
      );
    }
    this.cursor = 0;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(78, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const out: RenderLine[] = [];

    // 1. Top border
    out.push(renderModalTopBorder("Command Center", innerW, margin));

    // 2. Search row
    const searchLabel = "  🔍 Search: ";
    const cursorStr = this.query + "▌";
    const searchHint = "(↑↓ nav · Enter run · Esc close)  ";
    const usedSearch = visualWidth(searchLabel) + visualWidth(cursorStr) + visualWidth(searchHint);
    const searchPad = Math.max(0, innerW - usedSearch);
    out.push(
      line(
        span(margin),
        span("│", { fg: BRAND_BLUE }),
        span(searchLabel, { fg: BRAND_BLUE, bg: t.backgroundElement }),
        span(cursorStr, { fg: "#F3F4F6", bg: t.backgroundElement }),
        span(" ".repeat(searchPad), { bg: t.backgroundElement }),
        span(searchHint, { fg: tint(t.textMuted, 0.65), bg: t.backgroundElement }),
        span("│", { fg: BRAND_BLUE })
      )
    );

    // 3. Separator
    out.push(
      line(
        span(margin),
        span("├", { fg: BRAND_BLUE }),
        span("─".repeat(innerW), { fg: t.border }),
        span("┤", { fg: BRAND_BLUE })
      )
    );

    // 4. Command rows
    if (this.filtered.length === 0) {
      const noMatch = "  No commands match your filter.";
      const pad = Math.max(0, innerW - visualWidth(noMatch));
      out.push(
        line(
          span(margin),
          span("│", { fg: BRAND_BLUE }),
          span(noMatch, { fg: tint(t.textMuted, 0.7), bg: t.backgroundElement }),
          span(" ".repeat(pad), { bg: t.backgroundElement }),
          span("│", { fg: BRAND_BLUE })
        )
      );
    } else {
      for (let i = 0; i < this.filtered.length; i++) {
        const item = this.filtered[i];
        const selected = i === this.cursor;
        const bg = selected ? t.backgroundMenu : t.backgroundElement;
        const pointer = selected ? "› " : "  ";

        const cmdCol = item.cmd.padEnd(12);
        const catCol = `[${item.category}]`.padEnd(9);
        const nameCol = item.name.padEnd(18);
        const fixedUsed = 2 + 12 + 9 + 18;
        const descW = Math.max(8, innerW - fixedUsed - 2);
        const descCol = item.desc.length > descW ? item.desc.slice(0, descW - 1) + "…" : item.desc.padEnd(descW);

        const rowContentW = 2 + visualWidth(cmdCol) + visualWidth(catCol) + visualWidth(nameCol) + visualWidth(descCol);
        const pad = Math.max(0, innerW - rowContentW);

        let catColor = BRAND_BLUE;
        if (item.category === "AI") catColor = BRAND_BLUE;
        else if (item.category === "MODE") catColor = BRAND_LEMON;
        else if (item.category === "SYSTEM") catColor = "#A78BFA";
        else if (item.category === "METRICS") catColor = BRAND_GREEN;
        else if (item.category === "CONFIG") catColor = BRAND_AMBER;

        out.push(
          line(
            span(margin),
            span("│", { fg: BRAND_BLUE }),
            span(pointer, { fg: selected ? BRAND_LEMON : tint(t.textMuted, 0.5), bg, bold: selected }),
            span(cmdCol, { fg: selected ? "#F3F4F6" : BRAND_BLUE, bg, bold: true }),
            span(catCol, { fg: catColor, bg }),
            span(nameCol, { fg: selected ? "#FFFFFF" : tint(t.text, 0.95), bg, bold: selected }),
            span(descCol, { fg: selected ? tint(t.text, 0.9) : tint(t.textMuted, 0.75), bg }),
            span(" ".repeat(pad), { bg }),
            span("│", { fg: BRAND_BLUE })
          )
        );
      }
    }

    // 5. Bottom border
    out.push(renderModalBottomBorder("↑↓ Navigate · Enter Run · Esc Close", innerW, margin));

    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. AGENT MODE PICKER POP-OUT
// ─────────────────────────────────────────────────────────────────────────────

export class AgentModePicker {
  private visible = false;
  private cursor = 0;
  private activeMode = "Build";
  private onSelectCb: ((mode: AgentModeDef) => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(currentMode: string): void {
    this.visible = true;
    this.activeMode = currentMode;
    const idx = AGENT_MODE_DEFS.findIndex((m) => m.name.toLowerCase() === currentMode.toLowerCase());
    this.cursor = idx >= 0 ? idx : 0;
  }

  close(): void { this.visible = false; }

  onSelect(cb: (mode: AgentModeDef) => void): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;

    if (key === "\u001b") {
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }

    if (cp === 13) {
      const mode = AGENT_MODE_DEFS[this.cursor];
      if (mode) {
        this.visible = false;
        this.onSelectCb?.(mode);
      }
      return true;
    }

    if (key === "\u001b[A") {
      this.cursor = Math.max(0, this.cursor - 1);
      return true;
    }

    if (key === "\u001b[B") {
      this.cursor = Math.min(AGENT_MODE_DEFS.length - 1, this.cursor + 1);
      return true;
    }

    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(78, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const out: RenderLine[] = [];

    // 1. Top border
    out.push(renderModalTopBorder("Select Agent Persona", innerW, margin, BRAND_BLUE));

    // 2. Subtitle / Guidance
    const sub = "  Choose an operational role to specialize tool autonomy and prompts:";
    const subPad = Math.max(0, innerW - visualWidth(sub));
    out.push(
      line(
        span(margin),
        span("│", { fg: BRAND_BLUE }),
        span(sub, { fg: tint(t.textMuted, 0.85), bg: t.backgroundElement }),
        span(" ".repeat(subPad), { bg: t.backgroundElement }),
        span("│", { fg: BRAND_BLUE })
      )
    );

    // 3. Separator
    out.push(
      line(
        span(margin),
        span("├", { fg: BRAND_BLUE }),
        span("─".repeat(innerW), { fg: t.border }),
        span("┤", { fg: BRAND_BLUE })
      )
    );

    // 4. Agent persona items
    for (let i = 0; i < AGENT_MODE_DEFS.length; i++) {
      const mode = AGENT_MODE_DEFS[i];
      const selected = i === this.cursor;
      const isActive = mode.name.toLowerCase() === this.activeMode.toLowerCase();
      const bg = selected ? t.backgroundMenu : t.backgroundElement;
      const pointer = selected ? "› " : "  ";

      const nameCol = mode.name.padEnd(10);
      const tagBadge = `[${mode.tag}]`.padEnd(8);
      const activeBadge = isActive ? "● ACTIVE" : "        ";
      const fixedUsed = 2 + 10 + 8 + 9;
      const descW = Math.max(8, innerW - fixedUsed - 2);
      const descCol = mode.desc.length > descW ? mode.desc.slice(0, descW - 1) + "…" : mode.desc.padEnd(descW);

      const rowW = 2 + visualWidth(nameCol) + visualWidth(tagBadge) + visualWidth(activeBadge) + visualWidth(descCol);
      const pad = Math.max(0, innerW - rowW);

      out.push(
        line(
          span(margin),
          span("│", { fg: BRAND_BLUE }),
          span(pointer, { fg: selected ? BRAND_LEMON : tint(t.textMuted, 0.5), bg, bold: selected }),
          span(nameCol, { fg: mode.color, bg, bold: true }),
          span(tagBadge, { fg: mode.color, bg }),
          span(activeBadge, { fg: isActive ? BRAND_GREEN : tint(t.textMuted, 0.4), bg, bold: isActive }),
          span(" ", { bg }),
          span(descCol, { fg: selected ? "#FFFFFF" : tint(t.text, 0.85), bg }),
          span(" ".repeat(pad), { bg }),
          span("│", { fg: BRAND_BLUE })
        )
      );
    }

    // 5. Bottom border
    out.push(renderModalBottomBorder("↑↓ Select Role · Enter Confirm · Esc Cancel", innerW, margin, BRAND_BLUE));

    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. STATUS & ARCHITECTURE DASHBOARD POP-OUT
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusData {
  model: string;
  provider: string;
  agentName: string;
  cwd: string;
  gitBranch: string;
  messagesCount: number;
  toolCallsCount: number;
  toolsCount: { total: number; builtin: number; plugins: number };
  mcpCount: number;
  version: string;
}

export class StatusModal {
  private visible = false;
  private data: StatusData | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(data: StatusData): void {
    this.visible = true;
    this.data = data;
  }

  close(): void { this.visible = false; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    if (key === "\u001b" || cp === 13 || cp === 32) {
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible || !this.data) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(78, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const out: RenderLine[] = [];

    // 1. Top border
    out.push(renderModalTopBorder("Session Architecture & Status", innerW, margin));

    // 2. Info rows
    const rows: [string, string, string?][] = [
      ["Active Model", `${this.data.model} (${this.data.provider})`, BRAND_BLUE],
      ["Agent Persona", `${this.data.agentName} Mode`, BRAND_LEMON],
      ["Workspace CWD", this.data.cwd],
      ["Git Branch", this.data.gitBranch ? `:${this.data.gitBranch}` : "(none)", BRAND_GREEN],
      ["Session Turns", `${this.data.messagesCount} msgs (${this.data.toolCallsCount} tool calls)`],
      ["Tool System", `${this.data.toolsCount.total} registered (${this.data.toolsCount.builtin} core + ${this.data.toolsCount.plugins} plugins)`],
      ["MCP Ecosystem", `${this.data.mcpCount} server(s) connected`, BRAND_GREEN],
      ["XYRO Version", `v${this.data.version}`, tint(t.textMuted, 0.7)],
    ];

    for (const [label, val, valColor] of rows) {
      const lblStr = `  ${label.padEnd(18)} `;
      const valStr = val.length > innerW - 24 ? val.slice(0, innerW - 27) + "…" : val;
      const pad = Math.max(0, innerW - visualWidth(lblStr) - visualWidth(valStr));
      out.push(
        line(
          span(margin),
          span("│", { fg: BRAND_BLUE }),
          span(lblStr, { fg: tint(t.textMuted, 0.8), bg: t.backgroundElement }),
          span(valStr, { fg: valColor || "#F3F4F6", bg: t.backgroundElement, bold: !!valColor }),
          span(" ".repeat(pad), { bg: t.backgroundElement }),
          span("│", { fg: BRAND_BLUE })
        )
      );
    }

    // 3. Bottom border
    out.push(renderModalBottomBorder("Press Enter or Esc to dismiss", innerW, margin));

    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. COST & TOKEN USAGE DASHBOARD POP-OUT
// ─────────────────────────────────────────────────────────────────────────────

export interface CostData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD: string;
  model: string;
  provider: string;
}

export class CostModal {
  private visible = false;
  private data: CostData | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(data: CostData): void {
    this.visible = true;
    this.data = data;
  }

  close(): void { this.visible = false; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    if (key === "\u001b" || cp === 13 || cp === 32) {
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible || !this.data) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(78, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const out: RenderLine[] = [];

    // 1. Top border
    out.push(renderModalTopBorder("Token Consumption & Cost Analytics", innerW, margin, BRAND_GREEN));

    const rows: [string, string, string?][] = [
      ["Active Model", `${this.data.model} · ${this.data.provider}`, BRAND_BLUE],
      ["Prompt Tokens", `${this.data.promptTokens.toLocaleString()} tokens`],
      ["Completion Tokens", `${this.data.completionTokens.toLocaleString()} tokens`],
      ["Total Tokens", `${this.data.totalTokens.toLocaleString()} tokens`, BRAND_LEMON],
      ["Estimated Cost", this.data.costUSD, BRAND_GREEN],
    ];

    for (const [label, val, valColor] of rows) {
      const lblStr = `  ${label.padEnd(20)} `;
      const valStr = val.length > innerW - 26 ? val.slice(0, innerW - 29) + "…" : val;
      const pad = Math.max(0, innerW - visualWidth(lblStr) - visualWidth(valStr));
      out.push(
        line(
          span(margin),
          span("│", { fg: BRAND_GREEN }),
          span(lblStr, { fg: tint(t.textMuted, 0.8), bg: t.backgroundElement }),
          span(valStr, { fg: valColor || "#F3F4F6", bg: t.backgroundElement, bold: true }),
          span(" ".repeat(pad), { bg: t.backgroundElement }),
          span("│", { fg: BRAND_GREEN })
        )
      );
    }

    out.push(renderModalBottomBorder("Press Enter or Esc to dismiss", innerW, margin, BRAND_GREEN));

    return out;
  }
}
