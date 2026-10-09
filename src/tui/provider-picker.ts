// XYRO Provider Setup Pop-Out Overlay
// Browse 25 free, router & local providers (including TokenRouter),
// curl/fetch live models directly from provider endpoints,
// prioritize FREE models at the top, highlight coding specialists,
// and configure API keys with live validation in a cyberpunk modal.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth, wrapSpans } from "./core.js";
import { FREE_PROVIDERS, Provider } from "../ui/prompts.js";
import { modalFrame } from "./overlays.js";
import { spinnerGlyph, shimmerSpans } from "./components.js";
import { fetchLiveProviderModels, DiscoveredModel, KeyRejectedError } from "../models/fetcher.js";
import { registerDiscoveredModels, ModelEntry } from "../models/catalog.js";

const BRAND_BLUE  = "#38BDF8";
const BRAND_GREEN = "#22C55E";
const BRAND_LEMON = "#C6F135";
const BRAND_AMBER = "#F59E0B";
const BRAND_RED   = "#EF4444";

export type ProviderSelectCallback = (
  provider: Provider,
  apiKey: string,
  model: string,
  baseURL: string
) => void;

export class ProviderPicker {
  private visible = false;
  private mode: "list" | "configure" | "fetching" | "model-select" = "list";
  private cursor = 0;
  private query = "";
  private filtered: Provider[] = FREE_PROVIDERS.slice();
  private currentProviderName = "";
  private currentApiKey = "";
  private scrollOff = 0;
  private maxVisible = 8;

  // Configure phase state
  private selectedProvider: Provider | null = null;
  private keyInput = "";
  private errorMsg = "";
  /** Why the key screen was opened directly (missing / rejected key). */
  private notice = "";
  /** Model the user already picked; skip the model list once the key works. */
  private pendingModel = "";
  private effectiveKey = "";

  // Live model discovery state
  private discoveredModels: DiscoveredModel[] = [];
  private filteredModels: DiscoveredModel[] = [];
  private modelCursor = 0;
  private modelQuery = "";
  private modelScrollOff = 0;
  private modelMaxVisible = 8;

  private onSelectCb: ProviderSelectCallback | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  open(currentProviderName: string, currentApiKey = ""): void {
    this.visible = true;
    this.mode = "list";
    this.currentProviderName = currentProviderName;
    this.currentApiKey = currentApiKey;
    this.query = "";
    this.filtered = FREE_PROVIDERS.slice();
    this.selectedProvider = null;
    this.keyInput = "";
    this.errorMsg = "";
    this.notice = "";
    this.pendingModel = "";
    this.discoveredModels = [];
    this.filteredModels = [];
    this.modelQuery = "";
    this.modelCursor = 0;

    // Position cursor on current provider if possible
    const idx = this.filtered.findIndex(
      (p) => p.name.toLowerCase() === currentProviderName.toLowerCase() ||
             p.id.toLowerCase() === currentProviderName.toLowerCase()
    );
    this.cursor = idx >= 0 ? idx : 0;
    this.scrollOff = Math.max(0, this.cursor - Math.floor(this.maxVisible / 2));
  }

  /**
   * Jump straight to the key screen for one provider, e.g. when its key is
   * missing or was rejected. If `model` is given, it is used as soon as the
   * key is accepted (no model list).
   */
  openForKey(providerId: string, opts: { model?: string; reason?: string } = {}): boolean {
    const p = FREE_PROVIDERS.find((x) => x.id === providerId);
    if (!p) return false;
    this.open(p.name, "");
    this.selectedProvider = p;
    this.mode = "configure";
    this.notice = opts.reason ?? "";
    this.pendingModel = opts.model ?? "";
    return true;
  }

  close(): void {
    this.visible = false;
    this.mode = "list";
    this.selectedProvider = null;
    this.keyInput = "";
    this.errorMsg = "";
    this.discoveredModels = [];
    this.filteredModels = [];
    this.onCloseCb?.();
  }

  onSelect(cb: ProviderSelectCallback): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;

    // ──────────────────────────────────────────────
    // MODE: MODEL SELECTION (Live Discovered Models)
    // ──────────────────────────────────────────────
    if (this.mode === "model-select") {
      const p = this.selectedProvider!;

      // Esc: back to configure screen
      if (key === "\u001b") {
        this.mode = "configure";
        return true;
      }

      // Enter: confirm chosen model and activate provider
      if (cp === 13) {
        const chosen = this.filteredModels[this.modelCursor] || this.discoveredModels[0];
        this.finish(p, chosen ? chosen.id : p.defaultModel);
        return true;
      }

      // Up Arrow
      if (key === "\u001b[A") {
        this.modelCursor = Math.max(0, this.modelCursor - 1);
        this._clampModelScroll();
        return true;
      }

      // Down Arrow
      if (key === "\u001b[B") {
        this.modelCursor = Math.min(this.filteredModels.length - 1, this.modelCursor + 1);
        this._clampModelScroll();
        return true;
      }

      // Backspace
      if (cp === 127 || cp === 8) {
        this.modelQuery = this.modelQuery.slice(0, -1);
        this._refilterModels();
        return true;
      }

      // Ctrl+U
      if (cp === 21) {
        this.modelQuery = "";
        this._refilterModels();
        return true;
      }

      // Model search typing
      if (cp >= 32 && !key.startsWith("\u001b")) {
        this.modelQuery += key;
        this._refilterModels();
        return true;
      }

      return true;
    }

    // ──────────────────────────────────────────────
    // MODE: FETCHING IN PROGRESS
    // ──────────────────────────────────────────────
    if (this.mode === "fetching") {
      // Allow Esc to cancel fetch and return to configure
      if (key === "\u001b") {
        this.mode = "configure";
      }
      return true;
    }

    // ──────────────────────────────────────────────
    // MODE: CONFIGURE KEY / ENDPOINT
    // ──────────────────────────────────────────────
    if (this.mode === "configure") {
      const p = this.selectedProvider!;

      // Esc: go back to list
      if (key === "\u001b") {
        this.mode = "list";
        this.keyInput = "";
        this.errorMsg = "";
        return true;
      }

      // Enter: validate key & start live model discovery
      if (cp === 13) {
        if (p.id === "local") {
          this.effectiveKey = "ollama";
          this._startLiveDiscovery(p, "ollama");
          return true;
        }

        const trimmed = this.keyInput.trim();
        const effectiveKey = trimmed || (this.isCurrentSelected() ? this.currentApiKey : "");

        if (!effectiveKey) {
          this.errorMsg = "API key required. Paste key or press Esc to return.";
          return true;
        }

        this.effectiveKey = effectiveKey;
        this._startLiveDiscovery(p, effectiveKey);
        return true;
      }

      // Backspace
      if (cp === 127 || cp === 8) {
        if (this.keyInput.length > 0) {
          this.keyInput = this.keyInput.slice(0, -1);
          this.errorMsg = "";
        }
        return true;
      }

      // Ctrl+U: clear input
      if (cp === 21) {
        this.keyInput = "";
        this.errorMsg = "";
        return true;
      }

      // Bracketed paste detection
      if (key.includes("\u001b[200~") || key.includes("\u001b[201~")) {
        const clean = key.replace(/\u001b\[[0-9]+~/g, "").replace(/[\r\n]/g, "").trim();
        this.keyInput += clean;
        this.errorMsg = "";
        return true;
      }

      // Multi-char paste or normal typing
      if (cp >= 32 && !key.startsWith("\u001b")) {
        this.keyInput += key.replace(/[\r\n]/g, "");
        this.errorMsg = "";
        return true;
      }

      return true;
    }

    // ──────────────────────────────────────────────
    // MODE: LIST / SEARCH PROVIDERS
    // ──────────────────────────────────────────────
    // Esc: close overlay
    if (key === "\u001b") {
      this.close();
      return true;
    }

    // Enter: select provider for configuration
    if (cp === 13) {
      const chosen = this.filtered[this.cursor];
      if (chosen) {
        this.selectedProvider = chosen;
        this.mode = "configure";
        this.keyInput = "";
        this.errorMsg = "";
      }
      return true;
    }

    // Up Arrow
    if (key === "\u001b[A") {
      this.cursor = Math.max(0, this.cursor - 1);
      this._clampScroll();
      return true;
    }

    // Down Arrow
    if (key === "\u001b[B") {
      this.cursor = Math.min(this.filtered.length - 1, this.cursor + 1);
      this._clampScroll();
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

    // Search typing
    if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this._refilter();
      return true;
    }

    return true;
  }

  private discoveryPromise: Promise<void> | null = null;

  waitForDiscovery(): Promise<void> {
    return this.discoveryPromise || Promise.resolve();
  }

  /** Register discovered models for /model, close, and report the choice. */
  private finish(p: Provider, modelId: string): void {
    const catalogEntries: ModelEntry[] = this.discoveredModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: p.name,
      providerId: p.id,
      isFree: m.isFree,
      badge: m.badge,
      desc: m.desc,
      baseURL: p.baseURL,
    }));
    registerDiscoveredModels(catalogEntries);
    this.visible = false;
    this.pendingModel = "";
    this.onSelectCb?.(p, this.effectiveKey, modelId, p.baseURL);
  }

  private _startLiveDiscovery(p: Provider, key: string): void {
    this.mode = "fetching";
    this.discoveryPromise = fetchLiveProviderModels(p.baseURL, key, p.id, p.models)
      .then((models) => {
        if (!this.visible || this.mode !== "fetching") return;
        if (this.pendingModel) {
          this.discoveredModels = models;
          this.finish(p, this.pendingModel);
          return;
        }
        this.discoveredModels = models;
        this.filteredModels = models.slice();
        this.modelCursor = 0;
        this.modelScrollOff = 0;
        this.modelQuery = "";
        this.mode = "model-select";
      })
      .catch((err) => {
        if (!this.visible || this.mode !== "fetching") return;
        if (err instanceof KeyRejectedError) {
          this.mode = "configure";
          this.keyInput = "";
          this.notice = "";
          this.errorMsg = `${p.name} rejected that key (${err.status}). Check it and paste it again.`;
          return;
        }
        if (this.pendingModel) {
          this.finish(p, this.pendingModel);
          return;
        }
        const fallback = p.models.map((m) => ({
          id: m,
          name: m,
          isFree: m.includes(":free") || m.includes("free") || p.id === "local",
          isCoding: true,
          badge: (p.id === "local" ? "LOCAL" : m.includes("free") ? "FREE" : "PAID") as any,
          desc: "Default provider model",
        }));
        this.discoveredModels = fallback;
        this.filteredModels = fallback.slice();
        this.modelCursor = 0;
        this.modelScrollOff = 0;
        this.modelQuery = "";
        this.mode = "model-select";
      });
  }

  private isCurrentSelected(): boolean {
    if (!this.selectedProvider) return false;
    return (
      this.selectedProvider.name.toLowerCase() === this.currentProviderName.toLowerCase() ||
      this.selectedProvider.id.toLowerCase() === this.currentProviderName.toLowerCase()
    );
  }

  private _refilter(): void {
    const q = this.query.trim().toLowerCase();
    if (!q) {
      this.filtered = FREE_PROVIDERS.slice();
    } else {
      this.filtered = FREE_PROVIDERS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q) ||
          p.limit.toLowerCase().includes(q) ||
          p.models.some((m) => m.toLowerCase().includes(q))
      );
    }
    this.cursor = 0;
    this.scrollOff = 0;
  }

  private _refilterModels(): void {
    const q = this.modelQuery.trim().toLowerCase();
    if (!q) {
      this.filteredModels = this.discoveredModels.slice();
    } else {
      this.filteredModels = this.discoveredModels.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.desc.toLowerCase().includes(q) ||
          (q === "free" && m.isFree) ||
          (q === "code" && m.isCoding)
      );
    }
    this.modelCursor = 0;
    this.modelScrollOff = 0;
  }

  private _clampScroll(): void {
    if (this.cursor < this.scrollOff) {
      this.scrollOff = this.cursor;
    } else if (this.cursor >= this.scrollOff + this.maxVisible) {
      this.scrollOff = this.cursor - this.maxVisible + 1;
    }
  }

  private _clampModelScroll(): void {
    if (this.modelCursor < this.modelScrollOff) {
      this.modelScrollOff = this.modelCursor;
    } else if (this.modelCursor >= this.modelScrollOff + this.modelMaxVisible) {
      this.modelScrollOff = this.modelCursor - this.modelMaxVisible + 1;
    }
  }

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    if (this.mode === "fetching") return this.renderFetching(termWidth);
    if (this.mode === "model-select") return this.renderModelSelect(termWidth);
    if (this.mode === "configure") return this.renderConfigure(termWidth);
    return this.renderList(termWidth);
  }

  private boxW(termWidth: number): number {
    return Math.max(60, Math.min(84, termWidth - 6));
  }

  /** "provider › key › model" with the current step emphasised. */
  private steps(active: 0 | 1 | 2): StyledSpan[] {
    const t = currentTheme();
    const names = ["provider", "key", "model"];
    const out: StyledSpan[] = [span("   ")];
    names.forEach((n, i) => {
      if (i) out.push(span("  ›  ", { fg: tint(t.textMuted, 0.5) }));
      out.push(span(n, i === active ? { fg: BRAND_LEMON, bold: true } : { fg: tint(t.textMuted, i < active ? 0.9 : 0.6) }));
    });
    return out;
  }

  private searchRow(query: string, placeholder: string): StyledSpan[] {
    const t = currentTheme();
    return [
      span("  ❯ ", { fg: BRAND_LEMON, bold: true }),
      ...(query ? [span(query, { fg: t.text, bold: true })] : [span(placeholder, { fg: tint(t.textMuted, 0.6), italic: true })]),
      span("▌", { fg: BRAND_LEMON }),
    ];
  }

  // 1. Choose a provider
  private renderList(termWidth: number): RenderLine[] {
    const t = currentTheme();
    const boxW = this.boxW(termWidth);
    const innerW = boxW - 2;
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [this.steps(0), [], this.searchRow(this.query, "search providers"), []];
    if (this.filtered.length === 0) {
      body.push([span("   No provider matches ", { fg: tint(t.textMuted, 0.9) }), span(`"${this.query}"`, { fg: t.text })]);
    } else {
      const end = Math.min(this.scrollOff + this.maxVisible, this.filtered.length);
      for (let i = this.scrollOff; i < end; i++) {
        const item = this.filtered[i];
        const selected = i === this.cursor;
        const current = [item.name, item.id].some((x) => x.toLowerCase() === this.currentProviderName.toLowerCase());
        const bg = selected ? t.backgroundMenu : t.backgroundPanel;
        const nameW = 24;
        const name = (item.name.length > nameW - 1 ? item.name.slice(0, nameW - 2) + "…" : item.name).padEnd(nameW);
        const info = item.limit || item.desc;
        const infoW = Math.max(8, innerW - 3 - nameW - 9);
        body.push({
          spans: [
            span(selected ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true }),
            span(name, { fg: selected || current ? t.text : tint(t.text, 0.88), bold: selected || current }),
            span(info.length > infoW ? info.slice(0, infoW - 1) + "…" : info.padEnd(infoW), { fg: selected ? tint(t.text, 0.8) : tint(t.textMuted, 0.8) }),
            span(current ? " current" : "", { fg: BRAND_GREEN, bold: true }),
          ],
          bg,
        });
      }
      if (this.filtered.length > this.maxVisible) {
        body.push([]);
        body.push([span(`   ${this.cursor + 1} of ${this.filtered.length} providers`, { fg: tint(t.textMuted, 0.6) })]);
      }
    }
    return modalFrame("Provider", boxW, body, "↑↓ move · enter connect · esc close");
  }

  // 2. Connect: steps + API key
  private renderConfigure(termWidth: number): RenderLine[] {
    const p = this.selectedProvider!;
    const t = currentTheme();
    const boxW = this.boxW(termWidth);
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.9);
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [this.steps(p.id === "local" ? 2 : 1), []];
    body.push([span("   " + p.name, { fg: t.text, bold: true }), span(`   ${p.limit}`, { fg: BRAND_GREEN })]);
    body.push([span("   " + (this.pendingModel ? "model          " : "default model  "), { fg: muted }), span(this.pendingModel || p.defaultModel, { fg: BRAND_LEMON })]);
    body.push([]);
    if (this.notice) {
      wrapSpans([span(this.notice, { fg: BRAND_AMBER })], innerW - 6).forEach((w) => body.push([span("   "), ...w.spans]));
      body.push([]);
    }

    if (p.id === "local") {
      body.push([span("   Runs on your machine through Ollama / vLLM. No key needed.", { fg: tint(t.text, 0.9) })]);
      body.push([]);
      body.push([span("   Press ", { fg: muted }), span("enter", { fg: t.text, bold: true }), span(" to look for local models.", { fg: muted })]);
      return modalFrame(`Connect ${p.name}`, boxW, body, "enter find models · esc back");
    }

    p.steps.slice(0, 3).forEach((step, i) => {
      wrapSpans([span(step, { fg: tint(t.text, 0.88) })], innerW - 8).forEach((w, j) =>
        body.push([span(j === 0 ? `   ${i + 1}  ` : "      ", { fg: BRAND_LEMON, bold: true }), ...w.spans])
      );
    });
    if (!p.steps.slice(0, 3).some((st) => st.includes(p.keyURL))) body.push([span("      ", {}), span(p.keyURL, { fg: BRAND_BLUE })]);
    body.push([]);

    const hasSaved = Boolean(this.currentApiKey) && this.isCurrentSelected();
    const fieldW = innerW - 6;
    const shown = this.keyInput ? "•".repeat(Math.min(this.keyInput.length, fieldW - 2)) : hasSaved ? "•••••••••••• saved" : "";
    body.push([span("   API key", { fg: t.text, bold: true })]);
    body.push([
      span("   "),
      span(" " + shown, { fg: this.keyInput ? BRAND_LEMON : tint(t.textMuted, 0.8), bg: t.backgroundElement }),
      span("▌", { fg: BRAND_LEMON, bg: t.backgroundElement }),
      span(" ".repeat(Math.max(0, fieldW - 2 - shown.length)), { bg: t.backgroundElement }),
    ]);
    if (this.errorMsg) {
      body.push([span("   ! ", { fg: BRAND_RED, bold: true }), span(this.errorMsg, { fg: BRAND_RED })]);
    } else if (hasSaved && !this.keyInput) {
      body.push([span("   A key is already saved. Press enter to keep it, or paste a new one.", { fg: muted })]);
    } else {
      body.push([span("   Paste or type your key, then press enter.", { fg: muted })]);
    }
    return modalFrame(`Connect ${p.name}`, boxW, body, "enter continue · esc back");
  }

  // 3. Discovering models
  private renderFetching(termWidth: number): RenderLine[] {
    const p = this.selectedProvider!;
    const t = currentTheme();
    const tick = Math.floor(Date.now() / 80);
    const body: StyledSpan[][] = [
      this.steps(2),
      [],
      [span("   " + spinnerGlyph(tick) + "  ", { fg: BRAND_BLUE }), ...shimmerSpans(`Looking for models on ${p.name}…`, tick, t.text, BRAND_LEMON)],
      [span("      GET ", { fg: BRAND_GREEN, bold: true }), span(`${p.baseURL}/models`, { fg: tint(t.textMuted, 0.9) })],
    ];
    return modalFrame(`Connect ${p.name}`, this.boxW(termWidth), body, "esc cancel");
  }

  // 4. Choose a model (free and coding models first)
  private renderModelSelect(termWidth: number): RenderLine[] {
    const p = this.selectedProvider!;
    const t = currentTheme();
    const boxW = this.boxW(termWidth);
    const innerW = boxW - 2;
    const free = this.discoveredModels.filter((m) => m.isFree).length;
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [
      this.steps(2),
      [],
      this.searchRow(this.modelQuery, `filter ${this.discoveredModels.length} models (${free} free first)`),
      [],
    ];
    if (this.filteredModels.length === 0) {
      body.push([span("   No model matches ", { fg: tint(t.textMuted, 0.9) }), span(`"${this.modelQuery}"`, { fg: t.text })]);
    } else {
      const end = Math.min(this.modelScrollOff + this.modelMaxVisible, this.filteredModels.length);
      for (let i = this.modelScrollOff; i < end; i++) {
        const m = this.filteredModels[i];
        const selected = i === this.modelCursor;
        const bg = selected ? t.backgroundMenu : t.backgroundPanel;
        const idW = 32;
        const id = (m.id.length > idW - 1 ? m.id.slice(0, idW - 2) + "…" : m.id).padEnd(idW);
        const tier = m.badge === "LOCAL" ? ["local", BRAND_LEMON] : m.isFree ? ["free", BRAND_GREEN] : ["pro", BRAND_AMBER];
        const descW = Math.max(6, innerW - 3 - idW - 6 - 6);
        body.push({
          spans: [
            span(selected ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true }),
            span(id, { fg: selected ? t.text : tint(t.text, 0.88), bold: selected }),
            span(tier[0].padEnd(6), { fg: tier[1] }),
            span((m.isCoding ? "code" : "").padEnd(6), { fg: BRAND_BLUE }),
            span(m.desc.length > descW ? m.desc.slice(0, descW - 1) + "…" : m.desc, { fg: selected ? tint(t.text, 0.8) : tint(t.textMuted, 0.8) }),
          ],
          bg,
        });
      }
      if (this.filteredModels.length > this.modelMaxVisible) {
        body.push([]);
        body.push([span(`   ${this.modelCursor + 1} of ${this.filteredModels.length} models`, { fg: tint(t.textMuted, 0.6) })]);
      }
    }
    return modalFrame(`Connect ${p.name}`, boxW, body, "↑↓ move · enter use model · esc back");
  }
}
