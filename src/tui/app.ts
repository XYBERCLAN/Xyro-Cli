import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { execSync } from "node:child_process";
import { currentTheme, tint } from "../ui/theme.js";
import {
  tuiInit,
  tuiExit,
  tuiSize,
  paintFrame,
  paintRowOverlay,
  ScrollRegion,
  span,
  line,
  emptyLine,
  visualWidth,
  RenderLine,
  StyledSpan,
  MouseEvt,
} from "./core.js";
import { SelectionManager } from "./selection.js";
import { userMessage, assistantText, assistantFooter, toolRunning, toolDone, errorMessage, agentColor } from "./components.js";
import { logoRows } from "./logo.js";
import { ModelPicker } from "./model-picker.js";
import { ThemePicker } from "./theme-picker.js";
import { ProviderPicker } from "./provider-picker.js";
import { Provider } from "../ui/prompts.js";
import {
  CommandPicker,
  AgentModePicker,
  StatusModal,
  CostModal,
  PermissionModal,
  AGENT_MODE_DEFS,
  AgentModeDef,
} from "./overlays.js";


// ─── XYRO cyber scanner ───────────────────────────────────────────────────
// width 10, blocks, bidirectional — colors pulled from active theme at render time
const KR_WIDTH = 10;
const KR_HOLD_END = 4;

const PLACEHOLDERS = [
  "Fix broken tests",
  "What is the tech stack of this project?",
  "Fix a TODO in the codebase",
  "Refactor the authentication flow",
  "Add unit tests for recent tools",
];

const TIPS = [
  "Use /help to show the help dialog",
  "Use /model to switch AI models on the fly",
  "Press Tab to switch agent modes (Build, Plan, Review)",
  "Use /provider to change API key or provider",
  "Use /cost to track token usage and session expense",
  "Use /compact to summarize context when sessions get long",
  "Use /status to inspect active models and tool count",
];

const AGENT_MODES = AGENT_MODE_DEFS;

const SPINNER_MS = 80;

function hexRgb(h: string): [number, number, number] {
  const m = h.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [128, 128, 128];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

function krScannerSpans(tick: number, _colorHex: string, _bgHex: string): StyledSpan[] {
  const t = currentTheme();
  // Build forward/backward trails dynamically from active theme palette
  const p = t.primary   || "#38BDF8";
  const s = t.secondary || "#22C55E";
  const a = t.accent    || "#C6F135";
  const fwdTrail = [a, s, p, tint(p, 0.6), tint(p, 0.35)];
  const bwdTrail = [p, tint(p, 0.6), s, a, tint(a, 0.6)];
  const inactive = tint(t.backgroundElement || "#1A2535", 0.25);

  const cycle = KR_WIDTH + KR_HOLD_END + (KR_WIDTH - 1);
  const f = tick % cycle;
  let active: number;
  let isFwd = true;
  if (f < KR_WIDTH) {
    active = f;
  } else if (f < KR_WIDTH + KR_HOLD_END) {
    active = KR_WIDTH - 1;
  } else {
    active = KR_WIDTH - 2 - (f - KR_WIDTH - KR_HOLD_END);
    isFwd = false;
  }

  const trail = isFwd ? fwdTrail : bwdTrail;
  const spans: StyledSpan[] = [];
  for (let i = 0; i < KR_WIDTH; i++) {
    const dist = isFwd ? (active - i) : (i - active);
    if (dist >= 0 && dist < trail.length) {
      spans.push(span("■", { fg: trail[dist] }));
    } else {
      spans.push(span("⬝", { fg: inactive }));
    }
  }
  return spans;
}

function detectGitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
  } catch {
    return "main";
  }
}

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    if (existsSync(pkgPath)) {
      return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.3.0";
    }
  } catch {
    // fallback
  }
  return "0.3.0";
}

type View = { view: "home" } | { view: "session" };

export class TuiApp {
  private scroll = new ScrollRegion();
  private view: View = { view: "home" };
  private input = "";
  private cursorPos = 0;
  private history: string[] = [];
  private historyIdx = -1;
  private savedInput = "";
  private phIdx = 0;
  private tipIdx = 0;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private animTick = 0;
  private busy = false;
  private turnStart = 0;
  private model = "";
  private provider = "";
  private agentModeIdx = 0;
  private agentName = "Build";
  private colorIdx = 1;
  private mcpCount = 1;
  private cwd = process.cwd();
  private gitBranch = detectGitBranch();
  private version = getPackageVersion();
  private modelPicker = new ModelPicker();
  private commandPicker = new CommandPicker();
  private agentPicker = new AgentModePicker();
  private statusModal = new StatusModal();
  private costModal = new CostModal();
  private permissionModal = new PermissionModal();
  private themePicker = new ThemePicker();
  private themeId = "xyro";
  private onThemeChangeCb: ((id: string) => void) | null = null;
  private providerPicker = new ProviderPicker();
  private apiKey = "";
  private onProviderChangeCb: ((provider: Provider, apiKey: string, model: string, baseURL: string) => void) | null = null;
  private totalToolCalls = 0;
  private totalMessages = 0;
  private tokenStats = { prompt: 0, completion: 0, total: 0, cost: "$0.0000" };
  private onModelChangeCb: ((id: string, baseURL?: string) => void) | null = null;
  private onAgentModeChangeCb: ((mode: AgentModeDef) => void) | null = null;
  private submitHandler: ((text: string) => Promise<void>) | null = null;
  private exitHandler: (() => void) | null = null;
  private selection = new SelectionManager();
  private lastFrameRows: RenderLine[] = [];

  constructor() {
    this.commandPicker.onSelect((cmd) => {
      this.handleCommandSelect(cmd);
    });
    this.agentPicker.onSelect((mode) => {
      this.setAgentMode(mode);
    });
    this.modelPicker.onSelect((id, baseURL) => {
      this.model = id;
      this.onModelChangeCb?.(id, baseURL);
    });
    this.themePicker.onSelect((theme) => {
      this.themeId = theme.id;
      this.onThemeChangeCb?.(theme.id);
    });
    this.providerPicker.onSelect((provider, apiKey, model, baseURL) => {
      this.provider = provider.name;
      this.model = model;
      this.apiKey = apiKey;
      this.onProviderChangeCb?.(provider, apiKey, model, baseURL);
    });
  }

  onSubmit(h: (text: string) => Promise<void>): void {
    this.submitHandler = h;
  }
  onExit(h: () => void): void {
    this.exitHandler = h;
  }
  onModelChange(cb: (id: string, baseURL?: string) => void): void {
    this.onModelChangeCb = cb;
  }
  onAgentModeChange(cb: (mode: AgentModeDef) => void): void {
    this.onAgentModeChangeCb = cb;
  }
  onThemeChange(cb: (id: string) => void): void {
    this.onThemeChangeCb = cb;
  }
  onProviderChange(cb: (provider: Provider, apiKey: string, model: string, baseURL: string) => void): void {
    this.onProviderChangeCb = cb;
  }
  setApiKey(k: string): void {
    this.apiKey = k;
  }
  setStats(tokens: { prompt: number; completion: number; total: number; cost: string }): void {
    this.tokenStats = tokens;
  }

  private handleCommandSelect(cmd: string): void {
    if (cmd === "/model") {
      this.openModelPicker();
    } else if (cmd === "/agent") {
      this.openAgentPicker();
    } else if (cmd === "/theme") {
      this.openThemePicker();
    } else if (cmd === "/provider") {
      this.openProviderPicker();
    } else if (cmd === "/status") {
      this.openStatus();
    } else if (cmd === "/cost") {
      this.openCost();
    } else if (cmd === "/help") {
      this.openCommandPicker();
    } else if (cmd === "/exit") {
      this.exitHandler?.();
    } else {
      const h = this.submitHandler;
      if (h) Promise.resolve(h(cmd)).catch((e) => this.addError(e instanceof Error ? e.message : String(e)));
    }
  }

  openThemePicker(): void {
    this.themePicker.open(this.themeId);
  }

  openProviderPicker(): void {
    this.providerPicker.open(this.provider, this.apiKey);
  }

  setAgentMode(mode: AgentModeDef): void {
    this.agentName = mode.name;
    this.colorIdx = mode.colorIdx;
    const idx = AGENT_MODES.findIndex((m) => m.name.toLowerCase() === mode.name.toLowerCase());
    if (idx >= 0) this.agentModeIdx = idx;
    this.onAgentModeChangeCb?.(mode);
  }

  openStatus(): void {
    this.statusModal.open({
      model: this.model || "default",
      provider: this.provider || "Auto",
      agentName: this.agentName,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      messagesCount: this.totalMessages,
      toolCallsCount: this.totalToolCalls,
      toolsCount: { total: 12, builtin: 10, plugins: 2 },
      mcpCount: this.mcpCount,
      version: this.version,
    });
  }

  openCost(): void {
    this.costModal.open({
      model: this.model || "default",
      provider: this.provider || "Auto",
      promptTokens: this.tokenStats.prompt,
      completionTokens: this.tokenStats.completion,
      totalTokens: this.tokenStats.total,
      costUSD: this.tokenStats.cost,
    });
  }

  openModelPicker(): void {
    this.modelPicker.open(this.model);
  }

  openCommandPicker(): void {
    this.commandPicker.open();
  }

  openAgentPicker(): void {
    this.agentPicker.open(this.agentName);
  }

  private getActiveOverlayRows(width: number): RenderLine[] {
    if (this.permissionModal.isOpen()) return this.permissionModal.render(width);
    if (this.modelPicker.isOpen()) return this.modelPicker.render(width);
    if (this.commandPicker.isOpen()) return this.commandPicker.render(width);
    if (this.agentPicker.isOpen()) return this.agentPicker.render(width);
    if (this.themePicker.isOpen()) return this.themePicker.render(width);
    if (this.providerPicker.isOpen()) return this.providerPicker.render(width);
    if (this.statusModal.isOpen()) return this.statusModal.render(width);
    if (this.costModal.isOpen()) return this.costModal.render(width);
    return [];
  }


  /** Ask the user to approve a tool call; resolves true on "y". */
  askPermission(label: string): Promise<boolean> {
    return this.permissionModal.ask(label);
  }

  setMeta(model: string, provider?: string, agentName?: string): void {
    this.model = model;
    if (provider) this.provider = provider;
    if (agentName) {
      this.agentName = agentName;
      const idx = AGENT_MODES.findIndex((m) => m.name.toLowerCase() === agentName.toLowerCase());
      if (idx >= 0) {
        this.agentModeIdx = idx;
        this.colorIdx = AGENT_MODES[idx].colorIdx;
      }
    }
  }
  setMcpCount(n: number): void {
    this.mcpCount = n;
  }

  start(): void {
    tuiInit(
      (key) => this.handleKey(key),
      () => this.render(),
      (e) => this.handleMouse(e)
    );
    this.animTimer = setInterval(() => {
      this.animTick++;
      if (this.animTick % 50 === 0) {
        this.phIdx = (this.phIdx + 1) % PLACEHOLDERS.length;
      }
      if (this.animTick % 100 === 0) {
        this.tipIdx = (this.tipIdx + 1) % TIPS.length;
      }
      this.render();
    }, SPINNER_MS);
    this.render();
  }

  stop(): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = null;
    tuiExit();
  }

  // ---- content events ----

  addUserMessage(text: string): void {
    this.totalMessages++;
    this.view = { view: "session" };
    this.scroll.append(emptyLine());
    this.scroll.appendAll(userMessage(text, this.colorIdx));
  }

  addAssistantText(md: string): void {
    const { width } = tuiSize();
    this.scroll.appendAll(assistantText(md, Math.max(30, width - 5)));
  }

  addAssistantFooter(dur: number): void {
    this.totalMessages++;
    this.scroll.appendAll(assistantFooter(this.agentName, this.model, dur, this.colorIdx));
  }

  addToolRunning(name: string, summary: string): void {
    this.totalToolCalls++;
    this.scroll.appendAll(toolRunning(name, summary));
  }

  addToolDone(name: string, summary: string, elapsed?: string, failed?: boolean): void {
    this.scroll.appendAll(toolDone(name, summary, elapsed, failed));
  }

  addError(text: string): void {
    this.scroll.appendAll(errorMessage(text));
  }

  setBusy(b: boolean): void {
    this.busy = b;
    if (b) this.turnStart = Date.now();
    else this.scroll.scrollToBottom();
  }

  // ---- render ----

  // ---- mouse selection ----

  private handleMouse(e: MouseEvt): void {
    // Only left-button events select; wheel/middle/right are ignored
    if (e.button !== 0 && e.kind !== "wheel") return;
    if (e.kind === "wheel") return; // native scroll passthrough (future work)

    const changed = this.selection.onMouse(e);
    if (!changed) return;

    // Auto-copy the moment the user releases the mouse button
    if (e.kind === "release" && this.selection.hasSelection()) {
      this.selection.copySelection();
    }
    this.render();
  }

  private render(): void {
    if (this.view.view === "home") this.renderHome();
    else this.renderSession();
  }

  // XYRO Home: centered logo → gap → centered prompt box → key hints → tip → footer.
  // When any pop-out overlay is open, it appears as an impeccable modal over the center area.
  private renderHome(): void {
    const { width, height } = tuiSize();
    const s = new ScrollRegion();

    const logo = logoRows(width, height, 5);
    const prompt = this.promptRows(true);
    const hints = this.keyHintsRow(true);
    const tip = this.tipRow();

    const overlayRows = this.getActiveOverlayRows(width);
    const hasOverlay = overlayRows.length > 0;

    const fixed =
      logo.length +
      (hasOverlay
        ? 2 + overlayRows.length
        : 4 + prompt.length + 1 + 2 + 1);

    const free = Math.max(0, height - fixed - 2);
    const topPad = hasOverlay ? 1 : Math.min(Math.max(2, Math.floor(free * 0.35)), 6);

    const logoW = Math.max(...logo.map((r) => r.spans.reduce((w, sp) => w + visualWidth(sp.text), 0)));
    const leftPad = Math.max(0, Math.floor((width - logoW) / 2));

    for (let i = 0; i < topPad; i++) s.append(emptyLine());
    for (const row of logo) {
      s.append(line(span(" ".repeat(leftPad)), ...row.spans));
    }
    s.append(emptyLine());
    if (!hasOverlay) {
      s.append(emptyLine());
      s.append(emptyLine());
      s.append(emptyLine());
    }

    if (hasOverlay) {
      for (const row of overlayRows) s.append(row);
      s.append(emptyLine());
    } else {
      for (const row of prompt) s.append(row);
      s.append(hints);
      s.append(emptyLine());
      s.append(emptyLine());
      s.append(tip);
    }

    paintFrame(s, [this.footerLine()], [emptyLine()], true);

    // Selection + toast compositing on the home screen too
    this.applyHomeSelectionOverlay(s, hasOverlay, overlayRows.length, prompt.length, logo.length);
  }

  /** Home-screen variant of the selection/toast compositor */
  private applyHomeSelectionOverlay(
    s: ScrollRegion,
    hasOverlay: boolean,
    overlayLen: number,
    promptLen: number,
    logoLen: number
  ): void {
    const { width, height } = tuiSize();
    const bottomH = 1; // footer only
    const topH = 1;

    // Reconstruct visible rows the same way renderHome laid them out
    const rows: RenderLine[] = [emptyLine()];
    rows.push(...s.visibleFromTop(Math.max(1, height - bottomH - topH)));
    rows.push(this.footerLine());
    this.selection.frameRows = rows;
    this.lastFrameRows = rows;

    const overlay = this.selection.highlightOverlay();
    if (overlay.length > 0) {
      const b = this.selection.bounds();
      if (b) {
        for (let i = 0; i < overlay.length; i++) {
          const row = overlay[i];
          if (!row) continue;
          paintRowOverlay(row, b.y1 + i, width);
        }
      }
    }

    const toast = this.selection.currentToast();
    if (toast) {
      const label = ` ${toast.text} `;
      const inner = Math.min(visualWidth(label), width - 6);
      const w = inner + 2;
      const row = topH + 2;
      const x = Math.max(1, width - w - 1);
      const bg = toast.kind === "error" ? "#EF4444" : toast.kind === "success" ? "#22C55E" : "#38BDF8";
      const clipped = label.slice(0, Math.max(1, inner));
      const pad = Math.max(0, inner - visualWidth(clipped));
      paintRowOverlay(line(span(" ".repeat(x - 1)), span("╭" + "─".repeat(inner) + "╮", { fg: bg })), row - 1, width);
      paintRowOverlay(
        line(
          span(" ".repeat(x - 1)),
          span("│", { fg: bg }),
          span(clipped + " ".repeat(pad), { fg: "#0D1117", bg, bold: true }),
          span("│", { fg: bg }),
        ),
        row,
        width
      );
      paintRowOverlay(line(span(" ".repeat(x - 1)), span("╰" + "─".repeat(inner) + "╯", { fg: bg })), row + 1, width);
    }
  }

  private renderSession(): void {
    const bottom: RenderLine[] = [];
    const overlayRows = this.getActiveOverlayRows(tuiSize().width);
    if (overlayRows.length > 0) {
      bottom.push(...overlayRows);
      bottom.push(emptyLine());
    } else {
      if (this.busy) bottom.push(...this.busyPromptRows(false));
      else bottom.push(...this.promptRows(false));
      bottom.push(this.keyHintsRow(false));
    }
    bottom.push(this.footerLine());
    paintFrame(this.scroll, bottom, [emptyLine()]);

    // In-app selection highlight + copy toast are composited over the frame
    this.applySelectionOverlay();
  }

  /**
   * Composite selection highlight and toast directly onto the screen after
   * paintFrame. Row geometry mirrors paintFrame: top[0] … top[H-1], then
   * viewH content rows, then bottom rows — all 1-based screen lines.
   */
  private applySelectionOverlay(): void {
    const { width, height } = tuiSize();
    const topH = 1; // [emptyLine()]
    const bottomH = this.currentBottomHeight();
    const viewH = Math.max(1, height - bottomH - topH);

    // Reconstruct the visible row list in screen order for the selection engine
    const overlayRows = this.getActiveOverlayRows(width);
    const bottom: RenderLine[] = [];
    if (overlayRows.length > 0) {
      bottom.push(...overlayRows);
      bottom.push(emptyLine());
    } else {
      if (this.busy) bottom.push(...this.busyPromptRows(false));
      else bottom.push(...this.promptRows(false));
      bottom.push(this.keyHintsRow(false));
    }
    bottom.push(this.footerLine());

    const rows: RenderLine[] = [emptyLine()];
    rows.push(...this.scroll.visible(viewH));
    while (rows.length < topH + viewH) rows.push(emptyLine());
    rows.push(...bottom);
    this.selection.frameRows = rows;
    this.lastFrameRows = rows;

    // Paint highlight rows in place
    const overlay = this.selection.highlightOverlay();
    if (overlay.length > 0) {
      const b = this.selectionBounds();
      if (b) {
        for (let i = 0; i < overlay.length; i++) {
          const row = overlay[i];
          if (!row) continue;
          const screenY = b.y1 + i;
          paintRowOverlay(row, screenY, width);
        }
      }
    }

    // Paint toast (top-right, auto-expiring)
    const toast = this.selection.currentToast();
    if (toast) {
      const label = ` ${toast.text} `;
      const inner = Math.min(visualWidth(label), width - 6);
      const w = inner + 2;
      const row = topH + 2;
      const x = Math.max(1, width - w - 1);
      const bg = toast.kind === "error" ? "#EF4444" : toast.kind === "success" ? "#22C55E" : "#38BDF8";
      const clipped = label.slice(0, Math.max(1, inner));
      const pad = Math.max(0, inner - visualWidth(clipped));
      paintRowOverlay(
        line(
          span(" ".repeat(x - 1)),
          span("╭" + "─".repeat(inner) + "╮", { fg: bg }),
        ),
        row - 1,
        width
      );
      paintRowOverlay(
        line(
          span(" ".repeat(x - 1)),
          span("│", { fg: bg }),
          span(clipped + " ".repeat(pad), { fg: "#0D1117", bg, bold: true }),
          span("│", { fg: bg }),
        ),
        row,
        width
      );
      paintRowOverlay(
        line(
          span(" ".repeat(x - 1)),
          span("╰" + "─".repeat(inner) + "╯", { fg: bg }),
        ),
        row + 1,
        width
      );
    }
  }

  /** Expose selection bounds for overlay painting (null when no selection) */
  private selectionBounds(): { x1: number; y1: number; x2: number; y2: number } | null {
    return this.selection.bounds();
  }

  /** Height of the current bottom stack (mirrors renderSession construction) */
  private currentBottomHeight(): number {
    const { width } = tuiSize();
    const overlayRows = this.getActiveOverlayRows(width);
    if (overlayRows.length > 0) {
      return overlayRows.length + 1 + 1; // rows + spacer + footer
    }
    // busy/idle prompt = 5 rows, hints = 1, footer = 1
    return 5 + 1 + 1;
  }

  // Unified 5-row prompt container with rounded brand borders and background fill
  private promptRows(centered = false): RenderLine[] {
    const t = currentTheme();
    const color = agentColor(this.colorIdx);
    const { width } = tuiSize();
    const boxW = Math.max(48, Math.min(74, width - 6));
    const innerW = boxW - 2;

    const leftMargin = centered ? Math.max(2, Math.floor((width - boxW) / 2)) : 2;

    // Row 1: Top border with styled XYRO brand badge
    const badge = " XYRO ";
    const remainingDash = Math.max(1, innerW - badge.length - 1);
    const topBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╭─", { fg: color }),
      span(badge, { fg: "#38BDF8", bold: true }),
      span("─".repeat(remainingDash), { fg: color }),
      span("╮", { fg: color })
    );

    // Row 2: Top breathing / padding row inside the card
    const topPaddingLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span(" ".repeat(innerW), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 3: Input text / placeholder with cyber cursor
    const maxVisibleChars = Math.max(10, innerW - 4);
    let contentSpans: StyledSpan[];
    let usedW = 0;
    if (!this.input) {
      const phFull = `sk anything ... "${PLACEHOLDERS[this.phIdx]}"`;
      const phText =
        phFull.length > maxVisibleChars - 1
          ? phFull.slice(0, maxVisibleChars - 4) + '..."'
          : phFull;
      contentSpans = [
        span("A", { fg: t.background, bg: color, bold: true }),
        span(phText, { fg: tint(t.textMuted, 0.75), bg: t.backgroundElement }),
      ];
      usedW = 1 + visualWidth(phText);
    } else {
      let visibleStart = 0;
      if (this.cursorPos > maxVisibleChars - 5) {
        visibleStart = this.cursorPos - (maxVisibleChars - 5);
      }
      const visibleInput = this.input.slice(visibleStart, visibleStart + maxVisibleChars);
      const relCursor = this.cursorPos - visibleStart;
      const before = visibleInput.slice(0, relCursor);
      const at = visibleInput[relCursor] || " ";
      const after = visibleInput.slice(relCursor + 1);
      contentSpans = [
        span(before, { fg: t.text, bg: t.backgroundElement }),
        span(at, { fg: t.background, bg: color, bold: true }),
        span(after, { fg: t.text, bg: t.backgroundElement }),
      ];
      usedW = visualWidth(before) + visualWidth(at) + visualWidth(after);
    }
    const pad1 = Math.max(0, innerW - 2 - usedW);

    const inputLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span("  ", { bg: t.backgroundElement }),
      ...contentSpans,
      span(" ".repeat(pad1), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 4: Status line: Build · model · max
    const provName = this.provider ? this.provider.split(" ")[0] : "";
    const dotSpan = () => span(" · ", { fg: tint(t.textMuted, 0.85), bg: t.backgroundElement });
    const line2Parts: StyledSpan[] = [
      span(this.agentName, { fg: color, bold: true, bg: t.backgroundElement }),
      dotSpan(),
      span(this.model || "default", { fg: tint(t.text, 0.98), bg: t.backgroundElement }),
      ...(provName ? [span(` ${provName}`, { fg: tint(t.textMuted, 0.8), bg: t.backgroundElement })] : []),
      dotSpan(),
      span("max", { fg: "#C6F135", bold: true, bg: t.backgroundElement }),
    ];
    const line2W = line2Parts.reduce((acc, s) => acc + visualWidth(s.text), 0);
    const pad2 = Math.max(0, innerW - 2 - line2W);

    const metaLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span("  ", { bg: t.backgroundElement }),
      ...line2Parts,
      span(" ".repeat(pad2), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 5: Bottom border
    const btmBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╰", { fg: color }),
      span("─".repeat(innerW), { fg: color }),
      span("╯", { fg: color })
    );

    return [topBorderLine, topPaddingLine, inputLine, metaLine, btmBorderLine];
  }

  // Busy state prompt rows: Knight-Rider brand scanner replaces input text
  private busyPromptRows(centered = false): RenderLine[] {
    const t = currentTheme();
    const color = agentColor(this.colorIdx);
    const { width } = tuiSize();
    const boxW = Math.max(48, Math.min(74, width - 6));
    const innerW = boxW - 2;

    const leftMargin = centered ? Math.max(2, Math.floor((width - boxW) / 2)) : 2;

    // Row 1: Top border with styled XYRO brand badge
    const badge = " XYRO ";
    const remainingDash = Math.max(1, innerW - badge.length - 1);
    const topBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╭─", { fg: color }),
      span(badge, { fg: "#C6F135", bold: true }),
      span("─".repeat(remainingDash), { fg: color }),
      span("╮", { fg: color })
    );

    // Row 2: Top breathing / padding row inside the card
    const topPaddingLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span(" ".repeat(innerW), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 3: Knight Rider cyber scanner + working label
    const scanner = krScannerSpans(this.animTick, color, t.background);
    const secs = ((Date.now() - this.turnStart) / 1000).toFixed(0);
    const statusText = "xyro is working…";
    const timeText = ` · ${secs}s`;
    const usedW = KR_WIDTH + 2 + visualWidth(statusText) + visualWidth(timeText);
    const pad1 = Math.max(0, innerW - 2 - usedW);

    const busyLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span("  ", { bg: t.backgroundElement }),
      ...scanner.map((s) => ({ ...s, bg: t.backgroundElement })),
      span("  ", { bg: t.backgroundElement }),
      span(statusText, { fg: "#38BDF8", bold: true, bg: t.backgroundElement }),
      span(timeText, { fg: tint(t.textMuted, 0.9), bg: t.backgroundElement }),
      span(" ".repeat(pad1), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 4: Status line: Build · model · working…
    const provName = this.provider ? this.provider.split(" ")[0] : "";
    const dotSpan = () => span(" · ", { fg: tint(t.textMuted, 0.85), bg: t.backgroundElement });
    const line2Parts: StyledSpan[] = [
      span(this.agentName, { fg: color, bold: true, bg: t.backgroundElement }),
      dotSpan(),
      span(this.model || "default", { fg: tint(t.text, 0.98), bg: t.backgroundElement }),
      ...(provName ? [span(` ${provName}`, { fg: tint(t.textMuted, 0.8), bg: t.backgroundElement })] : []),
      dotSpan(),
      span("working…", { fg: t.warning, bg: t.backgroundElement }),
    ];
    const line2W = line2Parts.reduce((acc, s) => acc + visualWidth(s.text), 0);
    const pad2 = Math.max(0, innerW - 2 - line2W);

    const metaLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span("  ", { bg: t.backgroundElement }),
      ...line2Parts,
      span(" ".repeat(pad2), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 5: Bottom border
    const btmBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╰", { fg: color }),
      span("─".repeat(innerW), { fg: color }),
      span("╯", { fg: color })
    );

    return [topBorderLine, topPaddingLine, busyLine, metaLine, btmBorderLine];
  }

  // Key hints row: right-aligned with the prompt box
  private keyHintsRow(centered = false): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();
    const boxW = Math.max(48, Math.min(74, width - 6));
    const hints = "tab agents   ctrl+p commands";
    const hintsW = visualWidth(hints);

    const leftMargin = centered ? Math.max(2, Math.floor((width - boxW) / 2)) : 2;
    const indent = leftMargin + boxW - hintsW;

    return line(
      span(" ".repeat(Math.max(2, indent))),
      span("tab", { fg: tint(t.text, 0.95), bold: true }),
      span(" agents   ", { fg: tint(t.textMuted, 0.75) }),
      span("ctrl+p", { fg: tint(t.text, 0.95), bold: true }),
      span(" commands", { fg: tint(t.textMuted, 0.75) })
    );
  }

  // Rotating tip line centered below the prompt
  private tipRow(): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();
    const tipText = TIPS[this.tipIdx];
    const fullTipW = 2 + visualWidth("Tip ") + visualWidth(tipText);
    const leftPad = Math.max(0, Math.floor((width - fullTipW) / 2));

    return line(
      span(" ".repeat(leftPad)),
      span("● ", { fg: t.warning }),
      span("Tip ", { fg: t.warning, bold: true }),
      span(tipText, { fg: tint(t.textMuted, 0.85) })
    );
  }

  private closeAnyOverlay(): boolean {
    if (this.permissionModal.isOpen()) { this.permissionModal.close(); return true; }
    if (this.modelPicker.isOpen()) { this.modelPicker.close(); return true; }
    if (this.commandPicker.isOpen()) { this.commandPicker.close(); return true; }
    if (this.agentPicker.isOpen()) { this.agentPicker.close(); return true; }
    if (this.themePicker.isOpen()) { this.themePicker.close(); return true; }
    if (this.providerPicker.isOpen()) { this.providerPicker.close(); return true; }
    if (this.statusModal.isOpen()) { this.statusModal.close(); return true; }
    if (this.costModal.isOpen()) { this.costModal.close(); return true; }
    return false;
  }

  // Footer: directory + branch, MCP counter, /status shortcut, version right-aligned
  private footerLine(): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();

    let dirLabel = "~";
    try {
      const base = basename(this.cwd);
      dirLabel = base ? base : "~";
    } catch {
      dirLabel = "~";
    }
    const branch = this.gitBranch ? `:${this.gitBranch}` : "";
    const leftDir = `${dirLabel}${branch}`;

    const mcpText = this.mcpCount > 0 ? `⊙ ${this.mcpCount} MCP` : `⊙ 1 MCP`;
    const statusText = "/status";

    const leftPartW = visualWidth(leftDir) + 2 + visualWidth(mcpText) + 2 + visualWidth(statusText);
    const verText = this.version || "0.3.0";
    const verW = visualWidth(verText);
    const gap = Math.max(1, width - leftPartW - verW - 1);

    return line(
      span(leftDir, { fg: tint(t.textMuted, 0.75) }),
      span("  "),
      span("⊙ ", { fg: t.success }),
      span(`${this.mcpCount > 0 ? this.mcpCount : 1} MCP  `, { fg: tint(t.textMuted, 0.75) }),
      span(statusText, { fg: tint(t.textMuted, 0.75) }),
      span(" ".repeat(gap)),
      span(verText, { fg: tint(t.textMuted, 0.6) })
    );
  }

  // ---- keys ----

  private handleKey(key: string): void {
    const cp = key.codePointAt(0) || 0;

    // Active modals take exclusive keyboard focus
    if (this.permissionModal.isOpen()) {
      this.permissionModal.handleKey(key);
      return;
    }
    if (this.modelPicker.isOpen()) {
      this.modelPicker.handleKey(key);
      return;
    }
    if (this.commandPicker.isOpen()) {
      this.commandPicker.handleKey(key);
      return;
    }
    if (this.agentPicker.isOpen()) {
      this.agentPicker.handleKey(key);
      return;
    }
    if (this.themePicker.isOpen()) {
      this.themePicker.handleKey(key);
      return;
    }
    if (this.providerPicker.isOpen()) {
      this.providerPicker.handleKey(key);
      return;
    }
    if (this.statusModal.isOpen()) {
      this.statusModal.handleKey(key);
      return;
    }
    if (this.costModal.isOpen()) {
      this.costModal.handleKey(key);
      return;
    }

    // Ctrl+C: copy selection if one exists, otherwise exit
    if (cp === 3) {
      if (this.selection.hasSelection() || this.selection.isSelecting()) {
        this.selection.copySelection();
        this.render();
        return;
      }
      if (!this.busy) this.exitHandler?.();
      return;
    }

    // Ctrl+P: toggle command center
    if (cp === 16) {
      if (this.commandPicker.isOpen()) this.commandPicker.close();
      else this.openCommandPicker();
      return;
    }

    // Tab: open agent persona picker
    if (cp === 9) {
      this.openAgentPicker();
      return;
    }

    // Escape: close any open modal or clear input
    if (key === "\u001b") {
      if (this.closeAnyOverlay()) return;
      if (this.selection.hasSelection() || this.selection.isSelecting()) {
        this.selection.clear();
        this.render();
        return;
      }
      this.input = "";
      this.cursorPos = 0;
      this.historyIdx = -1;
      return;
    }

    // PageUp / PageDown
    if (key === "\u001b[5~") return void this.scroll.scrollBy(10);
    if (key === "\u001b[6~") return void this.scroll.scrollBy(-10);

    // Left Arrow
    if (key === "\u001b[D") {
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      return;
    }

    // Right Arrow
    if (key === "\u001b[C") {
      this.cursorPos = Math.min(this.input.length, this.cursorPos + 1);
      return;
    }

    // Home / Ctrl+A
    if (key === "\u001b[H" || cp === 1) {
      this.cursorPos = 0;
      return;
    }

    // End / Ctrl+E
    if (key === "\u001b[F" || cp === 5) {
      this.cursorPos = this.input.length;
      return;
    }

    // Up Arrow: history navigation or scroll
    if (key === "\u001b[A") {
      if (this.view.view === "session" && this.input === "" && this.scroll.length() > 0) {
        this.scroll.scrollBy(1);
        return;
      }
      if (this.history.length > 0) {
        if (this.historyIdx === -1) {
          this.savedInput = this.input;
          this.historyIdx = this.history.length - 1;
        } else if (this.historyIdx > 0) {
          this.historyIdx--;
        }
        this.input = this.history[this.historyIdx] || "";
        this.cursorPos = this.input.length;
      }
      return;
    }

    // Down Arrow: history navigation or scroll
    if (key === "\u001b[B") {
      if (this.view.view === "session" && this.input === "" && !this.scroll.isSticky()) {
        this.scroll.scrollBy(-1);
        return;
      }
      if (this.historyIdx !== -1) {
        this.historyIdx++;
        if (this.historyIdx >= this.history.length) {
          this.historyIdx = -1;
          this.input = this.savedInput;
        } else {
          this.input = this.history[this.historyIdx] || "";
        }
        this.cursorPos = this.input.length;
      }
      return;
    }

    // Enter
    if (cp === 13) {
      this.closeAnyOverlay();
      const text = this.input.trim();
      this.input = "";
      this.cursorPos = 0;
      this.historyIdx = -1;
      if (!text || this.busy) return;

      // Pop-out modal triggers
      if (text === "/model" || text === "model") {
        this.openModelPicker();
        return;
      }
      if (text === "/agent" || text === "/mode" || text === "agent" || text === "mode") {
        this.openAgentPicker();
        return;
      }
      if (text === "/help" || text === "/commands" || text === "help" || text === "commands") {
        this.openCommandPicker();
        return;
      }
      if (text === "/status" || text === "status") {
        this.openStatus();
        return;
      }
      if (text === "/cost" || text === "cost") {
        this.openCost();
        return;
      }
      if (text === "/theme" || text === "theme") {
        this.openThemePicker();
        return;
      }
      if (text === "/provider" || text === "provider") {
        this.openProviderPicker();
        return;
      }

      // Normal command or prompt submission
      this.history.push(text);
      const h = this.submitHandler;
      if (h) Promise.resolve(h(text)).catch((e) => this.addError(e instanceof Error ? e.message : String(e)));
      return;
    }

    // Backspace
    if (cp === 127 || cp === 8) {
      if (this.cursorPos > 0) {
        this.input = this.input.slice(0, this.cursorPos - 1) + this.input.slice(this.cursorPos);
        this.cursorPos--;
      }
      return;
    }

    // Delete
    if (key === "\u001b[3~") {
      if (this.cursorPos < this.input.length) {
        this.input = this.input.slice(0, this.cursorPos) + this.input.slice(this.cursorPos + 1);
      }
      return;
    }

    // Ctrl+U
    if (cp === 21) {
      this.input = "";
      this.cursorPos = 0;
      return;
    }

    // Ignore other control characters
    if (cp < 32) return;

    // Normal typing
    if (!this.busy) {
      this.input = this.input.slice(0, this.cursorPos) + key + this.input.slice(this.cursorPos);
      this.cursorPos += key.length;
    }
  }
}

