// XYRO TUI Overlays: Command Center, Agent Persona Selector, Status & Cost Dashboards
// Built with impeccable craft, visual hierarchy, and authentic XYRO brand aesthetics.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth, wrapSpans } from "./core.js";

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
  { cmd: "/language", name: "Language",         category: "CONFIG",  desc: "Choose the language XYRO speaks with you" },
  { cmd: "/theme",    name: "Theme Gallery",    category: "CONFIG",  desc: "Choose from 11 curated cyber & developer palettes" },
  { cmd: "/status",   name: "Session Status",   category: "SYSTEM",  desc: "Inspect model, context history & active tools" },
  { cmd: "/cost",     name: "Token Usage",      category: "METRICS", desc: "View token consumption & estimated session cost" },
  { cmd: "/provider", name: "Provider Setup",   category: "CONFIG",  desc: "Reconfigure API provider credentials & endpoints" },
  { cmd: "/compact",  name: "Compact History",  category: "CONTEXT", desc: "Compress session context history via LLM summary" },
  { cmd: "/clear",    name: "Clear History",    category: "SESSION", desc: "Reset conversation history and start fresh" },
  { cmd: "/help",     name: "Help & Shortcuts", category: "HELP",    desc: "Show full XYRO command list and keyboard controls" },
  { cmd: "/experts",  name: "Expert Team",      category: "AI",      desc: "Browse XYRO's specialist experts, their tools, skills and record" },
  { cmd: "/workflow", name: "Workflow",         category: "AI",      desc: "Run a team play: feature, bugfix, review, release-check, refactor…" },
  { cmd: "/learn",    name: "Learn",            category: "CONTEXT", desc: "Reflect now: learn how you work, project lessons and proven skills" },
  { cmd: "/profile",  name: "What XYRO Knows",  category: "CONTEXT", desc: "See what XYRO learned about how you work (evidence-backed)" },
  { cmd: "/forget",   name: "Forget Me",        category: "CONTEXT", desc: "Erase everything XYRO learned about you" },
  { cmd: "/rewind",   name: "Rewind",           category: "SESSION", desc: "Undo files and conversation back to an earlier message (Esc Esc)" },
  { cmd: "/quota",    name: "Free-quota pool",  category: "METRICS", desc: "Live capacity of every free provider XYRO can fall back to" },
  { cmd: "/mcp",      name: "MCP Servers",      category: "CONFIG",  desc: "See connected MCP tool servers and trust this project's servers" },
  { cmd: "/intents",  name: "Intent Guard",     category: "AI",      desc: "Re-check the requirements you asked for; trust or remove them" },
  { cmd: "/privacy",  name: "Privacy Shield",   category: "CONFIG",  desc: "What secrets and personal data were kept off the network; on / off" },
  { cmd: "/peers",    name: "Linked Sessions",  category: "SESSION", desc: "Other XYRO sessions on this project (this computer and your network)" },
  { cmd: "/link",     name: "Link Over LAN",    category: "SESSION", desc: "Link with teammates on your network: /link lan, /link join <code>" },
  { cmd: "/hooks",    name: "Hooks",            category: "CONFIG",  desc: "See active reflex hooks and trust this project's hooks" },
  { cmd: "/update",   name: "Update XYRO",      category: "SYSTEM",  desc: "Check npm for a newer XYRO and install it" },
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

/** Modal top border: "╭─ ◆ Title ───────────╮" — accent diamond, bold title, quiet frame. */
export function renderModalTopBorder(title: string, innerW: number, margin: string, accent = BRAND_BLUE): RenderLine {
  const t = currentTheme();
  const frame = tint(t.border, 1);
  const titleStr = ` ${title} `;
  const dashCount = Math.max(1, innerW - 2 - visualWidth(titleStr) - 1);
  return line(
    span(margin),
    span("╭─", { fg: frame }),
    span(" ◆", { fg: accent }),
    span(titleStr, { fg: t.text, bold: true }),
    span("─".repeat(dashCount), { fg: frame }),
    span("╮", { fg: frame })
  );
}

/**
 * Modal bottom border with key hints: "╰─ ↑↓ move · enter run · esc close ─╯".
 * In each "keys label" part the keys are bold and the label muted.
 */
export function renderModalBottomBorder(hint: string, innerW: number, margin: string, _accent = BRAND_BLUE): RenderLine {
  const t = currentTheme();
  const frame = tint(t.border, 1);
  const parts = hint.split(/\s*·\s*/).filter(Boolean);
  const spans: StyledSpan[] = [span(" ")];
  parts.forEach((p, i) => {
    if (i) spans.push(span("  ", {}));
    const [keys, ...label] = p.split(" ");
    spans.push(span(keys.toLowerCase(), { fg: t.text, bold: true }));
    if (label.length) spans.push(span(" " + label.join(" ").toLowerCase(), { fg: tint(t.textMuted, 0.85) }));
  });
  spans.push(span(" "));
  const used = spans.reduce((w, s) => w + visualWidth(s.text), 0);
  return line(span(margin), span("╰─", { fg: frame }), ...spans, span("─".repeat(Math.max(1, innerW - 1 - used)), { fg: frame }), span("╯", { fg: frame }));
}


// ─── shared modal frame ──────────────────────────────────────────────────────

/**
 * One frame for every menu: title border, a padded panel body (each row is a
 * list of spans; `{ bg }` on a row's spans marks a highlighted row), hints.
 */
export function modalFrame(title: string, boxW: number, body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[], hint: string, accent = BRAND_BLUE): RenderLine[] {
  const t = currentTheme();
  const innerW = boxW - 2;
  const panel = t.backgroundPanel;
  const frame = tint(t.border, 1);
  const out: RenderLine[] = [renderModalTopBorder(title, innerW, "", accent)];
  const rows = [[] as StyledSpan[], ...body, [] as StyledSpan[]];
  for (const r of rows) {
    const spans = Array.isArray(r) ? r : r.spans;
    const bg = Array.isArray(r) ? panel : r.bg;
    let used = 0;
    const fitted: StyledSpan[] = [];
    for (const sp of spans) {
      let text = "";
      for (const ch of Array.from(sp.text)) {
        const cw = visualWidth(ch);
        if (used + cw > innerW) break;
        text += ch;
        used += cw;
      }
      if (text) fitted.push({ ...sp, text, bg: sp.bg ?? bg });
    }
    out.push(line(span("│", { fg: frame, bg: panel }), ...fitted, span(" ".repeat(Math.max(0, innerW - used)), { bg }), span("│", { fg: frame, bg: panel })));
  }
  out.push(renderModalBottomBorder(hint, innerW, ""));
  return out;
}

/** "  label ······· value" definition row for dashboards. */
function defRow(label: string, value: StyledSpan[], labelW = 18): StyledSpan[] {
  const t = currentTheme();
  return [span("   " + label.padEnd(labelW), { fg: tint(t.textMuted, 0.9) }), ...value];
}

function sectionRow(label: string): StyledSpan[] {
  const t = currentTheme();
  return [span("   " + label, { fg: t.text, bold: true })];
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

    const n = this.filtered.length;
    if (key === "\u001b[A" || cp === 16) {
      if (n) this.cursor = (this.cursor - 1 + n) % n;
      return true;
    }

    if (key === "\u001b[B" || cp === 14 || cp === 9) {
      if (n) this.cursor = (this.cursor + 1) % n;
      return true;
    }

    if (cp === 127 || cp === 8) {
      if (!this.query) {
        this.visible = false;
        this.onCloseCb?.();
        return true;
      }
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
    const q = this.query.trim().toLowerCase().replace(/^\//, "");
    if (!q) {
      this.filtered = COMMAND_ITEMS.slice();
    } else {
      // Rank: command prefix > name prefix > anywhere in command/name > description
      const score = (c: CommandItem) => {
        const cmd = c.cmd.slice(1).toLowerCase();
        const name = c.name.toLowerCase();
        if (cmd.startsWith(q)) return 0;
        if (name.startsWith(q)) return 1;
        if (cmd.includes(q) || name.includes(q)) return 2;
        if (c.desc.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)) return 3;
        return 9;
      };
      this.filtered = COMMAND_ITEMS.map((c) => [c, score(c)] as const)
        .filter(([, sc]) => sc < 9)
        .sort((a, b) => a[1] - b[1])
        .map(([c]) => c);
    }
    this.cursor = 0;
  }

  /** Open pre-filled (typing "/" in an empty prompt opens the palette). */
  openWith(query: string): void {
    this.open();
    this.query = query;
    this._refilter();
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(56, Math.min(76, termWidth - 6));
    const innerW = boxW - 2;
    const margin = "";
    const bg = t.backgroundPanel;
    const frame = tint(t.border, 1);
    const out: RenderLine[] = [];
    const row = (spans: StyledSpan[], rowBg = bg) => {
      const used = spans.reduce((w, sp) => w + visualWidth(sp.text), 0);
      return line(span("│", { fg: frame, bg }), ...spans.map((sp) => ({ ...sp, bg: sp.bg ?? rowBg })), span(" ".repeat(Math.max(0, innerW - used)), { bg: rowBg }), span("│", { fg: frame, bg }));
    };

    out.push(renderModalTopBorder("Commands", innerW, margin));

    // Search field
    const q = this.query;
    out.push(row([]));
    out.push(
      row([
        span("  "),
        span("❯ ", { fg: BRAND_LEMON, bold: true }),
        ...(q ? [span(q, { fg: t.text, bold: true })] : [span("type to filter…", { fg: tint(t.textMuted, 0.6), italic: true })]),
        span("▌", { fg: BRAND_LEMON }),
      ])
    );
    out.push(row([span("  " + "─".repeat(innerW - 4), { fg: tint(t.border, 0.6) })]));

    if (this.filtered.length === 0) {
      out.push(row([span("  No command matches ", { fg: tint(t.textMuted, 0.8) }), span(`"${q}"`, { fg: t.text })]));
    } else {
      const grouped = !q.trim();
      let lastCat = "";
      const hl = q.trim().toLowerCase().replace(/^\//, "");
      this.filtered.forEach((item, i) => {
        if (grouped && item.category !== lastCat) {
          if (lastCat) out.push(row([]));
          out.push(row([span("  " + item.category, { fg: tint(t.textMuted, 0.7), bold: true })]));
          lastCat = item.category;
        }
        const selected = i === this.cursor;
        const rowBg = selected ? t.backgroundMenu : bg;
        const cmdW = 11;
        const nameW = 17;
        const descW = Math.max(6, innerW - 4 - cmdW - nameW);
        const desc = item.desc.length > descW ? item.desc.slice(0, descW - 1) + "…" : item.desc;
        out.push(
          row(
            [
              span(selected ? " ▌" : "  ", { fg: BRAND_LEMON, bold: true }),
              ...highlight(item.cmd.padEnd(cmdW), hl, { fg: selected ? BRAND_LEMON : BRAND_BLUE, bold: true }, t.text),
              ...highlight(item.name.padEnd(nameW), hl, { fg: selected ? t.text : tint(t.text, 0.9), bold: selected }, BRAND_LEMON),
              span(desc, { fg: selected ? tint(t.text, 0.8) : tint(t.textMuted, 0.85) }),
            ],
            rowBg
          )
        );
      });
    }
    out.push(row([]));
    out.push(renderModalBottomBorder("↑↓ move · enter run · esc close", innerW, margin));
    return out;
  }
}

/** Split text so the characters matching `q` (first occurrence) are emphasised. */
function highlight(text: string, q: string, style: Omit<StyledSpan, "text">, hlColor: string): StyledSpan[] {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return [span(text, style)];
  return [
    span(text.slice(0, i), style),
    span(text.slice(i, i + q.length), { ...style, fg: hlColor, bold: true }),
    span(text.slice(i + q.length), style),
  ];
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
    const boxW = Math.max(52, Math.min(68, termWidth - 6));
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [
      [span("   How should XYRO work on your next request?", { fg: tint(t.textMuted, 0.95) })],
      [],
    ];
    AGENT_MODE_DEFS.forEach((mode, i) => {
      const selected = i === this.cursor;
      const active = mode.name.toLowerCase() === this.activeMode.toLowerCase();
      const bg = selected ? t.backgroundMenu : t.backgroundPanel;
      const bar = span(selected ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true });
      const nameW = boxW - 2 - 3 - 8;
      body.push({
        spans: [bar, span(mode.name.padEnd(nameW), { fg: mode.color, bold: true }), span(active ? "active" : "", { fg: t.success, bold: true })],
        bg,
      });
      body.push({ spans: [span("   "), span(mode.desc, { fg: selected ? tint(t.text, 0.9) : tint(t.textMuted, 0.85) })], bg });
      if (i < AGENT_MODE_DEFS.length - 1) body.push([]);
    });
    return modalFrame("Agent mode", boxW, body, "↑↓ move · enter switch · esc cancel");
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
    const d = this.data;
    const boxW = Math.max(52, Math.min(72, termWidth - 6));
    const v = (text: string, fg = t.text, bold = false) => [span(text, { fg, bold })];
    const body: StyledSpan[][] = [
      sectionRow("Model"),
      defRow("model", v(d.model, BRAND_BLUE, true)),
      defRow("provider", v(d.provider)),
      defRow("agent mode", v(d.agentName, BRAND_LEMON, true)),
      [],
      sectionRow("Workspace"),
      defRow("directory", v(d.cwd)),
      defRow("git branch", v(d.gitBranch || "not a git repository", d.gitBranch ? t.success : tint(t.textMuted, 0.8))),
      [],
      sectionRow("Session"),
      defRow("messages", v(String(d.messagesCount))),
      defRow("tool calls", v(String(d.toolCallsCount))),
      defRow("tools", [span(String(d.toolsCount.total), { fg: t.text }), span(`  ${d.toolsCount.builtin} built-in · ${d.toolsCount.plugins} plugins`, { fg: tint(t.textMuted, 0.8) })]),
      defRow("mcp servers", v(String(d.mcpCount))),
      defRow("version", v(d.version, tint(t.textMuted, 0.95))),
    ];
    return modalFrame("Status", boxW, body, "enter close · esc close");
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
    const d = this.data;
    const boxW = Math.max(52, Math.min(68, termWidth - 6));
    const num = (n: number) => n.toLocaleString();
    // Prompt vs completion split as one bar
    const barW = boxW - 2 - 6;
    const share = d.totalTokens > 0 ? d.promptTokens / d.totalTokens : 0;
    const pW = Math.round(share * barW);
    const body: StyledSpan[][] = [
      defRow("model", [span(d.model, { fg: BRAND_BLUE, bold: true }), span(`  ${d.provider}`, { fg: tint(t.textMuted, 0.8) })]),
      [],
      defRow("prompt", [span(num(d.promptTokens).padStart(10), { fg: t.text }), span("  tokens", { fg: tint(t.textMuted, 0.7) })]),
      defRow("completion", [span(num(d.completionTokens).padStart(10), { fg: t.text }), span("  tokens", { fg: tint(t.textMuted, 0.7) })]),
      defRow("total", [span(num(d.totalTokens).padStart(10), { fg: t.text, bold: true }), span("  tokens", { fg: tint(t.textMuted, 0.7) })]),
      [],
      [span("   "), span("━".repeat(pW), { fg: BRAND_BLUE }), span("━".repeat(Math.max(0, barW - pW)), { fg: BRAND_LEMON })],
      [span("   "), span("prompt", { fg: BRAND_BLUE }), span("  ·  ", { fg: tint(t.textMuted, 0.5) }), span("completion", { fg: BRAND_LEMON })],
      [],
      defRow("estimated cost", [span(d.costUSD, { fg: t.success, bold: true })]),
    ];
    return modalFrame("Usage", boxW, body, "enter close · esc close", BRAND_GREEN);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TOOL PERMISSION APPROVAL POP-OUT
// ─────────────────────────────────────────────────────────────────────────────

export class PermissionModal {
  private request: { label: string; resolve: (ok: boolean) => void } | null = null;

  isOpen(): boolean { return this.request !== null; }

  ask(label: string): Promise<boolean> {
    // A new request supersedes (and denies) any stale one
    this.request?.resolve(false);
    return new Promise((resolve) => {
      this.request = { label, resolve };
    });
  }

  private settle(ok: boolean): void {
    const req = this.request;
    this.request = null;
    req?.resolve(ok);
  }

  /** Deny and dismiss — used by Esc / closeAnyOverlay. */
  close(): void { this.settle(false); }

  handleKey(key: string): boolean {
    if (!this.request) return false;
    const k = key.toLowerCase();
    if (k === "y") this.settle(true);
    else if (k === "n" || key === "\u001b" || (key.codePointAt(0) ?? 0) === 3) this.settle(false);
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.request) return [];
    const t = currentTheme();
    const boxW = Math.max(48, Math.min(76, termWidth - 6));
    const label = this.request.label;
    const body: StyledSpan[][] = [
      [span("   XYRO wants to run:", { fg: tint(t.textMuted, 0.95) })],
      [],
      ...wrapSpans([span(label, { fg: t.text, bold: true })], boxW - 8).map((w) => [span("   "), ...w.spans]),
      [],
      [span("   "), span(" y  allow ", { fg: t.background, bg: t.success, bold: true }), span("    "), span(" n  deny ", { fg: t.error, bg: t.backgroundElement, bold: true })],
    ];
    return modalFrame("Allow this action?", boxW, body, "y allow · n deny · esc deny", BRAND_AMBER);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. UPDATE POP-OUT ("/update")
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateModalState =
  | { kind: "checking" }
  | { kind: "uptodate"; current: string }
  | { kind: "offline"; current: string }
  | { kind: "available"; current: string; latest: string; method: string; notes?: string[]; announce?: boolean }
  | { kind: "installing"; current: string; latest: string; startedAt: number }
  | { kind: "done"; ok: boolean; message: string };

export class UpdateModal {
  private state: UpdateModalState | null = null;
  private onConfirmCb: (() => void) | null = null;

  isOpen(): boolean { return this.state !== null; }
  set(state: UpdateModalState): void { this.state = state; }
  close(): void {
    // Never hide an install in progress
    if (this.state?.kind !== "installing") this.state = null;
  }
  onConfirm(cb: () => void): void { this.onConfirmCb = cb; }

  handleKey(key: string): boolean {
    if (!this.state) return false;
    const cp = key.codePointAt(0) ?? 0;
    if (this.state.kind === "installing") return true;
    if (cp === 13 && this.state.kind === "available") {
      this.onConfirmCb?.();
      return true;
    }
    if (key === "\u001b" || cp === 13) this.state = null;
    return true;
  }

  render(termWidth: number): RenderLine[] {
    const st = this.state;
    if (!st) return [];
    const t = currentTheme();
    const boxW = Math.max(52, Math.min(70, termWidth - 6));
    const muted = tint(t.textMuted, 0.9);
    const body: StyledSpan[][] = [];
    let hint = "enter close · esc close";
    const spin = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][Math.floor(Date.now() / 80) % 10];

    if (st.kind === "checking") {
      body.push([span(`   ${spin}  `, { fg: BRAND_BLUE }), span("Checking npm for a newer XYRO…", { fg: t.text })]);
    } else if (st.kind === "uptodate") {
      body.push([span("   ✓ ", { fg: t.success, bold: true }), span(`You're on the latest version, v${st.current}.`, { fg: t.text })]);
    } else if (st.kind === "offline") {
      body.push([span("   ! ", { fg: BRAND_AMBER, bold: true }), span("Couldn't reach the npm registry. Check your connection.", { fg: t.text })]);
      body.push([span(`     You're running v${st.current}.`, { fg: muted })]);
    } else if (st.kind === "available") {
      body.push([span(st.announce ? `   XYRO v${st.latest} is here.` : "   A new version of XYRO is ready.", { fg: t.text, bold: true })]);
      body.push([]);
      body.push([span("   "), span(`v${st.current}`, { fg: muted }), span("  →  ", { fg: tint(t.textMuted, 0.6) }), span(`v${st.latest}`, { fg: BRAND_LEMON, bold: true })]);
      if (st.notes?.length) {
        body.push([]);
        body.push([span("   WHAT'S NEW", { fg: muted, bold: true })]);
        for (const n of st.notes) {
          wrapSpans([span(n, { fg: tint(t.text, 0.9) })], boxW - 12).forEach((w, j) => body.push([span(j === 0 ? "   ◆ " : "     ", { fg: BRAND_LEMON }), ...w.spans]));
        }
      }
      body.push([]);
      body.push([span("   install  ", { fg: muted }), span(st.method, { fg: t.text })]);
      hint = st.announce ? "enter update now · esc later (/update any time)" : "enter install · esc later";
    } else if (st.kind === "installing") {
      const secs = Math.floor((Date.now() - st.startedAt) / 1000);
      body.push([span(`   ${spin}  `, { fg: BRAND_BLUE }), span(`Installing v${st.latest}…`, { fg: t.text, bold: true }), span(`  ${secs}s`, { fg: muted })]);
      body.push([span("      This usually takes under a minute.", { fg: muted })]);
      hint = "installing";
    } else {
      body.push([span(st.ok ? "   ✓ " : "   ✗ ", { fg: st.ok ? t.success : t.error, bold: true }), span(st.ok ? "Done." : "Update failed.", { fg: t.text, bold: true })]);
      for (const w of wrapSpans([span(st.message, { fg: tint(t.text, 0.85) })], boxW - 8)) body.push([span("     "), ...w.spans]);
    }
    return modalFrame(st.kind === "available" && st.announce ? "New version" : "Update XYRO", boxW, body, hint, BRAND_LEMON);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. EXPERTS ROSTER ("/experts")
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpertView {
  name: string;
  title: string;
  description: string;
  tools: string[];
  skills: string[];
  plugins: string[];
  triggers: string[];
  maxSteps: number;
  source: string;
  runs: number;
  ok: number;
  /** Assigned model ("" = session default) and token budget */
  model: string;
  budget: number;
}

export class ExpertsModal {
  private experts: ExpertView[] = [];
  private cursor = 0;
  private visible = false;
  private onAssignCb: ((expert: string) => void) | null = null;
  private onResetCb: ((expert: string) => void) | null = null;

  onAssignModel(cb: (expert: string) => void): void { this.onAssignCb = cb; }
  onResetModel(cb: (expert: string) => void): void { this.onResetCb = cb; }
  /** Keep the cursor when the list is refreshed (e.g. after assigning a model). */
  refresh(experts: ExpertView[]): void { this.experts = experts; }

  isOpen(): boolean { return this.visible; }
  open(experts: ExpertView[]): void {
    this.experts = experts;
    this.cursor = 0;
    this.visible = true;
  }
  close(): void { this.visible = false; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    const n = this.experts.length;
    const sel = this.experts[this.cursor];
    if (key === "\u001b" || cp === 13) this.visible = false;
    else if (key === "\u001b[A" && n) this.cursor = (this.cursor - 1 + n) % n;
    else if ((key === "\u001b[B" || cp === 9) && n) this.cursor = (this.cursor + 1) % n;
    else if (key === "m" && sel) {
      this.visible = false;
      this.onAssignCb?.(sel.name);
    } else if (key === "d" && sel) this.onResetCb?.(sel.name);
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(92, termWidth - 6));
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.9);
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [
      [span("   XYRO routes each task to the specialist that fits it, like an immune system.", { fg: muted })],
      [],
    ];
    this.experts.forEach((e, i) => {
      const sel = i === this.cursor;
      const bg = sel ? t.backgroundMenu : t.backgroundPanel;
      const record = e.runs ? `${e.ok}/${e.runs} ok` : "new";
      const tag = e.source === "builtin" ? "" : `  ${e.source}`;
      const descW = innerW - 3 - 13 - record.length - tag.length - 3;
      const desc = e.description.length > descW ? e.description.slice(0, descW - 1) + "…" : e.description.padEnd(descW);
      body.push({
        spans: [
          span(sel ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true }),
          span(e.title.padEnd(13).slice(0, 13), { fg: sel ? t.text : tint(t.text, 0.9), bold: true }),
          span(desc, { fg: sel ? tint(t.text, 0.85) : muted }),
          span(tag, { fg: BRAND_BLUE }),
          span("  " + record, { fg: e.runs ? (e.ok / e.runs >= 0.5 ? t.success : BRAND_AMBER) : tint(t.textMuted, 0.6) }),
        ],
        bg,
      });
    });

    const e = this.experts[this.cursor];
    if (e) {
      body.push([]);
      body.push([span("   " + "─".repeat(innerW - 6), { fg: tint(t.border, 0.6) })]);
      const row = (label: string, value: string, fg = tint(t.text, 0.9)) =>
        wrapSpans([span(value || "—", { fg })], innerW - 18).forEach((w, i) => body.push([span(i === 0 ? `   ${label.padEnd(12)}` : " ".repeat(15), { fg: muted }), ...w.spans]));
      row("expert", `${e.name}  ·  up to ${e.maxSteps} steps  ·  ${Math.round(e.budget / 1000)}k token budget`, BRAND_LEMON);
      row("model", e.model || "session default  (press m to assign one)", e.model ? BRAND_BLUE : muted);
      row("tools", e.tools.join(", "));
      row("skills", e.skills.join(", "));
      if (e.plugins.length) row("plugins", e.plugins.join(", "));
      row("triggers", e.triggers.slice(0, 12).join(", "), muted);
    }
    return modalFrame("Experts", boxW, body, "↑↓ browse · m assign model · d default model · esc close");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. REWIND PICKER ("/rewind", Esc Esc)
// ─────────────────────────────────────────────────────────────────────────────

export interface RewindItem {
  id: number;
  prompt: string;
  at: number;
  files: number;
}

export class RewindModal {
  private items: RewindItem[] = [];
  private cursor = 0;
  private visible = false;
  private onPickCb: ((id: number) => void) | null = null;

  isOpen(): boolean { return this.visible; }
  open(items: RewindItem[]): void {
    this.items = items;
    this.cursor = 0;
    this.visible = true;
  }
  close(): void { this.visible = false; }
  onPick(cb: (id: number) => void): void { this.onPickCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    const n = this.items.length;
    if (key === "\u001b") this.visible = false;
    else if (cp === 13) {
      const it = this.items[this.cursor];
      this.visible = false;
      if (it) this.onPickCb?.(it.id);
    } else if (key === "\u001b[A" && n) this.cursor = (this.cursor - 1 + n) % n;
    else if ((key === "\u001b[B" || cp === 9) && n) this.cursor = (this.cursor + 1) % n;
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(56, Math.min(84, termWidth - 6));
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.9);
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [];
    if (!this.items.length) {
      body.push([span("   Nothing to rewind yet — checkpoints are made before each message.", { fg: muted })]);
      return modalFrame("Rewind", boxW, body, "esc close", BRAND_AMBER);
    }
    body.push([span("   Go back to just before one of your messages. Files XYRO changed", { fg: muted })]);
    body.push([span("   since then are restored and the conversation is cut back to that point.", { fg: muted })]);
    body.push([]);
    this.items.slice(0, 12).forEach((it, i) => {
      const sel = i === this.cursor;
      const bg = sel ? t.backgroundMenu : t.backgroundPanel;
      const d = new Date(it.at);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const files = it.files ? `${it.files} file${it.files === 1 ? "" : "s"}` : "no files";
      const promptW = innerW - 3 - 7 - files.length - 3;
      const prompt = it.prompt.replace(/\s+/g, " ");
      body.push({
        spans: [
          span(sel ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true }),
          span(time + "  ", { fg: muted }),
          span((prompt.length > promptW ? prompt.slice(0, promptW - 1) + "…" : prompt).padEnd(promptW), { fg: sel ? t.text : tint(t.text, 0.88), bold: sel }),
          span("  " + files, { fg: it.files ? BRAND_AMBER : tint(t.textMuted, 0.6) }),
        ],
        bg,
      });
    });
    return modalFrame("Rewind", boxW, body, "↑↓ choose · enter rewind · esc cancel", BRAND_AMBER);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. HOOKS STATUS ("/hooks")
// ─────────────────────────────────────────────────────────────────────────────

export interface HooksView {
  projectStatus: "none" | "trusted" | "untrusted";
  events: { event: string; hooks: { matcher?: string; command: string }[] }[];
}

export class HooksModal {
  private view: HooksView | null = null;
  private onTrustCb: (() => void) | null = null;

  isOpen(): boolean { return this.view !== null; }
  open(view: HooksView): void { this.view = view; }
  close(): void { this.view = null; }
  onTrust(cb: () => void): void { this.onTrustCb = cb; }

  handleKey(key: string): boolean {
    if (!this.view) return false;
    if (key.toLowerCase() === "t" && this.view.projectStatus === "untrusted") this.onTrustCb?.();
    else if (key === "\u001b" || key.codePointAt(0) === 13) this.view = null;
    return true;
  }

  render(termWidth: number): RenderLine[] {
    const v = this.view;
    if (!v) return [];
    const t = currentTheme();
    const boxW = Math.max(56, Math.min(88, termWidth - 6));
    const muted = tint(t.textMuted, 0.9);
    const body: StyledSpan[][] = [];
    const status =
      v.projectStatus === "trusted"
        ? span("trusted — running", { fg: t.success, bold: true })
        : v.projectStatus === "untrusted"
          ? span("found but NOT trusted — press t to review and enable", { fg: BRAND_AMBER, bold: true })
          : span("none (.xyro/hooks.json)", { fg: muted });
    body.push([span("   project hooks  ", { fg: muted }), status]);
    body.push([span("   your hooks     ", { fg: muted }), span("~/.config/xyro/hooks.json", { fg: tint(t.text, 0.85) })]);
    body.push([]);
    const active = v.events.filter((e) => e.hooks.length);
    if (!active.length) {
      body.push([span("   No active hooks. Reflexes run shell commands at fixed moments,", { fg: muted })]);
      body.push([span("   e.g. format after every edit or block edits to migrations/.", { fg: muted })]);
    }
    for (const e of active) {
      body.push([span("   " + e.event, { fg: BRAND_LEMON, bold: true })]);
      for (const h of e.hooks) {
        for (const w of wrapSpans([span(h.command, { fg: t.text })], boxW - 22)) body.push([span(`     ${(h.matcher || "*").slice(0, 12).padEnd(13)}`, { fg: BRAND_BLUE }), ...w.spans]);
      }
    }
    return modalFrame("Hooks", boxW, body, v.projectStatus === "untrusted" ? "t trust project hooks · esc close" : "esc close");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. MCP SERVERS ("/mcp")
// ─────────────────────────────────────────────────────────────────────────────

export interface McpView {
  servers: { name: string; source: string; state: string; tools: number; error?: string; expertsOnly: boolean; transport: string }[];
  projectUntrusted: boolean;
}

export class McpModal {
  private view: (() => McpView) | null = null;
  private onTrustCb: (() => void) | null = null;

  isOpen(): boolean { return this.view !== null; }
  /** `view` is re-read every frame so connection progress shows live. */
  open(view: () => McpView, onTrust: () => void): void {
    this.view = view;
    this.onTrustCb = onTrust;
  }
  close(): void { this.view = null; }

  handleKey(key: string): boolean {
    if (!this.view) return false;
    if (key.toLowerCase() === "t" && this.view().projectUntrusted) this.onTrustCb?.();
    else if (key === "\u001b" || key.codePointAt(0) === 13) this.view = null;
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.view) return [];
    const v = this.view();
    const t = currentTheme();
    const boxW = Math.max(56, Math.min(88, termWidth - 6));
    const muted = tint(t.textMuted, 0.9);
    const spin = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][Math.floor(Date.now() / 80) % 10];
    const body: StyledSpan[][] = [];
    if (!v.servers.length) {
      body.push([span("   No MCP servers configured.", { fg: t.text })]);
      body.push([]);
      body.push([span("   Add them to ~/.config/xyro/mcp.json or .xyro/mcp.json:", { fg: muted })]);
      body.push([span('   { "mcpServers": { "github": { "command": "npx",', { fg: BRAND_BLUE })]);
      body.push([span('       "args": ["-y", "@modelcontextprotocol/server-github"] } } }', { fg: BRAND_BLUE })]);
      return modalFrame("MCP servers", boxW, body, "esc close");
    }
    for (const s of v.servers) {
      const state =
        s.state === "connected"
          ? span(`● connected  ${s.tools} tool${s.tools === 1 ? "" : "s"}`, { fg: t.success })
          : s.state === "connecting"
            ? span(`${spin} connecting`, { fg: BRAND_BLUE })
            : s.state === "untrusted"
              ? span("○ needs trust", { fg: BRAND_AMBER })
              : s.state === "disabled"
                ? span("○ disabled", { fg: tint(t.textMuted, 0.6) })
                : span("✗ failed", { fg: t.error });
      const tags = [s.source, s.transport, ...(s.expertsOnly ? ["experts only"] : [])].join(" · ");
      body.push([span("   " + s.name.padEnd(18).slice(0, 18), { fg: t.text, bold: true }), state, span("   " + tags, { fg: tint(t.textMuted, 0.65) })]);
      if (s.error) for (const w of wrapSpans([span(s.error, { fg: tint(t.error, 0.85) })], boxW - 10)) body.push([span("     "), ...w.spans]);
    }
    if (v.projectUntrusted) {
      body.push([]);
      body.push([span("   This project's .xyro/mcp.json launches commands on your machine.", { fg: BRAND_AMBER })]);
      body.push([span("   Review it, then press t to trust and connect.", { fg: muted })]);
    }
    return modalFrame("MCP servers", boxW, body, v.projectUntrusted ? "t trust project servers · esc close" : "esc close");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. FREE-QUOTA POOL ("/quota")
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotaRow {
  name: string;
  connected: boolean;
  requestsToday: number;
  tokensToday: number;
  rateLimitsToday: number;
  coolingForMs: number;
  learnedDailyRequests?: number;
  typicalFirstTokenMs?: number;
}

export class QuotaModal {
  private view: (() => QuotaRow[]) | null = null;

  isOpen(): boolean { return this.view !== null; }
  /** `view` is re-read every frame so cooldown countdowns tick live. */
  open(view: () => QuotaRow[]): void { this.view = view; }
  close(): void { this.view = null; }

  handleKey(key: string): boolean {
    if (!this.view) return false;
    if (key === "\u001b" || key.codePointAt(0) === 13) this.view = null;
    return true;
  }

  render(termWidth: number): RenderLine[] {
    if (!this.view) return [];
    const rows = this.view();
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(90, termWidth - 6));
    const muted = tint(t.textMuted, 0.9);
    const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    const body: StyledSpan[][] = [
      [span("   XYRO pools every free quota you have. When one provider hits its limit,", { fg: muted })],
      [span("   the request continues on the next one — no interruption. A request that", { fg: muted })],
      [span("   is unusually slow to start is raced against another provider.", { fg: muted })],
      [],
    ];
    const ready = rows.filter((r) => r.connected && r.coolingForMs === 0).length;
    body.push([span("   ", {}), span(`${ready} of ${rows.filter((r) => r.connected).length}`, { fg: t.success, bold: true }), span(" connected providers ready right now", { fg: tint(t.text, 0.9) })]);
    body.push([]);
    if (!rows.length) {
      body.push([span("   No providers connected yet. Add free keys with /provider to build your pool.", { fg: BRAND_AMBER })]);
    }
    for (const r of rows) {
      const mins = Math.ceil(r.coolingForMs / 60_000);
      const state = !r.connected
        ? span("○ no key", { fg: tint(t.textMuted, 0.6) })
        : r.coolingForMs > 0
          ? span(`◔ resting ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`}`, { fg: BRAND_AMBER })
          : span("● ready", { fg: t.success });
      const barW = 14;
      const limit = r.learnedDailyRequests && r.learnedDailyRequests > 0 ? r.learnedDailyRequests : 0;
      const used = limit ? Math.min(barW, Math.round((r.requestsToday / limit) * barW)) : 0;
      const bar = limit
        ? [span("▰".repeat(used), { fg: used > barW * 0.8 ? BRAND_AMBER : t.success }), span("▱".repeat(barW - used), { fg: tint(t.border, 0.8) })]
        : [span("limit not learned yet".slice(0, barW).padEnd(barW), { fg: tint(t.textMuted, 0.5) })];
      body.push([
        span("   " + r.name.replace(/\s*\(.*\)$/, "").padEnd(20).slice(0, 20), { fg: t.text, bold: true }),
        state,
        span(" ".repeat(Math.max(1, 14 - (state.text.length))), {}),
        ...bar,
        span(`  ${String(r.requestsToday).padStart(4)} req · ${fmt(r.tokensToday).padStart(5)} tok`, { fg: muted }),
        ...(r.typicalFirstTokenMs !== undefined ? [span(`  ${(r.typicalFirstTokenMs / 1000).toFixed(1)}s`, { fg: muted })] : []),
        ...(r.rateLimitsToday ? [span(`  ${r.rateLimitsToday}× limited`, { fg: BRAND_AMBER })] : []),
      ]);
    }
    return modalFrame("Free-quota pool", boxW, body, "esc close · add keys with /provider to grow the pool", t.success);
  }
}
