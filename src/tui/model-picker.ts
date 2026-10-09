// XYRO model picker
//
//   Most used            your top models by number of uses
//   <Provider>           one block per provider, connected providers first,
//     model rows         free models first; big providers show 6 + "N more"
//
// Connected providers (saved key) are asked for their FULL live model list in
// the background (cached for a day). Tab switches All / Free, typing filters,
// Ctrl+R refreshes the live lists, Enter on "N more" expands a provider.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, visualWidth } from "./core.js";
import { modalFrame } from "./overlays.js";
import { spinnerGlyph } from "./components.js";
import { getAllModels, filterModelCatalog, ModelEntry } from "../models/catalog.js";
import { getMostUsedModels } from "../models/recents.js";
import {
  loadCachedModels,
  refreshConnectedProviders,
  providerLoadState,
  isConnected,
  canonicalProviderId,
  providerById,
} from "../models/live.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";

const BRAND_BLUE = "#38BDF8";
const BRAND_LEMON = "#C6F135";
const BRAND_AMBER = "#F59E0B";

/** Models shown per provider before the "N more" row. */
const COLLAPSED_LIMIT = 6;

type Row =
  | { kind: "heading"; title: string; note?: string }
  | { kind: "provider"; providerId: string; name: string; total: number; free: number }
  | { kind: "model"; model: ModelEntry; index: number; uses?: number }
  | { kind: "more"; providerId: string; hidden: number; index: number }
  | { kind: "gap" };

type Selectable = { type: "model"; model: ModelEntry } | { type: "more"; providerId: string };

export class ModelPicker {
  private visible = false;
  private query = "";
  private freeOnly = false;
  private expanded = new Set<string>();
  private rows: Row[] = [];
  private selectable: Selectable[] = [];
  private cursor = 0;
  private scrollOff = 0;
  private maxVisible = 16;

  /** Currently active model – marked "current" */
  private currentModel = "";
  private currentProviderId = "";

  private onSelectCb: ((id: string, baseURL?: string, providerId?: string) => void) | null = null;
  private onCloseCb: (() => void) | null = null;

  isOpen(): boolean { return this.visible; }

  onSelect(cb: (id: string, baseURL?: string, providerId?: string) => void): void { this.onSelectCb = cb; }
  onClose(cb: () => void): void { this.onCloseCb = cb; }

  open(currentModel: string, currentProviderId = ""): void {
    this.visible = true;
    this.currentModel = currentModel;
    this.currentProviderId = canonicalProviderId(currentProviderId);
    this.query = "";
    this.freeOnly = false;
    this.expanded.clear();
    loadCachedModels();
    this.rebuild();
    this.focusModel(currentModel);
    this.refresh(false);
  }

  close(): void { this.visible = false; }

  /** Ask connected providers for their live lists; rebuild as each answers. */
  private refresh(force: boolean): void {
    void refreshConnectedProviders({
      force,
      onUpdate: () => {
        if (this.visible) this.rebuild(true);
      },
    });
  }

  handleKey(key: string): boolean {
    if (!this.visible) return false;
    const cp = key.codePointAt(0) ?? 0;
    const n = this.selectable.length;

    if (key === "\u001b") {
      this.visible = false;
      this.onCloseCb?.();
      return true;
    }

    if (cp === 13) {
      const item = this.selectable[this.cursor];
      if (!item) return true;
      if (item.type === "more") {
        this.expanded.add(item.providerId);
        this.rebuild(true);
        return true;
      }
      this.visible = false;
      this.onSelectCb?.(item.model.id, item.model.baseURL, item.model.providerId);
      return true;
    }

    if (key === "\u001b[A" || cp === 16) {
      if (n) this.cursor = (this.cursor - 1 + n) % n;
      this.clampScroll();
      return true;
    }
    if (key === "\u001b[B" || cp === 14) {
      if (n) this.cursor = (this.cursor + 1) % n;
      this.clampScroll();
      return true;
    }

    // Tab: All ⇄ Free
    if (cp === 9) {
      this.freeOnly = !this.freeOnly;
      this.rebuild();
      return true;
    }

    // Ctrl+R: refresh live model lists
    if (cp === 18) {
      this.refresh(true);
      return true;
    }

    if (cp === 127 || cp === 8) {
      this.query = this.query.slice(0, -1);
      this.rebuild();
      return true;
    }
    if (cp === 21) {
      this.query = "";
      this.rebuild();
      return true;
    }
    if (cp >= 32 && !key.startsWith("\u001b")) {
      this.query += key;
      this.rebuild();
      return true;
    }
    return true;
  }

  // ── list construction ──────────────────────────────────────────────────────

  private rebuild(keepSelection = false): void {
    const prev = keepSelection ? this.selectable[this.cursor] : undefined;
    let models = filterModelCatalog(this.query, getAllModels());
    if (this.freeOnly) models = models.filter((m) => m.isFree || m.badge === "LOCAL");

    const rows: Row[] = [];
    const selectable: Selectable[] = [];
    const addModel = (m: ModelEntry, uses?: number) => {
      rows.push({ kind: "model", model: m, index: selectable.length, uses });
      selectable.push({ type: "model", model: m });
    };

    // 1. Most used (only on the unfiltered view)
    if (!this.query) {
      const all = getAllModels();
      const used = getMostUsedModels(5)
        .map((u) => ({
          u,
          m:
            all.find((m) => m.id === u.id && (!u.providerId || canonicalProviderId(m.providerId) === canonicalProviderId(u.providerId))) ??
            all.find((m) => m.id === u.id),
        }))
        .filter((x): x is { u: (typeof x)["u"]; m: ModelEntry } => Boolean(x.m))
        .filter((x) => !this.freeOnly || x.m.isFree || x.m.badge === "LOCAL");
      if (used.length) {
        rows.push({ kind: "heading", title: "Most used" });
        for (const { u, m } of used) addModel(m, u.count);
        rows.push({ kind: "gap" });
      }
    }

    // 2. One block per provider
    const byProvider = new Map<string, ModelEntry[]>();
    for (const m of models) {
      const pid = canonicalProviderId(m.providerId);
      if (!byProvider.has(pid)) byProvider.set(pid, []);
      byProvider.get(pid)!.push(m);
    }
    const order = (pid: string) => {
      if (pid === this.currentProviderId) return 0;
      if (isConnected(pid)) return 1;
      const i = FREE_PROVIDERS.findIndex((p) => p.id === pid);
      return 2 + (i < 0 ? 999 : i) / 1000;
    };
    const providers = [...byProvider.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

    providers.forEach((pid, pi) => {
      const list = byProvider.get(pid)!.sort(
        (a, b) => Number(b.isFree || b.badge === "LOCAL") - Number(a.isFree || a.badge === "LOCAL") || a.id.localeCompare(b.id)
      );
      const name = providerById(pid)?.name ?? list[0].provider;
      if (pi > 0) rows.push({ kind: "gap" });
      rows.push({ kind: "provider", providerId: pid, name, total: list.length, free: list.filter((m) => m.isFree || m.badge === "LOCAL").length });
      const showAll = Boolean(this.query) || this.expanded.has(pid) || list.length <= COLLAPSED_LIMIT + 1;
      const shown = showAll ? list : list.slice(0, COLLAPSED_LIMIT);
      for (const m of shown) addModel(m);
      if (!showAll) {
        rows.push({ kind: "more", providerId: pid, hidden: list.length - shown.length, index: selectable.length });
        selectable.push({ type: "more", providerId: pid });
      }
    });

    this.rows = rows;
    this.selectable = selectable;

    // Keep the cursor on the same item across live refreshes
    let idx = -1;
    if (prev?.type === "model") idx = selectable.findIndex((s) => s.type === "model" && s.model.id === prev.model.id && s.model.providerId === prev.model.providerId);
    if (prev?.type === "more") idx = selectable.findIndex((s) => s.type === "model" && canonicalProviderId(s.model.providerId) === prev.providerId) + COLLAPSED_LIMIT;
    this.cursor = idx >= 0 && idx < selectable.length ? idx : 0;
    if (!keepSelection) this.scrollOff = 0;
    this.clampScroll();
  }

  private focusModel(id: string): void {
    const idx = this.selectable.findIndex((s) => s.type === "model" && s.model.id === id);
    if (idx >= 0) this.cursor = idx;
    this.scrollOff = Math.max(0, this.rowOf(this.cursor) - Math.floor(this.maxVisible / 2));
    this.clampScroll();
  }

  private rowOf(n: number): number {
    const i = this.rows.findIndex((r) => (r.kind === "model" || r.kind === "more") && r.index === n);
    return i < 0 ? 0 : i;
  }

  private clampScroll(): void {
    const row = this.rowOf(this.cursor);
    if (row < this.scrollOff) this.scrollOff = Math.max(0, row - 1);
    else if (row >= this.scrollOff + this.maxVisible) this.scrollOff = row - this.maxVisible + 1;
    this.scrollOff = Math.max(0, Math.min(this.scrollOff, Math.max(0, this.rows.length - this.maxVisible)));
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  render(termWidth: number): RenderLine[] {
    if (!this.visible) return [];
    const t = currentTheme();
    const boxW = Math.max(60, Math.min(96, termWidth - 6));
    const innerW = boxW - 2;
    const muted = tint(t.textMuted, 0.9);
    const tick = Math.floor(Date.now() / 80);
    const fit = (s: string, w: number) => (visualWidth(s) > w ? s.slice(0, Math.max(1, w - 1)) + "…" : s + " ".repeat(w - visualWidth(s)));
    const body: (StyledSpan[] | { spans: StyledSpan[]; bg: string })[] = [];

    // Search + All / Free switch
    const seg = (label: string, on: boolean) =>
      span(` ${label} `, on ? { fg: t.background, bg: BRAND_LEMON, bold: true } : { fg: muted, bg: t.backgroundElement });
    const search: StyledSpan[] = [
      span("  ❯ ", { fg: BRAND_LEMON, bold: true }),
      ...(this.query ? [span(this.query, { fg: t.text, bold: true })] : [span("search models or providers", { fg: tint(t.textMuted, 0.6), italic: true })]),
      span("▌", { fg: BRAND_LEMON }),
    ];
    const used = search.reduce((w, s) => w + visualWidth(s.text), 0);
    body.push([...search, span(" ".repeat(Math.max(1, innerW - used - 14))), seg("All", !this.freeOnly), seg("Free", this.freeOnly)]);
    body.push([span("  " + "─".repeat(innerW - 4), { fg: tint(t.border, 0.6) })]);

    if (this.selectable.length === 0) {
      body.push([span("  No model matches ", { fg: muted }), span(`"${this.query}"`, { fg: t.text })]);
      if (this.freeOnly) body.push([span("  Press tab to include paid models.", { fg: tint(t.textMuted, 0.7) })]);
    } else {
      const end = Math.min(this.scrollOff + this.maxVisible, this.rows.length);
      for (let i = this.scrollOff; i < end; i++) {
        const row = this.rows[i];
        if (row.kind === "gap") {
          body.push([]);
          continue;
        }
        if (row.kind === "heading") {
          body.push([span("  " + row.title, { fg: BRAND_LEMON, bold: true })]);
          continue;
        }
        if (row.kind === "provider") {
          const st = providerLoadState(row.providerId);
          const connected = isConnected(row.providerId);
          const status: StyledSpan =
            st === "loading"
              ? span(`${spinnerGlyph(tick)} loading models`, { fg: BRAND_BLUE })
              : st === "rejected"
                ? span("key rejected", { fg: t.error })
                : row.providerId === "local"
                  ? span("on this machine", { fg: t.success })
                  : connected
                    ? span("connected", { fg: t.success })
                    : span("needs a key", { fg: tint(t.textMuted, 0.75) });
          const counts = `${row.total} model${row.total === 1 ? "" : "s"}${row.free ? ` · ${row.free} free` : ""}`;
          const left = [span("  " + row.name, { fg: t.text, bold: true }), span("   "), status];
          const lw = left.reduce((w, s) => w + visualWidth(s.text), 0);
          body.push([...left, span(" ".repeat(Math.max(1, innerW - lw - counts.length - 2))), span(counts, { fg: tint(t.textMuted, 0.7) })]);
          continue;
        }
        const selected = row.index === this.cursor;
        const bg = selected ? t.backgroundMenu : t.backgroundPanel;
        const bar = span(selected ? " ▌ " : "   ", { fg: BRAND_LEMON, bold: true });
        if (row.kind === "more") {
          body.push({ spans: [bar, span(`+ ${row.hidden} more`, { fg: selected ? t.text : BRAND_BLUE, bold: selected }), span("   enter to show all", { fg: tint(t.textMuted, 0.6) })], bg });
          continue;
        }
        const m = row.model;
        const current = m.id === this.currentModel && (!this.currentProviderId || canonicalProviderId(m.providerId) === this.currentProviderId);
        const tier = m.badge === "LOCAL" ? ["local", BRAND_LEMON] : m.isFree ? ["free", t.success] : ["paid", BRAND_AMBER];
        const idW = Math.min(36, Math.max(22, Math.floor(innerW * 0.4)));
        const extra = row.uses !== undefined ? `${providerById(m.providerId)?.name ?? m.provider}` : m.desc;
        const tail = current ? " current" : row.uses !== undefined ? ` ${row.uses}×` : "";
        const descW = Math.max(6, innerW - 3 - idW - 6 - tail.length - 1);
        body.push({
          spans: [
            bar,
            span(fit(m.id, idW - 1) + " ", { fg: selected || current ? t.text : tint(t.text, 0.88), bold: selected || current }),
            span(fit(tier[0], 6), { fg: tier[1] }),
            span(fit(extra, descW), { fg: selected ? tint(t.text, 0.85) : tint(t.textMuted, 0.8) }),
            span(tail, { fg: current ? BRAND_BLUE : tint(t.textMuted, 0.7), bold: current }),
          ],
          bg,
        });
      }
      if (this.rows.length > this.maxVisible) {
        const models = this.selectable.filter((s) => s.type === "model").length;
        body.push([]);
        body.push([span(`  ${models} models shown · ${this.freeOnly ? "free only" : "all tiers"}`, { fg: tint(t.textMuted, 0.6) })]);
      }
    }
    return modalFrame("Model", boxW, body, "↑↓ move · enter select · tab all/free · ctrl+r refresh · esc close");
  }
}
