// XYRO Provider Setup Pop-Out Overlay
// Browse 25 free, router & local providers (including TokenRouter),
// curl/fetch live models directly from provider endpoints,
// prioritize FREE models at the top, highlight coding specialists,
// and configure API keys with live validation in a cyberpunk modal.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth } from "./core.js";
import { FREE_PROVIDERS, Provider } from "../ui/prompts.js";
import { renderModalTopBorder, renderModalBottomBorder } from "./overlays.js";
import { fetchLiveProviderModels, DiscoveredModel } from "../models/fetcher.js";
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

function getProviderRegion(p: Provider): { tag: string; color: string } {
  const n = p.name.toLowerCase();
  if (p.id === "local" || n.includes("local")) return { tag: "LOCAL", color: BRAND_LEMON };
  if (p.id === "tokenrouter" || n.includes("tokenrouter")) return { tag: "ROUTER", color: BRAND_BLUE };
  if (n.includes("usa") || n.includes("google") || n.includes("groq") || n.includes("openrouter") || n.includes("github")) {
    return { tag: "USA", color: BRAND_BLUE };
  }
  if (n.includes("france") || n.includes("eu") || n.includes("mistral") || n.includes("ovhcloud") || n.includes("nebius")) {
    return { tag: "EU", color: "#A78BFA" };
  }
  if (n.includes("china") || n.includes("alibaba") || n.includes("deepseek") || n.includes("qwen") || n.includes("zhipu")) {
    return { tag: "ASIA", color: BRAND_GREEN };
  }
  if (n.includes("israel") || n.includes("ai21")) return { tag: "MIDEAST", color: BRAND_AMBER };
  if (n.includes("canada") || n.includes("cohere")) return { tag: "CAN", color: "#38BDF8" };
  return { tag: "GLOBAL", color: "#94A3B8" };
}

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
        const chosenModelId = chosen ? chosen.id : p.defaultModel;

        // Register all discovered models in global catalog for /model access
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
        this.onSelectCb?.(p, this.effectiveKey, chosenModelId, p.baseURL);
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

  private _startLiveDiscovery(p: Provider, key: string): void {
    this.mode = "fetching";
    this.discoveryPromise = fetchLiveProviderModels(p.baseURL, key, p.id, p.models)
      .then((models) => {
        if (!this.visible || this.mode !== "fetching") return;
        this.discoveredModels = models;
        this.filteredModels = models.slice();
        this.modelCursor = 0;
        this.modelScrollOff = 0;
        this.modelQuery = "";
        this.mode = "model-select";
      })
      .catch(() => {
        if (!this.visible || this.mode !== "fetching") return;
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

  // ─────────────────────────────────────────────────────────────────────────
  // 1. RENDER LIST VIEW
  // ─────────────────────────────────────────────────────────────────────────
  private renderList(termWidth: number): RenderLine[] {
    const t = currentTheme();
    const boxW = Math.max(64, Math.min(84, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const borderCol = t.primary || BRAND_BLUE;
    const out: RenderLine[] = [];

    // 1. Top border
    out.push(renderModalTopBorder("Provider Setup", innerW, margin, borderCol));

    // 2. Search row
    const searchLbl = "  🔍 Search: ";
    const cursorStr = this.query + "▌";
    const searchHint = "(↑↓ browse · Enter setup · Esc close)  ";
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

    // 4. Provider Rows
    if (this.filtered.length === 0) {
      const emptyMsg = "  No providers match your search query.";
      const pad = Math.max(0, innerW - visualWidth(emptyMsg));
      out.push(
        line(
          span(margin),
          span("│", { fg: borderCol }),
          span(emptyMsg, { fg: tint(t.textMuted, 0.7), bg: t.backgroundElement }),
          span(" ".repeat(pad), { bg: t.backgroundElement }),
          span("│", { fg: borderCol })
        )
      );
    } else {
      const visibleEnd = Math.min(this.scrollOff + this.maxVisible, this.filtered.length);
      for (let i = this.scrollOff; i < visibleEnd; i++) {
        const item = this.filtered[i];
        const selected = i === this.cursor;
        const isCurrent =
          item.name.toLowerCase() === this.currentProviderName.toLowerCase() ||
          item.id.toLowerCase() === this.currentProviderName.toLowerCase();
        const bg = selected ? t.backgroundMenu : t.backgroundElement;
        const pointer = selected ? "› " : "  ";

        const reg = getProviderRegion(item);
        const regTag = `[${reg.tag}]`.padEnd(9);

        // Name column: fixed 28 chars
        let rawName = item.name.length > 27 ? item.name.slice(0, 26) + "…" : item.name;
        const nameCol = rawName.padEnd(28);

        const activeTag = isCurrent ? "● ACTIVE" : "";

        // Space budget for description
        const fixedUsed = 2 + 28 + 9 + (activeTag ? 10 : 0);
        const descW = Math.max(10, innerW - fixedUsed - 2);
        let descText = item.limit || item.desc;
        if (visualWidth(descText) > descW) {
          descText = descText.slice(0, descW - 1) + "…";
        }
        const descCol = descText.padEnd(descW);

        const usedW = 2 + visualWidth(nameCol) + visualWidth(regTag) + visualWidth(descCol) + (activeTag ? 10 : 0);
        const pad = Math.max(0, innerW - usedW);

        out.push(
          line(
            span(margin),
            span("│", { fg: borderCol }),
            span(pointer, { fg: selected ? BRAND_LEMON : tint(t.textMuted, 0.5), bg, bold: selected }),
            span(nameCol, { fg: selected ? "#FFFFFF" : tint(t.text, 0.95), bg, bold: selected }),
            span(regTag, { fg: reg.color, bg }),
            span(descCol, { fg: selected ? "#F3F4F6" : tint(t.textMuted, 0.75), bg }),
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
      const scrollInfo = `  ${this.scrollOff + 1}–${shown} of ${this.filtered.length} free providers  `;
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
    out.push(renderModalBottomBorder("↑↓ Navigate · Enter Configure · Esc Close", innerW, margin, borderCol));

    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. RENDER CONFIGURE VIEW
  // ─────────────────────────────────────────────────────────────────────────
  private renderConfigure(termWidth: number): RenderLine[] {
    const p = this.selectedProvider!;
    const t = currentTheme();
    const boxW = Math.max(64, Math.min(84, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const borderCol = t.primary || BRAND_BLUE;
    const out: RenderLine[] = [];

    const padRow = (contentSpans: StyledSpan[], rowBg = t.backgroundElement): RenderLine => {
      const used = contentSpans.reduce((acc, s) => acc + visualWidth(s.text), 0);
      const pad = Math.max(0, innerW - used);
      return line(
        span(margin),
        span("│", { fg: borderCol }),
        ...contentSpans,
        span(" ".repeat(pad), { bg: rowBg }),
        span("│", { fg: borderCol })
      );
    };

    // 1. Top border
    out.push(renderModalTopBorder(`Setup: ${p.name}`, innerW, margin, borderCol));

    // 2. Summary & Rate limits
    out.push(
      padRow([
        span("  ⚡ ", { fg: BRAND_LEMON }),
        span(p.name, { fg: "#FFFFFF", bold: true }),
        span(` · ${p.limit}`, { fg: BRAND_GREEN }),
      ])
    );

    // 3. Key Portal link
    out.push(
      padRow([
        span("  🔗 Key Portal: ", { fg: borderCol }),
        span(p.keyURL, { fg: BRAND_BLUE }),
      ])
    );

    // 4. Default Model & Endpoint
    out.push(
      padRow([
        span("  ⚙ Default Model: ", { fg: tint(t.textMuted, 0.8) }),
        span(p.defaultModel, { fg: BRAND_LEMON }),
        span("  ·  Endpoint: ", { fg: tint(t.textMuted, 0.8) }),
        span(p.baseURL.length > 30 ? p.baseURL.slice(0, 29) + "…" : p.baseURL, { fg: tint(t.textMuted, 0.9) }),
      ])
    );

    // 5. Separator
    out.push(
      line(
        span(margin),
        span("├", { fg: borderCol }),
        span("─".repeat(innerW), { fg: t.border }),
        span("┤", { fg: borderCol })
      )
    );

    // 6. Setup Steps (up to 3 concise steps)
    const stepsToShow = p.steps.slice(0, 3);
    for (let i = 0; i < stepsToShow.length; i++) {
      const stepText = `  ${i + 1}. ${stepsToShow[i]}`;
      const clipped = visualWidth(stepText) > innerW - 2 ? stepText.slice(0, innerW - 5) + "…" : stepText;
      out.push(padRow([span(clipped, { fg: tint(t.textMuted, 0.85) })]));
    }

    // 7. Input Section
    out.push(
      line(
        span(margin),
        span("├", { fg: borderCol }),
        span("─".repeat(innerW), { fg: t.border }),
        span("┤", { fg: borderCol })
      )
    );

    if (p.id === "local") {
      out.push(
        padRow([
          span("  💻 Local Mode: ", { fg: BRAND_LEMON, bold: true }),
          span("Connects to local Ollama / vLLM. No API key needed.", { fg: tint(t.text, 0.95) }),
        ])
      );
      out.push(
        padRow([
          span("  Press ", { fg: tint(t.textMuted, 0.75) }),
          span("Enter", { fg: BRAND_LEMON, bold: true }),
          span(" to curl local models, or ", { fg: tint(t.textMuted, 0.75) }),
          span("Esc", { fg: borderCol, bold: true }),
          span(" to go back.", { fg: tint(t.textMuted, 0.75) }),
        ])
      );
    } else {
      const hasExistingKey = Boolean(this.currentApiKey) && this.isCurrentSelected();
      const maskedInput = "*".repeat(this.keyInput.length) + "▌";

      out.push(
        padRow([
          span("  🔑 Paste / Type API Key: ", { fg: borderCol, bold: true }),
          span(this.keyInput ? maskedInput : (hasExistingKey ? "•••••••••••••••• (saved)▌" : "▌"), {
            fg: this.keyInput ? BRAND_LEMON : tint(t.textMuted, 0.7),
            bg: t.backgroundMenu,
          }),
        ])
      );

      if (hasExistingKey && !this.keyInput) {
        out.push(
          padRow([
            span("  ✓ Existing key saved. Press ", { fg: BRAND_GREEN }),
            span("Enter", { fg: BRAND_GREEN, bold: true }),
            span(" to discover models, or paste a new key.", { fg: BRAND_GREEN }),
          ])
        );
      } else {
        out.push(
          padRow([
            span("  Paste from clipboard or type · ", { fg: tint(t.textMuted, 0.75) }),
            span("Enter", { fg: BRAND_LEMON, bold: true }),
            span(" to fetch live models", { fg: tint(t.textMuted, 0.75) }),
          ])
        );
      }

      if (this.errorMsg) {
        out.push(
          padRow([
            span("  ⚠ ", { fg: BRAND_RED, bold: true }),
            span(this.errorMsg, { fg: BRAND_RED, bold: true }),
          ])
        );
      }
    }

    // 8. Bottom border
    out.push(renderModalBottomBorder("Enter Fetch Models · Esc Back to Providers", innerW, margin, borderCol));

    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. RENDER FETCHING (Live Model Curl In Progress)
  // ─────────────────────────────────────────────────────────────────────────
  private renderFetching(termWidth: number): RenderLine[] {
    const p = this.selectedProvider!;
    const t = currentTheme();
    const boxW = Math.max(64, Math.min(84, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const borderCol = t.primary || BRAND_BLUE;
    const out: RenderLine[] = [];

    const padRow = (contentSpans: StyledSpan[], rowBg = t.backgroundElement): RenderLine => {
      const used = contentSpans.reduce((acc, s) => acc + visualWidth(s.text), 0);
      const pad = Math.max(0, innerW - used);
      return line(
        span(margin),
        span("│", { fg: borderCol }),
        ...contentSpans,
        span(" ".repeat(pad), { bg: rowBg }),
        span("│", { fg: borderCol })
      );
    };

    out.push(renderModalTopBorder(`Curling ${p.name}`, innerW, margin, borderCol));
    out.push(
      padRow([
        span("  ⚡ ", { fg: BRAND_LEMON }),
        span(`Contacting ${p.name}...`, { fg: "#FFFFFF", bold: true }),
      ])
    );
    out.push(
      padRow([
        span("  GET ", { fg: BRAND_GREEN, bold: true }),
        span(`${p.baseURL}/models`, { fg: tint(t.text, 0.9) }),
      ])
    );
    out.push(
      padRow([
        span("  Discovering available models and prioritizing free & coding models...", {
          fg: tint(t.textMuted, 0.8),
        }),
      ])
    );
    out.push(renderModalBottomBorder("Fetching Models... · Esc Cancel", innerW, margin, borderCol));

    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. RENDER MODEL SELECTION VIEW (Free & Coding Models Prioritized)
  // ─────────────────────────────────────────────────────────────────────────
  private renderModelSelect(termWidth: number): RenderLine[] {
    const p = this.selectedProvider!;
    const t = currentTheme();
    const boxW = Math.max(64, Math.min(84, termWidth - 4));
    const innerW = boxW - 2;
    const leftM = Math.max(2, Math.floor((termWidth - boxW) / 2));
    const margin = " ".repeat(leftM);
    const borderCol = t.primary || BRAND_BLUE;
    const out: RenderLine[] = [];

    // 1. Top border
    out.push(renderModalTopBorder(`Select Model: ${p.name}`, innerW, margin, borderCol));

    // 2. Search row
    const searchLbl = "  🔍 Model Filter: ";
    const cursorStr = this.modelQuery + "▌";
    const freeCount = this.discoveredModels.filter((m) => m.isFree).length;
    const searchHint = `(${freeCount} Free on top · Enter Apply · Esc Back)  `;
    const usedSearch = visualWidth(searchLbl) + visualWidth(cursorStr) + visualWidth(searchHint);
    const searchPad = Math.max(0, innerW - usedSearch);
    out.push(
      line(
        span(margin),
        span("│", { fg: borderCol }),
        span(searchLbl, { fg: borderCol, bg: t.backgroundElement }),
        span(cursorStr, { fg: "#F3F4F6", bg: t.backgroundElement }),
        span(" ".repeat(searchPad), { bg: t.backgroundElement }),
        span(searchHint, { fg: BRAND_LEMON, bg: t.backgroundElement }),
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

    // 4. Discovered Model Rows
    if (this.filteredModels.length === 0) {
      const emptyMsg = "  No models matched your filter.";
      const pad = Math.max(0, innerW - visualWidth(emptyMsg));
      out.push(
        line(
          span(margin),
          span("│", { fg: borderCol }),
          span(emptyMsg, { fg: tint(t.textMuted, 0.7), bg: t.backgroundElement }),
          span(" ".repeat(pad), { bg: t.backgroundElement }),
          span("│", { fg: borderCol })
        )
      );
    } else {
      const visibleEnd = Math.min(this.modelScrollOff + this.modelMaxVisible, this.filteredModels.length);
      for (let i = this.modelScrollOff; i < visibleEnd; i++) {
        const item = this.filteredModels[i];
        const selected = i === this.modelCursor;
        const bg = selected ? t.backgroundMenu : t.backgroundElement;
        const pointer = selected ? "› " : "  ";

        // Badges: [FREE] / [LOCAL] / [PAID], plus [CODE]
        const freeBadge = item.badge === "LOCAL" ? "[LOCAL]" : item.isFree ? "[FREE]" : "[PRO]";
        const freeColor = item.isFree || item.badge === "LOCAL" ? BRAND_LEMON : BRAND_BLUE;

        const codeBadge = item.isCoding ? "[CODE]" : "";

        // Model ID column: fixed 30 chars
        let rawId = item.id.length > 29 ? item.id.slice(0, 28) + "…" : item.id;
        const idCol = rawId.padEnd(30);

        const badgesStr = `${freeBadge} ${codeBadge}`.trim().padEnd(14);

        // Space budget for description
        const fixedUsed = 2 + 30 + 14;
        const descW = Math.max(10, innerW - fixedUsed - 2);
        let descText = item.desc;
        if (visualWidth(descText) > descW) {
          descText = descText.slice(0, descW - 1) + "…";
        }
        const descCol = descText.padEnd(descW);

        const usedW = 2 + visualWidth(idCol) + visualWidth(badgesStr) + visualWidth(descCol);
        const pad = Math.max(0, innerW - usedW);

        out.push(
          line(
            span(margin),
            span("│", { fg: borderCol }),
            span(pointer, { fg: selected ? BRAND_LEMON : tint(t.textMuted, 0.5), bg, bold: selected }),
            span(idCol, { fg: selected ? "#FFFFFF" : tint(t.text, 0.95), bg, bold: selected }),
            span(`${freeBadge} `, { fg: freeColor, bg, bold: item.isFree }),
            ...(codeBadge ? [span(`${codeBadge} `, { fg: BRAND_GREEN, bg, bold: true })] : []),
            span(" ".repeat(Math.max(0, 14 - visualWidth(`${freeBadge} ${codeBadge}`.trim()))), { bg }),
            span(descCol, { fg: selected ? "#F3F4F6" : tint(t.textMuted, 0.75), bg }),
            span(" ".repeat(pad), { bg }),
            span("│", { fg: borderCol })
          )
        );
      }
    }

    // 5. Scroll info
    if (this.filteredModels.length > this.modelMaxVisible) {
      const shown = Math.min(this.modelScrollOff + this.modelMaxVisible, this.filteredModels.length);
      const scrollInfo = `  ${this.modelScrollOff + 1}–${shown} of ${this.filteredModels.length} models discovered  `;
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
    out.push(renderModalBottomBorder("↑↓ Select Model · Enter Confirm & Save · Esc Back", innerW, margin, borderCol));

    return out;
  }
}
