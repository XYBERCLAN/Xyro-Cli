import { LanguagePicker } from "./language-picker.js";
import { teamStrip, MINI_H, MINI_W } from "./expert-bots.js";
import { instinctExpert } from "../agents/instinct.js";
import { fitToScreen } from "./fit.js";
import { readFileSync, existsSync } from "node:fs";
import { xyroVersion } from "../version.js";
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
  setFrameFilter,
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
import {
  userMessage,
  assistantText,
  assistantFooter,
  assistantHeader,
  thinkingRow,
  toolRow,
  noticeRow,
  errorMessage,
  agentColor,
  shimmerSpans,
  gradientSpans,
  BRAND,
} from "./components.js";
import { logoRows, introRows, isReducedMotion } from "./logo.js";
import { hasSeenIntro, markIntroSeen, hasOnboarded, markOnboarded } from "../config/persist.js";
import { MascotMood } from "./mascot.js";
import { composeModal, MODAL_OPEN_MS, MODAL_CLOSE_MS } from "./modal.js";
import { renderSidePanel, teamBots, panelVisible, panelWidth, PanelHit, PlanView } from "./side-panel.js";
import type { TodoView, PlanRequest, PlanDecision, AgentActivity } from "../agent/ui-bridge.js";
import { getExperts } from "../agents/experts.js";
import { readMemory } from "../agents/router.js";
import { expertModel, expertBudget, setExpertModel } from "../agents/team-config.js";
import { canonicalProviderId } from "../models/live.js";
import { poolStatus } from "../providers/pool.js";
import { ModelPicker } from "./model-picker.js";
import { ThemePicker } from "./theme-picker.js";
import { ProviderPicker } from "./provider-picker.js";
import { Provider, FREE_PROVIDERS } from "../ui/prompts.js";
import {
  CommandPicker,
  AgentModePicker,
  StatusModal,
  CostModal,
  PermissionModal,
  UpdateModal,
  UpdateModalState,
  ExpertsModal,
  RewindModal,
  RewindItem,
  HooksModal,
  HooksView,
  McpModal,
  McpView,
  QuotaModal,
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


type View = { view: "home" } | { view: "session" };

/** Lines the chat moves per mouse-wheel notch. */
const WHEEL_LINES = 3;

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
  private logoShownAt = 0;
  private introStart = 0;
  private introTimer: ReturnType<typeof setInterval> | null = null;
  private flashMood: { mood: MascotMood; until: number } | null = null;
  private model = "";
  private provider = "";
  private agentModeIdx = 0;
  private agentName = "Build";
  private colorIdx = 1;
  private mcpCount = 0;
  private cwd = process.cwd();
  private gitBranch = detectGitBranch();
  private version = xyroVersion();
  private modelPicker = new ModelPicker();
  private commandPicker = new CommandPicker();
  private agentPicker = new AgentModePicker();
  private statusModal = new StatusModal();
  private costModal = new CostModal();
  private permissionModal = new PermissionModal();
  private permissionQueue: Promise<void> = Promise.resolve();
  private expertsModal = new ExpertsModal();
  private agents: AgentActivity[] = [];
  private rewindModal = new RewindModal();
  private hooksModal = new HooksModal();
  private mcpModal = new McpModal();
  private quotaModal = new QuotaModal();
  private onMcpRequestCb: (() => void) | null = null;
  private lastEscAt = 0;
  /** checkpoint id → transcript length just before that user message */
  private scrollMarks = new Map<number, number>();
  private onRewindRequestCb: (() => void) | null = null;
  private onHooksRequestCb: (() => void) | null = null;
  private onIntentsRequestCb: ((arg: string) => void) | null = null;
  private onPrivacyRequestCb: ((arg: string) => void) | null = null;
  private onExpertsTrustCb: (() => void) | null = null;
  private onLearningRequestCb: ((cmd: string) => void) | null = null;
  private onLinkRequestCb: ((text: string) => void) | null = null;
  private onLanguageRequestCb: (() => void) | null = null;
  private onStopCb: (() => boolean) | null = null;
  private stopping = false;
  private linkedPeers = 0;
  private homeNotice: { label: string; text: string } | null = null;
  private updatePopup = new UpdateModal();
  /** Result of the background npm check (null until known). */
  private updateInfo: { current: string; latest: string; updateAvailable: boolean } | null = null;
  private onUpdateCb: ((action: "check" | "install") => void) | null = null;
  private themePicker = new ThemePicker();
  private languagePicker = new LanguagePicker();
  private onLanguageChangeCb: ((code: string) => void) | null = null;
  /** No AI provider connected yet (first launch): onboarding ends by connecting one */
  private needsProvider = false;
  private themeId = "xyro";
  private onThemeChangeCb: ((id: string) => void) | null = null;
  private providerPicker = new ProviderPicker();
  private apiKey = "";
  private onProviderChangeCb: ((provider: Provider, apiKey: string, model: string, baseURL: string) => void) | null = null;
  private totalToolCalls = 0;
  private totalMessages = 0;
  private tokenStats = { prompt: 0, completion: 0, total: 0, cost: "$0.0000" };
  private onModelChangeCb: ((id: string, baseURL?: string, providerId?: string) => void) | null = null;
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
    this.modelPicker.onSelect((id, baseURL, providerId) => {
      // Assigning a model to one expert (from /experts) instead of switching XYRO's own
      if (this.modelPickFor) {
        setExpertModel(this.modelPickFor, { model: id, providerId: providerId ? canonicalProviderId(providerId) : undefined });
        this.modelPickFor = null;
        this.openExperts();
        return;
      }
      this.model = id;
      this.onModelChangeCb?.(id, baseURL, providerId);
    });
    this.modelPicker.onClose(() => {
      if (this.modelPickFor) {
        this.modelPickFor = null;
        this.openExperts();
      }
    });
    this.themePicker.onSelect((theme) => {
      this.themeId = theme.id;
      if (this.welcomeOpen) this.completeOnboarding();
      else this.onThemeChangeCb?.(theme.id);
    });
    this.themePicker.onClose(() => {
      if (this.welcomeOpen) this.completeOnboarding();
    });
    this.languagePicker.onSelect((lang) => {
      this.onLanguageChangeCb?.(lang.code);
      // During the welcome, the look comes next
      if (this.welcomeOpen) this.themePicker.open(currentTheme().name, true);
    });
    this.providerPicker.onSelect((provider, apiKey, model, baseURL) => {
      if (this.needsProvider && apiKey) {
        this.needsProvider = false;
        this.setHomeNotice(null);
      }
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
  onModelChange(cb: (id: string, baseURL?: string, providerId?: string) => void): void {
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
    } else if (cmd === "/rewind") {
      this.onRewindRequestCb?.();
    } else if (cmd === "/hooks") {
      this.onHooksRequestCb?.();
    } else if (cmd === "/intents") {
      this.onIntentsRequestCb?.("");
    } else if (cmd === "/language") {
      this.onLanguageRequestCb?.();
    } else if (cmd === "/peers" || cmd === "/link") {
      this.onLinkRequestCb?.(cmd);
    } else if (cmd === "/learn" || cmd === "/profile" || cmd === "/forget") {
      this.onLearningRequestCb?.(cmd);
    } else if (cmd === "/privacy") {
      this.onPrivacyRequestCb?.("");
    } else if (cmd === "/mcp") {
      this.onMcpRequestCb?.();
    } else if (cmd === "/quota") {
      this.quotaModal.open(() => poolStatus());
    } else if (cmd === "/experts") {
      this.openExperts();
    } else if (cmd === "/update") {
      this.openUpdate();
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
    this.themePicker.open(currentTheme().name);
  }

  // ---- updates ----

  /** Store the background npm check result (drives the tip line and status rail). */
  setUpdateInfo(info: { current: string; latest: string; updateAvailable: boolean } | null): void {
    this.updateInfo = info;
  }

  onUpdate(cb: (action: "check" | "install") => void): void {
    this.onUpdateCb = cb;
    this.updatePopup.onConfirm(() => cb("install"));
  }

  /** Drive the /update pop-up from the entry layer. */
  setUpdateState(state: UpdateModalState | null): void {
    if (state) this.updatePopup.set(state);
    else this.updatePopup.close();
  }

  private openUpdate(): void {
    this.updatePopup.set({ kind: "checking" });
    this.onUpdateCb?.("check");
  }

  /** Open the key screen for one provider (missing or rejected key). */
  requestProviderKey(providerId: string, model?: string, reason?: string): void {
    this.providerPicker.openForKey(providerId, { model, reason });
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
    const prov = FREE_PROVIDERS.find((p) => p.name === this.provider);
    this.modelPicker.open(this.model, prov?.id ?? "");
  }

  openCommandPicker(): void {
    this.commandPicker.open();
  }

  openAgentPicker(): void {
    this.agentPicker.open(this.agentName);
  }

  /** A few teammates that doze in the side panel while nobody is working. */
  private restingCache: { name: string; title: string }[] | null = null;
  private restingTeam(): { name: string; title: string }[] {
    if (this.restingCache) return this.restingCache;
    const names = ["scout", "architect", "builder", "tester", "reviewer", "security", "debugger", "docs", "frontend"];
    const all = getExperts();
    this.restingCache = names.map((n) => all.find((e) => e.name === n)).filter((e): e is NonNullable<typeof e> => Boolean(e)).map((e) => ({ name: e.name, title: e.title }));
    return this.restingCache;
  }

  private getActiveOverlayRows(width: number): RenderLine[] {
    if (this.plan?.state === "pending" && this.view.view === "session" && !panelVisible(tuiSize().width)) {
      const w = Math.max(34, Math.min(width - 4, 72));
      const p = renderSidePanel({ ...this.panelStatus(), todos: [], plan: this.plan }, w, 60, this.animTick, { mascot: false });
      return p.rows.slice(0, p.used).map((r) => line(span("  "), ...r.spans));
    }
    if (this.permissionModal.isOpen()) return this.permissionModal.render(width);
    if (this.updatePopup.isOpen()) return this.updatePopup.render(width);
    if (this.expertsModal.isOpen()) return this.expertsModal.render(width);
    if (this.rewindModal.isOpen()) return this.rewindModal.render(width);
    if (this.hooksModal.isOpen()) return this.hooksModal.render(width);
    if (this.mcpModal.isOpen()) return this.mcpModal.render(width);
    if (this.quotaModal.isOpen()) return this.quotaModal.render(width);
    if (this.modelPicker.isOpen()) return this.modelPicker.render(width);
    if (this.commandPicker.isOpen()) return this.commandPicker.render(width);
    if (this.agentPicker.isOpen()) return this.agentPicker.render(width);
    if (this.languagePicker.isOpen()) return this.languagePicker.render(width);
    if (this.themePicker.isOpen()) return this.themePicker.render(width);
    if (this.providerPicker.isOpen()) return this.providerPicker.render(width);
    if (this.statusModal.isOpen()) return this.statusModal.render(width);
    if (this.costModal.isOpen()) return this.costModal.render(width);
    return [];
  }


  /** Ask the user to approve a tool call; resolves true on "y". */
  askPermission(label: string): Promise<boolean> {
    // Parallel experts may ask at once: show one prompt at a time, in order
    const turn = this.permissionQueue.then(() => this.permissionModal.ask(label));
    this.permissionQueue = turn.then(
      () => undefined,
      () => undefined
    );
    return turn;
  }

  // ---- checkpoints & hooks ----

  /** Remember where the transcript stood before a checkpointed message. */
  markCheckpoint(id: number): void {
    this.scrollMarks.set(id, this.scroll.length());
  }

  onRewindRequest(cb: () => void): void { this.onRewindRequestCb = cb; }
  onHooksRequest(cb: () => void): void { this.onHooksRequestCb = cb; }
  onIntentsRequest(cb: (arg: string) => void): void { this.onIntentsRequestCb = cb; }
  onPrivacyRequest(cb: (arg: string) => void): void { this.onPrivacyRequestCb = cb; }
  onExpertsTrust(cb: () => void): void { this.onExpertsTrustCb = cb; }
  onLearningRequest(cb: (cmd: string) => void): void { this.onLearningRequestCb = cb; }
  onLinkRequest(cb: (text: string) => void): void { this.onLinkRequestCb = cb; }
  onLanguageRequest(cb: () => void): void { this.onLanguageRequestCb = cb; }
  /** Esc while busy: stop the running turn (callback returns false when nothing was running). */
  onStop(cb: () => boolean): void { this.onStopCb = cb; }

  /** XYRO Link: how many other sessions on this project are connected. */
  setLinkedPeers(n: number): void {
    this.linkedPeers = n;
  }

  /** A message from someone in a linked XYRO session. */
  addPeerMessage(label: string, text: string, colorSeed: number): void {
    this.endStream();
    this.scroll.append(emptyLine());
    this.scroll.appendAll(userMessage(text, colorSeed, this.chatWidth(), label));
  }
  onMcpRequest(cb: () => void): void { this.onMcpRequestCb = cb; }

  openMcp(view: () => McpView, onTrust: () => void): void {
    this.mcpModal.open(view, onTrust);
  }

  openRewind(items: RewindItem[], onPick: (id: number) => void): void {
    this.rewindModal.onPick(onPick);
    this.rewindModal.open(items);
  }

  /** Cut the transcript back to just before checkpoint `id` and explain what happened. */
  rewindTranscript(id: number, summary: string): void {
    const mark = this.scrollMarks.get(id);
    this.endStream();
    this.clearThinking();
    this.headerAt = -1;
    this.liveTools = [];
    this.agents = [];
    if (mark !== undefined) this.scroll.truncate(mark);
    for (const k of [...this.scrollMarks.keys()]) if (k >= id) this.scrollMarks.delete(k);
    this.scroll.append(emptyLine());
    this.scroll.appendAll(noticeRow(summary, "info"));
    this.scroll.scrollToBottom();
  }

  openHooks(view: HooksView, onTrust: () => void): void {
    this.hooksModal.onTrust(onTrust);
    this.hooksModal.open(view);
  }

  /** A one-line message on the home screen (replaces the rotating tip). */
  setHomeNotice(n: { label: string; text: string } | null): void {
    this.homeNotice = n;
  }

  // ---- experts ----

  /** Live expert activity (from the agent runtime). */
  setAgentActivity(a: AgentActivity): void {
    const i = this.agents.findIndex((x) => x.id === a.id);
    if (i >= 0) this.agents[i] = a;
    else this.agents.push(a);
  }

  private expertViews() {
    const mem = readMemory();
    return getExperts().map((e) => {
      const m = expertModel(e.name);
      return {
        name: e.name,
        title: e.title,
        description: e.description,
        tools: e.tools,
        skills: e.skills,
        plugins: e.plugins,
        triggers: e.triggers,
        maxSteps: e.maxSteps,
        source: e.source,
        runs: mem.experts[e.name]?.runs ?? 0,
        ok: mem.experts[e.name]?.ok ?? 0,
        model: m ? `${m.model}${m.providerId ? `  (${m.providerId})` : ""}` : e.model ?? "",
        budget: expertBudget(e.name),
      };
    });
  }

  /** Expert whose model is being chosen in the model picker (null = normal switch). */
  private modelPickFor: string | null = null;

  openExperts(): void {
    this.expertsModal.onAssignModel((name) => {
      this.modelPickFor = name;
      this.openModelPicker();
    });
    this.expertsModal.onResetModel((name) => {
      setExpertModel(name, null);
      this.expertsModal.refresh(this.expertViews());
    });
    this.expertsModal.open(this.expertViews());
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

    // First launch: play the mascot intro at ~30fps (XYRO_INTRO=1 forces a replay)
    const forceIntro = process.env.XYRO_INTRO === "1";
    if (this.view.view === "home" && !isReducedMotion() && (forceIntro || !hasSeenIntro())) {
      this.introStart = Date.now();
      this.introTimer = setInterval(() => this.render(), 33);
    } else {
      this.maybeStartOnboarding();
    }
    this.render();
  }

  // ---- first launch: "Welcome to XYRO — pick a look" ----
  private welcomeOpen = false;

  /**
   * First launch, inside XYRO itself (never a bare text prompt): the mascot
   * intro, then the language, then a look, then connecting a free AI
   * provider when there is none yet.
   */
  private maybeStartOnboarding(): void {
    const force = process.env.XYRO_ONBOARD === "1";
    if (this.welcomeOpen || this.view.view !== "home") return;
    if (!force && hasOnboarded()) {
      if (this.needsProvider) this.openWelcomeProvider();
      return;
    }
    this.welcomeOpen = true;
    this.languagePicker.open(undefined, true);
  }

  private completeOnboarding(): void {
    this.welcomeOpen = false;
    if (process.env.XYRO_ONBOARD !== "1") markOnboarded();
    if (this.needsProvider) this.openWelcomeProvider();
  }

  private openWelcomeProvider(): void {
    this.providerPicker.open(this.provider, this.apiKey);
    this.setHomeNotice({ label: "setup", text: "Last step: connect a free AI provider (Google AI Studio and Groq have free keys) and XYRO is ready." });
  }

  /** Entry layer: no provider connected yet, so onboarding ends by connecting one. */
  setNeedsProvider(v: boolean): void {
    this.needsProvider = v;
  }

  onLanguageChange(cb: (code: string) => void): void {
    this.onLanguageChangeCb = cb;
  }

  openLanguagePicker(current?: string): void {
    this.languagePicker.open(current, false);
  }

  private finishIntro(): void {
    if (!this.introStart) return;
    this.introStart = 0;
    if (this.introTimer) clearInterval(this.introTimer);
    this.introTimer = null;
    // The intro already revealed the brand; skip the per-launch sweep
    this.logoShownAt = Date.now() - 10_000;
    if (process.env.XYRO_INTRO !== "1") markIntroSeen();
    this.maybeStartOnboarding();
  }

  stop(): void {
    if (this.introTimer) clearInterval(this.introTimer);
    if (this.modalTimer) clearInterval(this.modalTimer);
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = null;
    tuiExit();
  }

  // ---- content events ----

  // ---- side panel: tasks, plan approval, mini XYRO ----

  private todos: TodoView[] = [];
  private plan: (PlanView & { resolve?: (d: PlanDecision) => void }) | null = null;
  /** Clickable plan buttons in absolute screen coordinates (1-based). */
  private planHits: { action: "approve" | "reject"; y: number; x0: number; x1: number }[] = [];

  setTodos(todos: TodoView[]): void {
    this.todos = todos;
    this.syncPlanOwners(todos);
  }

  /** Show a plan with Approve / Revise and resolve once the user decides. */
  requestPlan(plan: PlanRequest): Promise<PlanDecision> {
    this.plan?.resolve?.({ approved: false, feedback: "superseded by a newer plan" });
    return new Promise((resolve) => {
      this.plan = { ...plan, state: "pending", focus: 0, resolve };
    });
  }

  private decidePlan(approved: boolean): void {
    if (!this.plan || this.plan.state !== "pending") return;
    const resolve = this.plan.resolve;
    this.plan = { ...this.plan, state: approved ? "approved" : "rejected", resolve: undefined };
    resolve?.({ approved, feedback: approved ? undefined : "The user chose to revise the plan." });
    this.render();
  }

  /** Width available to the chat column (the rest goes to the side panel). */
  private chatWidth(): number {
    const { width } = tuiSize();
    return panelVisible(width) ? width - panelWidth(width) : width;
  }

  /** What the mini XYRO is feeling, and the caption under it. */
  private panelStatus(): { mood: MascotMood; caption: string } {
    if (this.plan?.state === "pending") return { mood: "asking", caption: "waiting for your OK" };
    if (this.flashMood && Date.now() < this.flashMood.until) {
      return this.flashMood.mood === "error"
        ? { mood: "error", caption: "oops — something failed" }
        : { mood: "happy", caption: "done ✓" };
    }
    if (this.busy) {
      const working = this.agents.filter((a) => a.status === "running").length;
      if (working) return { mood: "thinking", caption: working === 1 ? `${this.agents.find((a) => a.status === "running")!.title} is working` : `${working} experts working` };
      const tool = this.liveTools[this.liveTools.length - 1];
      if (tool) return { mood: "thinking", caption: `working · ${tool.name.replace(/_/g, " ")}` };
      if (this.stream) return { mood: "thinking", caption: "writing…" };
      return { mood: "thinking", caption: "thinking…" };
    }
    return { mood: "idle", caption: "ready when you are" };
  }

  // ---- chat transcript ----
  // The transcript is append-only except for "live" rows that are refreshed
  // every frame in renderSession(): the thinking row, running tool rows and
  // the tail of the streaming reply (blinking cursor).

  private headerAt = -1;
  private thinkingAt = -1;
  private thinkingSince = 0;
  private stream: { start: number; text: string; lines: RenderLine[] } | null = null;
  private liveTools: { at: number; name: string; target: string; start: number }[] = [];
  private lastKind: "none" | "text" | "tool" = "none";

  private contentWidth(): number {
    return Math.max(30, Math.min(this.chatWidth() - 5, 110));
  }

  private ensureHeader(): void {
    if (this.headerAt >= 0) return;
    this.scroll.append(emptyLine());
    this.headerAt = this.scroll.length();
    this.scroll.appendAll(assistantHeader());
    this.lastKind = "none";
  }

  private showThinking(): void {
    if (this.thinkingAt >= 0) return;
    this.thinkingAt = this.scroll.length();
    this.thinkingSince = Date.now();
    this.scroll.append(thinkingRow(this.animTick, 0));
  }

  private clearThinking(): void {
    if (this.thinkingAt < 0) return;
    if (this.thinkingAt === this.scroll.length() - 1) this.scroll.truncate(this.thinkingAt);
    else this.scroll.setLine(this.thinkingAt, emptyLine());
    this.thinkingAt = -1;
  }

  private endStream(): void {
    if (!this.stream) return;
    // Restore the tail line (the cursor is only painted on a copy)
    const { start, lines } = this.stream;
    if (lines.length) this.scroll.setLine(start + lines.length - 1, lines[lines.length - 1]);
    this.stream = null;
  }

  addUserMessage(text: string): void {
    this.totalMessages++;
    this.scroll.scrollToBottom(); // sending always brings you back to the conversation
    this.view = { view: "session" };
    this.endStream();
    this.clearThinking();
    this.headerAt = -1;
    this.liveTools = [];
    this.agents = [];
    this.instinct.clear();
    this.scroll.append(emptyLine());
    this.scroll.appendAll(userMessage(text, this.colorIdx, this.chatWidth()));
  }

  addAssistantText(chunk: string): void {
    this.clearThinking();
    this.ensureHeader();
    if (!this.stream) {
      if (this.lastKind === "tool") this.scroll.append(emptyLine());
      this.stream = { start: this.scroll.length(), text: "", lines: [] };
    }
    this.stream.text += chunk;
    this.scroll.truncate(this.stream.start);
    this.stream.lines = assistantText(this.stream.text.replace(/^\n+/, ""), this.contentWidth());
    this.scroll.appendAll(this.stream.lines);
    this.lastKind = "text";
  }

  /** One-line confirmation (model/theme/provider switched, …). */
  addNotice(text: string, kind: "success" | "info" | "warn" = "success"): void {
    this.endStream();
    this.scroll.append(emptyLine());
    this.scroll.appendAll(noticeRow(text, kind));
  }

  addAssistantFooter(dur: number): void {
    this.totalMessages++;
    this.clearThinking();
    this.endStream();
    this.scroll.append(emptyLine());
    this.scroll.appendAll(assistantFooter(this.agentName, this.model, dur, this.colorIdx));
    this.headerAt = -1;
    this.lastKind = "none";
  }

  // Experts who recognised XYRO's current work as their trade (side-panel robots)
  private instinct = new Map<string, { expert: string; title: string; status: "running" | "ready" | "done" | "failed"; startedAt: number; running: number }>();

  /** Dispatch: the experts for this request wake up and wait, ready. */
  setDispatch(team: { name: string; title: string }[]): void {
    for (const m of team) {
      if (!this.instinct.has(m.name)) this.instinct.set(m.name, { expert: m.name, title: m.name, status: "ready", startedAt: Date.now(), running: 0 });
    }
  }

  /** Plan steps owned by experts: the owner works while its step is in progress. */
  private syncPlanOwners(todos: TodoView[]): void {
    for (const td of todos) {
      if (!td.expert) continue;
      const cur = this.instinct.get(td.expert);
      if (td.status === "in_progress") {
        if (cur?.status !== "running") this.instinct.set(td.expert, { expert: td.expert, title: td.expert, status: "running", startedAt: cur ? cur.startedAt : Date.now(), running: cur?.running ?? 0 });
      } else if (td.status === "pending" && !cur) {
        this.instinct.set(td.expert, { expert: td.expert, title: td.expert, status: "ready", startedAt: Date.now(), running: 0 });
      } else if (td.status === "done" && cur && !cur.running && !todos.some((o) => o.expert === td.expert && o.status !== "done")) {
        cur.status = "done";
      }
    }
  }

  private noteInstinct(tool: string, phase: "start" | "done", failed = false): void {
    const expert = instinctExpert(tool);
    if (!expert) return;
    const cur = this.instinct.get(expert);
    if (phase === "start") {
      // Already awake (busy, or just finished): keep working, no second wake-up
      const awake = cur && (cur.status === "running" || Date.now() - cur.startedAt < 15_000);
      this.instinct.set(expert, { expert, title: expert, status: "running", startedAt: awake ? cur!.startedAt : Date.now(), running: (cur?.status === "running" ? cur.running : 0) + 1 });
    } else if (cur) {
      cur.running = Math.max(0, cur.running - 1);
      if (failed) cur.status = "failed";
      else if (!cur.running && cur.status === "running") cur.status = "done";
    }
  }

  addToolRunning(name: string, summary: string): void {
    this.noteInstinct(name, "start");
    this.totalToolCalls++;
    this.clearThinking();
    this.ensureHeader();
    this.endStream();
    if (this.lastKind === "text") this.scroll.append(emptyLine());
    this.liveTools.push({ at: this.scroll.length(), name, target: summary, start: Date.now() });
    this.scroll.append(toolRow(name, summary, "running", this.animTick, 0, "", this.chatWidth()));
    this.lastKind = "tool";
  }

  addToolDone(name: string, summary: string, elapsed?: string, failed?: boolean): void {
    this.noteInstinct(name, "done", Boolean(failed));
    const i = this.liveTools.findIndex((tl) => tl.name === name);
    const secs = Number(elapsed ?? 0);
    if (i >= 0) {
      const tl = this.liveTools.splice(i, 1)[0];
      this.scroll.setLine(tl.at, toolRow(name, tl.target, failed ? "failed" : "done", 0, secs, summary, this.chatWidth()));
    } else {
      this.scroll.append(toolRow(name, "", failed ? "failed" : "done", 0, secs, summary, this.chatWidth()));
    }
    // The model thinks again before its next step
    if (this.busy && this.liveTools.length === 0) this.showThinking();
  }

  addError(text: string): void {
    this.flashMood = { mood: "error", until: Date.now() + 3000 };
    this.clearThinking();
    this.endStream();
    this.scroll.append(emptyLine());
    this.scroll.appendAll(errorMessage(text, this.chatWidth()));
  }

  setBusy(b: boolean): void {
    this.busy = b;
    this.stopping = false;
    // Turn over: experts that were ready but never needed go back to rest
    if (!b) for (const [k, v] of this.instinct) if (v.status === "ready") this.instinct.delete(k);
    if (b) {
      this.turnStart = Date.now();
      if (this.view.view === "session") {
        this.ensureHeader();
        this.showThinking();
      }
    } else {
      this.clearThinking();
      this.endStream();
      // A turn that produced nothing (e.g. a slash command): drop the bare header
      if (this.headerAt >= 0 && this.headerAt === this.scroll.length() - 1) {
        this.scroll.truncate(this.headerAt - 1);
      }
      this.headerAt = -1;
      this.scroll.scrollToBottom();
      if (this.flashMood?.mood !== "error") this.flashMood = { mood: "happy", until: Date.now() + 2000 };
    }
  }

  /** Refresh live transcript rows for the current frame. */
  private refreshLiveRows(): void {
    const width = this.chatWidth();
    if (this.thinkingAt >= 0) {
      this.scroll.setLine(this.thinkingAt, thinkingRow(this.animTick, (Date.now() - this.thinkingSince) / 1000, this.stopping));
    }
    for (const tl of this.liveTools) {
      this.scroll.setLine(tl.at, toolRow(tl.name, tl.target, "running", this.animTick, (Date.now() - tl.start) / 1000, "", width));
    }
    if (this.stream && this.busy && this.stream.lines.length) {
      const { start, lines } = this.stream;
      const tail = lines[lines.length - 1];
      const on = Math.floor(this.animTick / 6) % 2 === 0;
      this.scroll.setLine(start + lines.length - 1, on ? line(...tail.spans, span("▌", { fg: BRAND.lemon })) : tail);
    }
  }

  // ---- render ----

  // ---- mouse selection ----

  private handleMouse(e: MouseEvt): void {
    // Plan buttons in the side panel
    if (e.kind === "press" && e.button === 0 && this.plan?.state === "pending") {
      const hit = this.planHits.find((h) => h.y === e.y && e.x >= h.x0 && e.x < h.x1);
      if (hit) {
        this.decidePlan(hit.action === "approve");
        return;
      }
    }
    // Mouse wheel scrolls the chat (3 lines a notch); pop-ups keep it from moving underneath
    if (e.kind === "wheel") {
      // In a pop-up: move the selection, or scroll a pop-up without a list
      if (this.anyOverlayOpen()) {
        const up = e.button === 0;
        if (this.overlayHasCursor) this.handleKey(up ? "\u001b[A" : "\u001b[B");
        else this.overlayScroll = Math.max(0, this.overlayScroll + (up ? -WHEEL_LINES : WHEEL_LINES));
        this.render();
        return;
      }
      if (this.view.view !== "session") return;
      if (e.button === 0) this.scroll.scrollBy(WHEEL_LINES);
      else if (e.button === 1) this.scroll.scrollBy(-WHEEL_LINES);
      this.render();
      return;
    }
    // Only left-button events select; middle/right are ignored
    if (e.button !== 0) return;

    const changed = this.selection.onMouse(e);
    if (!changed) return;

    // Auto-copy the moment the user releases the mouse button
    if (e.kind === "release" && this.selection.hasSelection()) {
      this.selection.copySelection();
    }
    this.render();
  }

  private mascotMood(): MascotMood {
    if (this.busy) return "thinking";
    if (this.flashMood && Date.now() < this.flashMood.until) return this.flashMood.mood;
    return "idle";
  }

  // Pop-ups taller than the screen: keep the top and footer, scroll the middle
  private overlayScroll = 0;
  private overlayHasCursor = false;
  private lastOverlayHeight = 0;

  private fitOverlay(rows: RenderLine[], maxH: number, stickyTop: number): RenderLine[] {
    const fit = fitToScreen(rows, maxH, stickyTop, this.overlayScroll);
    this.overlayScroll = fit.scroll;
    this.overlayHasCursor = fit.hasCursor;
    return fit.rows;
  }

  private modal: { rows: RenderLine[]; openedAt: number; closingAt: number } | null = null;
  private modalTimer: ReturnType<typeof setInterval> | null = null;

  /** Track the open menu and drive its open/close animation via the frame filter. */
  private updateModal(): void {
    const { width, height } = tuiSize();
    const raw = this.getActiveOverlayRows(width);
    if (!raw.length) this.overlayScroll = 0;
    else if (raw.length !== this.lastOverlayHeight && !this.overlayHasCursor) this.overlayScroll = Math.min(this.overlayScroll, raw.length);
    this.lastOverlayHeight = raw.length;
    // The command palette keeps its search field in view while its list scrolls
    const rows = this.fitOverlay(raw, height - 2, this.commandPicker.isOpen() ? 4 : 1);
    const now = Date.now();
    if (rows.length) {
      if (!this.modal || this.modal.closingAt) this.modal = { rows, openedAt: now, closingAt: 0 };
      else this.modal.rows = rows;
    } else if (this.modal && !this.modal.closingAt) {
      this.modal.closingAt = now;
    }

    let progress = 1;
    let animating = false;
    if (this.modal) {
      if (this.modal.closingAt) {
        progress = 1 - (now - this.modal.closingAt) / MODAL_CLOSE_MS;
        animating = progress > 0;
        if (!animating) this.modal = null;
      } else {
        progress = Math.min(1, (now - this.modal.openedAt) / MODAL_OPEN_MS);
        animating = progress < 1;
      }
    }
    if (isReducedMotion() && this.modal) {
      progress = this.modal.closingAt ? 0 : 1;
      if (this.modal.closingAt) this.modal = null;
      animating = false;
    }

    // ~60fps only while a menu is moving
    if (animating && !this.modalTimer) this.modalTimer = setInterval(() => this.render(), 16);
    if (!animating && this.modalTimer) {
      clearInterval(this.modalTimer);
      this.modalTimer = null;
    }

    const modal = this.modal;
    setFrameFilter(modal ? (frame, w, h) => composeModal(frame, modal.rows, w, h, progress) : null);
  }

  private render(): void {
    this.updateModal();
    if (this.view.view !== "home") this.finishIntro();
    if (this.view.view === "home") this.renderHome();
    else this.renderSession();
  }

  // XYRO Home: centered logo → gap → centered prompt box → key hints → tip → footer.
  // When any pop-out overlay is open, it appears as an impeccable modal over the center area.
  private renderHome(): void {
    const { width, height } = tuiSize();
    const s = new ScrollRegion();

    let introPlaying = false;
    let logo;
    if (this.introStart) {
      const frame = introRows(width, height, Date.now() - this.introStart, this.animTick);
      if (frame.done) this.finishIntro();
      else introPlaying = true;
      logo = frame.rows;
    } else {
      if (!this.logoShownAt) this.logoShownAt = Date.now();
      logo = logoRows(width, height, 5, {
        tick: this.animTick,
        mood: this.mascotMood(),
        introElapsed: Date.now() - this.logoShownAt,
      });
    }
    const prompt = this.promptRows(true);
    const tagline = this.taglineRow();
    const chips = this.quickChipsRow();
    const tip = this.tipRow();

    // logo · tagline · prompt · quick actions · tip
    const fixed = logo.length + 1 + 1 + 2 + prompt.length + 1 + 1 + 1 + 1;
    const free = Math.max(0, height - fixed - 2);
    const topPad = Math.min(Math.max(2, Math.floor(free * 0.35)), 6);

    const logoW = Math.max(...logo.map((r) => r.spans.reduce((w, sp) => w + visualWidth(sp.text), 0)));
    const leftPad = Math.max(0, Math.floor((width - logoW) / 2));

    for (let i = 0; i < topPad; i++) s.append(emptyLine());
    for (const row of logo) s.append(line(span(" ".repeat(leftPad)), ...row.spans));
    s.append(emptyLine());
    // During the intro keep the same rows reserved, so nothing shifts after it
    if (introPlaying) {
      for (let i = 0; i < prompt.length + 7; i++) s.append(emptyLine());
    } else {
      s.append(tagline);
      s.append(emptyLine());
      s.append(emptyLine());
      for (const row of prompt) s.append(row);
      s.append(emptyLine());
      s.append(chips);
      s.append(emptyLine());
      s.append(tip);
    }

    paintFrame(s, [this.footerLine()], [emptyLine()], true);

    // Selection + toast compositing on the home screen too
    this.applyHomeSelectionOverlay(s, false, 0, prompt.length, logo.length);
  }

  /** "terminal-native coding agent · v<version>", centred under the logo. */
  private taglineRow(): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();
    const text = "terminal-native coding agent";
    const ver = `  ·  v${this.version}`;
    const pad = Math.max(0, Math.floor((width - visualWidth(text) - visualWidth(ver)) / 2));
    return line(span(" ".repeat(pad)), span(text, { fg: tint(t.text, 0.85) }), span(ver, { fg: tint(t.textMuted, 0.7) }));
  }

  /** Quick actions as key "chips", centred under the prompt. */
  private quickChipsRow(): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();
    const items: [string, string][] = [
      ["/init", "set up project"],
      ["/model", "switch model"],
      ["ctrl+p", "commands"],
      ["tab", "agent mode"],
    ];
    const chipW = ([k, l]: [string, string]) => k.length + 2 + 1 + l.length;
    const gap = 4;
    while (items.length > 1 && items.reduce((w, it) => w + chipW(it), 0) + gap * (items.length - 1) > width - 4) items.pop();
    const total = items.reduce((w, it) => w + chipW(it), 0) + gap * (items.length - 1);
    const spans: StyledSpan[] = [span(" ".repeat(Math.max(0, Math.floor((width - total) / 2))))];
    items.forEach(([k, l], i) => {
      if (i) spans.push(span(" ".repeat(gap)));
      spans.push(span(` ${k} `, { fg: BRAND.lemon, bg: t.backgroundElement, bold: true }), span(" " + l, { fg: tint(t.textMuted, 0.9) }));
    });
    return line(...spans);
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
    this.refreshLiveRows();
    const bottom: RenderLine[] = [];
    if (this.busy) bottom.push(...this.busyPromptRows(false));
    else bottom.push(...this.promptRows(false));
    bottom.push(this.footerLine());

    const { width, height } = tuiSize();
    this.planHits = [];
    if (panelVisible(width)) {
      // Chat on the left, panel on the right, sharing the transcript rows
      const pw = panelWidth(width);
      const chatW = width - pw;
      const viewH = Math.max(1, height - bottom.length - 1);
      const chat = this.scroll.visible(viewH);
      const status = this.panelStatus();
      const teamState = { agents: this.agents, instinct: [...this.instinct.values()], roster: this.restingTeam() };
      // The team lives in the strip beside the input box (always visible, even with a long plan)
      const promptRows = bottom.slice(0, -1);
      const stripW = width - chatW - 2;
      const useStrip = promptRows.length >= MINI_H && stripW >= MINI_W;
      const panel = renderSidePanel(
        { ...status, todos: this.todos, plan: this.plan, ...teamState, workingFor: this.busy ? Date.now() - this.turnStart : undefined },
        pw,
        viewH,
        this.animTick,
        { reducedMotion: isReducedMotion(), team: !useStrip }
      );
      if (useStrip) {
        const strip = teamStrip(teamBots(teamState).bots, stripW, promptRows.length, isReducedMotion() ? 0 : this.animTick);
        for (let r = 0; r < promptRows.length; r++) bottom[r] = line(...fitSpans(promptRows[r].spans, chatW), span("  "), ...strip[r]);
      }
      const composed = new ScrollRegion();
      for (let r = 0; r < viewH; r++) {
        composed.append(line(...fitSpans(chat[r]?.spans ?? [], chatW), ...panel.rows[r].spans));
      }
      for (const h of panel.hits) this.planHits.push({ action: h.action, y: 2 + h.row, x0: chatW + 1 + h.col0, x1: chatW + 1 + h.col1 });
      paintFrame(composed, bottom, [emptyLine()], true);
    } else {
      paintFrame(this.scroll, bottom, [emptyLine()]);
    }

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
    const bottom: RenderLine[] = [];
    if (this.busy) bottom.push(...this.busyPromptRows(false));
    else bottom.push(...this.promptRows(false));
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
    // busy/idle prompt = 6 rows, status rail = 1
    return 6 + 1;
  }

  /** Prompt card width: full chat column in a session, up to 96 on home. */
  private promptBoxW(centered: boolean): number {
    const { width } = tuiSize();
    return centered ? Math.max(48, Math.min(96, width - 8)) : Math.max(40, this.chatWidth() - 4);
  }

  private promptRows(centered = false): RenderLine[] {
    const t = currentTheme();
    const color = agentColor(this.colorIdx);
    const { width } = tuiSize();
    const boxW = this.promptBoxW(centered);
    const innerW = boxW - 2;

    const leftMargin = centered ? Math.max(2, Math.floor((width - boxW) / 2)) : 2;

    // Row 1: plain rounded top border
    const topBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╭" + "─".repeat(innerW) + "╮", { fg: color })
    );

    // Row 2: Top breathing / padding row inside the card
    const topPaddingLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span(" ".repeat(innerW), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 3: Input text / placeholder with cyber cursor, after a ❯ prompt glyph
    const maxVisibleChars = Math.max(10, innerW - 6);
    let contentSpans: StyledSpan[];
    let usedW = 0;
    if (!this.input) {
      const phFull = `sk anything ... "${PLACEHOLDERS[this.phIdx]}"`;
      const phText =
        phFull.length > maxVisibleChars - 1
          ? phFull.slice(0, maxVisibleChars - 4) + '..."'
          : phFull;
      contentSpans = [
        span("❯ ", { fg: color, bold: true, bg: t.backgroundElement }),
        span("A", { fg: t.background, bg: color, bold: true }),
        span(phText, { fg: tint(t.textMuted, 0.8), bg: t.backgroundElement }),
      ];
      usedW = 3 + visualWidth(phText);
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
        span("❯ ", { fg: color, bold: true, bg: t.backgroundElement }),
        span(before, { fg: t.text, bold: true, bg: t.backgroundElement }),
        span(at, { fg: t.background, bg: color, bold: true }),
        span(after, { fg: t.text, bold: true, bg: t.backgroundElement }),
      ];
      usedW = 2 + visualWidth(before) + visualWidth(at) + visualWidth(after);
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

    // Row 4: contextual hint (model/provider now live in the status rail)
    const hintParts: [string, string][] = this.input
      ? [["enter", "send"], ["ctrl+u", "clear"], ["↑", "history"]]
      : centered
        ? [["enter", "send"], ["↑", "history"], ["ctrl+u", "clear"]] // home: the chips below cover commands
        : centered
        ? [["enter", "send"], ["↑", "history"]] // home: the chips below already show / and tab
        : [["/", "commands"], ["tab", "mode"], ["↑", "history"], ["enter", "send"]];
    const hintSpans: StyledSpan[] = [];
    hintParts.forEach(([k, l], i) => {
      if (i) hintSpans.push(span("   ", { bg: t.backgroundElement }));
      hintSpans.push(span(k, { fg: tint(t.text, 0.9), bold: true, bg: t.backgroundElement }), span(" " + l, { fg: tint(t.textMuted, 0.8), bg: t.backgroundElement }));
    });
    const hintW = hintSpans.reduce((acc, sp) => acc + visualWidth(sp.text), 0);
    const metaLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span("    ", { bg: t.backgroundElement }),
      ...hintSpans,
      span(" ".repeat(Math.max(0, innerW - 4 - hintW)), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 5: Bottom border
    const btmBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╰", { fg: color }),
      span("─".repeat(innerW), { fg: color }),
      span("╯", { fg: color })
    );

    return [topBorderLine, topPaddingLine, inputLine, topPaddingLine, metaLine, btmBorderLine];
  }

  // Busy state prompt rows: Knight-Rider brand scanner replaces input text
  private busyPromptRows(centered = false): RenderLine[] {
    const t = currentTheme();
    const color = agentColor(this.colorIdx);
    const { width } = tuiSize();
    const boxW = this.promptBoxW(centered);
    const innerW = boxW - 2;

    const leftMargin = centered ? Math.max(2, Math.floor((width - boxW) / 2)) : 2;

    // Row 1: plain rounded top border
    const topBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╭" + "─".repeat(innerW) + "╮", { fg: color })
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
      ...shimmerSpans(statusText, this.animTick, "#38BDF8", "#E0F2FE", { bold: true, bg: t.backgroundElement }),
      span(timeText, { fg: tint(t.textMuted, 0.9), bg: t.backgroundElement }),
      span(" ".repeat(pad1), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 4: what XYRO is doing right now
    const activity = this.panelStatus().caption;
    const metaLine = line(
      span(" ".repeat(leftMargin)),
      span("│", { fg: color }),
      span("  ", { bg: t.backgroundElement }),
      span(activity, { fg: tint(t.textMuted, 0.9), italic: true, bg: t.backgroundElement }),
      span(" ".repeat(Math.max(0, innerW - 2 - visualWidth(activity))), { bg: t.backgroundElement }),
      span("│", { fg: color })
    );

    // Row 5: Bottom border
    const btmBorderLine = line(
      span(" ".repeat(leftMargin)),
      span("╰", { fg: color }),
      span("─".repeat(innerW), { fg: color }),
      span("╯", { fg: color })
    );

    return [topBorderLine, topPaddingLine, busyLine, topPaddingLine, metaLine, btmBorderLine];
  }

  // Key hints row: right-aligned with the prompt box
  // Rotating tip line centered below the prompt
  private tipRow(): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();
    if (this.homeNotice && !this.updateInfo?.updateAvailable) {
      const { label, text } = this.homeNotice;
      const w = visualWidth(`${label}  ›  ${text}`);
      return line(
        span(" ".repeat(Math.max(0, Math.floor((width - w) / 2)))),
        span(label, { fg: BRAND.lemon, bold: true }),
        span("  ›  ", { fg: tint(t.textMuted, 0.5) }),
        span(text, { fg: tint(t.text, 0.9) })
      );
    }
    if (this.updateInfo?.updateAvailable) {
      const msg = `XYRO v${this.updateInfo.latest} is available — type `;
      const w = visualWidth("update  ›  " + msg + "/update");
      return line(
        span(" ".repeat(Math.max(0, Math.floor((width - w) / 2)))),
        span("update", { fg: BRAND.lemon, bold: true }),
        span("  ›  ", { fg: tint(t.textMuted, 0.5) }),
        span(msg, { fg: tint(t.text, 0.9) }),
        span("/update", { fg: BRAND.lemon, bold: true })
      );
    }
    const tipText = TIPS[this.tipIdx];
    const fullTipW = visualWidth("tip  ›  ") + visualWidth(tipText);
    const leftPad = Math.max(0, Math.floor((width - fullTipW) / 2));

    return line(
      span(" ".repeat(leftPad)),
      span("tip", { fg: BRAND.ramp[0], bold: true }),
      span("  ›  ", { fg: tint(t.textMuted, 0.5) }),
      span(tipText, { fg: tint(t.textMuted, 0.8), italic: true })
    );
  }

  /** Is any pop-up / picker on screen? (the wheel must not scroll the chat underneath) */
  private anyOverlayOpen(): boolean {
    return [
      this.permissionModal, this.updatePopup, this.expertsModal, this.rewindModal, this.hooksModal, this.mcpModal, this.quotaModal,
      this.modelPicker, this.commandPicker, this.agentPicker, this.themePicker, this.languagePicker, this.providerPicker, this.statusModal, this.costModal,
    ].some((m) => m.isOpen());
  }

  private closeAnyOverlay(): boolean {
    if (this.permissionModal.isOpen()) { this.permissionModal.close(); return true; }
    if (this.updatePopup.isOpen()) { this.updatePopup.close(); return !this.updatePopup.isOpen(); }
    if (this.expertsModal.isOpen()) { this.expertsModal.close(); return true; }
    if (this.rewindModal.isOpen()) { this.rewindModal.close(); return true; }
    if (this.hooksModal.isOpen()) { this.hooksModal.close(); return true; }
    if (this.mcpModal.isOpen()) { this.mcpModal.close(); return true; }
    if (this.quotaModal.isOpen()) { this.quotaModal.close(); return true; }
    if (this.modelPicker.isOpen()) { this.modelPicker.close(); return true; }
    if (this.commandPicker.isOpen()) { this.commandPicker.close(); return true; }
    if (this.agentPicker.isOpen()) { this.agentPicker.close(); return true; }
    if (this.languagePicker.isOpen()) { this.languagePicker.close(); return true; }
    if (this.themePicker.isOpen()) { this.themePicker.close(); return true; }
    if (this.providerPicker.isOpen()) { this.providerPicker.close(); return true; }
    if (this.statusModal.isOpen()) { this.statusModal.close(); return true; }
    if (this.costModal.isOpen()) { this.costModal.close(); return true; }
    return false;
  }

  // Footer: directory + branch, MCP counter, /status shortcut, version right-aligned
  /**
   * XYRO status rail: one tinted strip along the bottom edge.
   * [ BUILD ] model · provider     folder on branch     tokens · cost   v<version>
   */
  private footerLine(): RenderLine {
    const t = currentTheme();
    const { width } = tuiSize();
    const bg = t.backgroundPanel;
    const color = agentColor(this.colorIdx);
    const dim = tint(t.textMuted, 0.85);

    let dir = "~";
    try {
      dir = basename(this.cwd) || "~";
    } catch {
      dir = "~";
    }
    const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

    const left: StyledSpan[] = [
      span(" "),
      span(` ${this.agentName.toUpperCase()} `, { fg: t.background, bg: color, bold: true }),
      span("  "),
      span(this.model || "no model", { fg: t.text, bold: true }),
      ...(this.provider ? [span("  " + this.provider.replace(/\s*\(.*\)$/, ""), { fg: dim })] : []),
    ];
    const middle: StyledSpan[] = [
      span(dir, { fg: tint(t.text, 0.85) }),
      ...(this.gitBranch ? [span(" on ", { fg: tint(t.textMuted, 0.6) }), span(this.gitBranch, { fg: t.success })] : []),
    ];
    const tok = this.tokenStats;
    const right: StyledSpan[] = [
      ...(tok && tok.total > 0 ? [span(`${fmtTok(tok.total)} tokens`, { fg: dim }), span("  ·  ", { fg: tint(t.textMuted, 0.5) }), span(tok.cost, { fg: dim }), span("    ")] : []),
      ...(this.view.view === "session" && !this.scroll.isSticky() ? [span("scrolled · End to follow", { fg: BRAND.lemon }), span("  ")] : []),
      ...(this.busy ? [span(this.stopping ? "stopping…" : "esc stop", { fg: this.stopping ? t.warning : dim }), span("  ")] : []),
      ...(this.linkedPeers ? [span(`${this.linkedPeers} linked`, { fg: BRAND.ramp[0], bold: true }), span("  ")] : []),
      ...(this.updateInfo?.updateAvailable ? [span(`update v${this.updateInfo.latest}`, { fg: BRAND.lemon, bold: true }), span("  ")] : []),
      span(`v${this.version} `, { fg: tint(t.textMuted, 0.6) }),
    ];
    const w = (xs: StyledSpan[]) => xs.reduce((a, sp) => a + visualWidth(sp.text), 0);
    const free = width - w(left) - w(middle) - w(right);
    const showMiddle = free >= 6;
    const gapL = showMiddle ? Math.max(3, Math.floor(free / 2)) : Math.max(1, width - w(left) - w(right));
    const gapR = showMiddle ? Math.max(3, free - gapL) : 0;
    const spans = [...left, span(" ".repeat(gapL)), ...(showMiddle ? [...middle, span(" ".repeat(gapR))] : []), ...right];
    return line(...spans.map((sp) => ({ ...sp, bg: sp.bg ?? bg })));
  }

  // ---- keys ----

  private handleKey(key: string): void {
    const cp = key.codePointAt(0) || 0;

    // Any key skips the first-launch intro
    if (this.introStart) {
      this.finishIntro();
      return;
    }

    // A pending plan takes the keyboard: y / n, ← → or Tab to move, Enter to choose
    if (this.plan?.state === "pending") {
      const k = key.toLowerCase();
      if (k === "y") this.decidePlan(true);
      else if (k === "n" || key === "\u001b") this.decidePlan(false);
      else if (key === "\u001b[D" || key === "\u001b[C" || cp === 9) this.plan.focus = this.plan.focus ? 0 : 1;
      else if (cp === 13) this.decidePlan(this.plan.focus === 0);
      return;
    }

    // Active modals take exclusive keyboard focus
    if (this.permissionModal.isOpen()) {
      this.permissionModal.handleKey(key);
      return;
    }
    if (this.updatePopup.isOpen()) {
      this.updatePopup.handleKey(key);
      return;
    }
    if (this.expertsModal.isOpen()) {
      this.expertsModal.handleKey(key);
      return;
    }
    if (this.rewindModal.isOpen()) {
      this.rewindModal.handleKey(key);
      return;
    }
    if (this.hooksModal.isOpen()) {
      this.hooksModal.handleKey(key);
      return;
    }
    if (this.mcpModal.isOpen()) {
      this.mcpModal.handleKey(key);
      return;
    }
    if (this.quotaModal.isOpen()) {
      this.quotaModal.handleKey(key);
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
    if (this.languagePicker.isOpen()) {
      this.languagePicker.handleKey(key);
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
      // While XYRO works, Esc stops the turn (the typed draft is kept)
      if (this.busy) {
        if (!this.stopping && this.onStopCb?.()) {
          this.stopping = true;
          if (this.thinkingAt < 0) this.addNotice("Stopping…", "warn");
        }
        return;
      }
      if (this.selection.hasSelection() || this.selection.isSelecting()) {
        this.selection.clear();
        this.render();
        return;
      }
      // Esc Esc on an empty prompt → rewind picker
      if (!this.input && this.view.view === "session" && !this.busy) {
        if (Date.now() - this.lastEscAt < 500) {
          this.lastEscAt = 0;
          this.onRewindRequestCb?.();
          return;
        }
        this.lastEscAt = Date.now();
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

    // End on an empty prompt: jump back to the newest message
    if (key === "\u001b[F" && !this.input && this.view.view === "session" && !this.scroll.isSticky()) {
      this.scroll.scrollToBottom();
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
      if (text === "/rewind" || text === "/undo") {
        this.onRewindRequestCb?.();
        return;
      }
      if (text === "/hooks") {
        this.onHooksRequestCb?.();
        return;
      }
      if (text === "/language" || text === "/lang") {
        this.onLanguageRequestCb?.();
        return;
      }
      if (/^\/(chat|say|peers|link)(\s|$)/.test(text)) {
        this.onLinkRequestCb?.(text);
        return;
      }
      if (text === "/learn" || text === "/profile" || text === "/forget") {
        this.onLearningRequestCb?.(text);
        return;
      }
      if (text === "/privacy" || text.startsWith("/privacy ")) {
        this.onPrivacyRequestCb?.(text.slice("/privacy".length).trim());
        return;
      }
      if (text === "/intents" || text.startsWith("/intents ")) {
        this.onIntentsRequestCb?.(text.slice("/intents".length).trim());
        return;
      }
      if (text === "/mcp") {
        this.onMcpRequestCb?.();
        return;
      }
      if (text === "/quota" || text === "/pool") {
        this.quotaModal.open(() => poolStatus());
        return;
      }
      if (text === "/experts trust" || text === "/agents trust") {
        this.onExpertsTrustCb?.();
        return;
      }
      if (text === "/experts" || text === "/agents" || text === "/team") {
        this.openExperts();
        return;
      }
      if (text === "/update" || text === "/upgrade") {
        this.openUpdate();
        return;
      }
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

    // "/" on an empty prompt opens the command palette, filtering as you type
    if (key === "/" && this.input === "" && !this.busy) {
      this.commandPicker.openWith("");
      return;
    }

    // Normal typing
    if (!this.busy) {
      this.input = this.input.slice(0, this.cursorPos) + key + this.input.slice(this.cursorPos);
      this.cursorPos += key.length;
    }
  }
}


/** Clip or pad a row of spans to exactly `w` cells. */
function fitSpans(spans: StyledSpan[], w: number): StyledSpan[] {
  const out: StyledSpan[] = [];
  let used = 0;
  for (const s of spans) {
    if (used >= w) break;
    let text = "";
    for (const ch of Array.from(s.text)) {
      const cw = visualWidth(ch);
      if (used + cw > w) break;
      text += ch;
      used += cw;
    }
    out.push({ ...s, text });
  }
  if (used < w) out.push({ text: " ".repeat(w - used) });
  return out;
}
