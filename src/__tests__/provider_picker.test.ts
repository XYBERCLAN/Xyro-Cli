import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderPicker } from "../tui/provider-picker.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { DEFAULT_MODELS } from "../models/catalog.js";
import { createClient } from "../providers/llm.js";
import { saveProviderKey, getProviderKey, loadPersistedConfig } from "../config/persist.js";
import { getConfigDir } from "../config/platform.js";

function withTempConfigDir<T>(fn: () => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-401-test-"));
  const real = getConfigDir();
  // platform.ts caches nothing, but HOME/XDG must be redirected for getConfigDir()
  const oldHome = process.env.HOME;
  const oldXDG = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
  try {
    return fn();
  } finally {
    process.env.HOME = oldHome;
    process.env.XDG_CONFIG_HOME = oldXDG;
  }
}

describe("ProviderPicker TUI Overlay", () => {
  let picker: ProviderPicker;

  beforeEach(() => {
    picker = new ProviderPicker();
  });

  it("starts closed and opens to provider list", () => {
    assert.equal(picker.isOpen(), false);
    picker.open("Google AI Studio (USA)");
    assert.equal(picker.isOpen(), true);
  });

  it("renders rows when open and zero when closed", () => {
    picker.open("Google AI Studio (USA)");
    const rows = picker.render(120);
    assert.ok(rows.length > 5, "should render top border, search, rows, bottom border");

    picker.close();
    assert.equal(picker.render(120).length, 0, "should render nothing when closed");
  });

  it("Esc closes the picker in list mode", () => {
    let closed = false;
    picker.onClose(() => { closed = true; });

    picker.open("Google AI Studio (USA)");
    picker.handleKey("\u001b");

    assert.equal(picker.isOpen(), false);
    assert.equal(closed, true);
  });

  it("filters providers when typing and Ctrl+U clears", () => {
    picker.open("Google AI Studio (USA)");
    // Type "groq"
    "groq".split("").forEach((c) => picker.handleKey(c));

    const filtered = picker.render(120);
    assert.ok(filtered.length > 0, "filtered view should render");

    // Ctrl+U
    picker.handleKey(String.fromCharCode(21));
    const cleared = picker.render(120);
    assert.ok(cleared.length >= filtered.length, "cleared query should show all providers");
  });

  it("navigation stays in bounds", () => {
    picker.open("Google AI Studio (USA)");
    for (let i = 0; i < 30; i++) picker.handleKey("\u001b[A");
    for (let i = 0; i < 50; i++) picker.handleKey("\u001b[B");
    assert.equal(picker.isOpen(), true);
  });

  it("transitions to configure mode on Enter and returns to list on Esc", () => {
    picker.open("Groq (USA)");
    // Press Enter to configure selected provider
    picker.handleKey("\r");

    const confRows = picker.render(120);
    assert.ok(confRows.length > 0, "configure view should render");

    // Esc should return to list mode without closing picker
    picker.handleKey("\u001b");
    assert.equal(picker.isOpen(), true, "picker should still be open in list mode");
  });

  it("configures local provider without requiring API key", async () => {
    picker.open("Ollama (local)");
    // Filter to local
    "ollama".split("").forEach((c) => picker.handleKey(c));
    // Enter into configure mode
    picker.handleKey("\r");

    let selectedProv: any = null;
    let selectedKey = "";
    picker.onSelect((p, k) => {
      selectedProv = p;
      selectedKey = k;
    });

    // Enter in local mode triggers live model discovery
    picker.handleKey("\r");
    await picker.waitForDiscovery();

    // Now in model-select mode: pressing Enter commits the top model
    picker.handleKey("\r");

    assert.equal(picker.isOpen(), false);
    assert.ok(selectedProv !== null);
    assert.equal(selectedProv.id, "local");
    assert.equal(selectedKey, "ollama");
  });

  it("requires an API key for cloud provider if no existing key is saved", async () => {
    picker.open("Groq (USA)");
    picker.handleKey("\r"); // enter configure

    let selectedProv: any = null;
    picker.onSelect((p) => { selectedProv = p; });

    // Press Enter without typing a key
    picker.handleKey("\r");

    // Should NOT transition to discovery or close without an API key
    assert.equal(picker.isOpen(), true);
    assert.equal(selectedProv, null, "should not select without an API key");

    // Type a key and press Enter to trigger model discovery (provider stubbed: key accepted)
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }] }), { status: 200 })) as typeof fetch;
    try {
      "gsk_test123456789".split("").forEach((c) => picker.handleKey(c));
      picker.handleKey("\r");
      await picker.waitForDiscovery();
    } finally {
      globalThis.fetch = realFetch;
    }

    // In model-select mode: pressing Enter confirms top model and closes
    picker.handleKey("\r");

    assert.equal(picker.isOpen(), false);
    assert.ok(selectedProv !== null);
  });

  it("returns to the key screen with an error when the provider rejects the key", async () => {
    picker.open("Groq (USA)");
    picker.handleKey("\r"); // enter configure

    let selectedProv: any = null;
    picker.onSelect((p) => { selectedProv = p; });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    try {
      "gsk_dead_key".split("").forEach((c) => picker.handleKey(c));
      picker.handleKey("\r");
      await picker.waitForDiscovery();
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(picker.isOpen(), true, "picker stays open on the key screen");
    assert.equal(selectedProv, null, "a rejected key must not be accepted");
    const text = picker.render(100).map((r) => r.spans.map((s) => s.text).join("")).join("\n");
    assert.ok(text.includes("rejected that key (401)"), "shows why the key failed");
  });

  it("openForKey jumps to the key screen and uses the pending model once the key works", async () => {
    let chosen = "";
    picker.onSelect((_p, _k, model) => { chosen = model; });
    assert.ok(picker.openForKey("groq", { model: "qwen/qwen3-32b", reason: "Groq has no API key yet." }));
    const screen = picker.render(100).map((r) => r.spans.map((s) => s.text).join("")).join("\n");
    assert.ok(screen.includes("Groq has no API key yet."), "explains why it opened");

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "qwen/qwen3-32b" }] }), { status: 200 })) as typeof fetch;
    try {
      "gsk_good".split("").forEach((c) => picker.handleKey(c));
      picker.handleKey("\r");
      await picker.waitForDiscovery();
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(picker.isOpen(), false, "closes without showing the model list");
    assert.equal(chosen, "qwen/qwen3-32b");
  });

  it("FREE_PROVIDERS has at least 20 entries with necessary fields", () => {
    assert.ok(FREE_PROVIDERS.length >= 20);
    for (const p of FREE_PROVIDERS) {
      assert.ok(p.id, "provider missing id");
      assert.ok(p.name, "provider missing name");
      assert.ok(p.defaultModel, "provider missing defaultModel");
      assert.ok(p.baseURL, "provider missing baseURL");
    }
  });
});

describe("Cross-Provider 401 Prevention", () => {
  it("stores and retrieves API keys per provider", () => {
    withTempConfigDir(() => {
      saveProviderKey("openrouter", "sk-or-v1-key-abc");
      saveProviderKey("tokenrouter", "tr-key-xyz");

      assert.equal(getProviderKey("openrouter"), "sk-or-v1-key-abc");
      assert.equal(getProviderKey("tokenrouter"), "tr-key-xyz");
      assert.equal(getProviderKey("groq"), undefined, "groq was never configured");
    });
  });

  it("overwrites a provider key when re-configured", () => {
    withTempConfigDir(() => {
      saveProviderKey("openrouter", "old-key");
      saveProviderKey("openrouter", "new-key");
      assert.equal(getProviderKey("openrouter"), "new-key");
      // other providers untouched
      assert.equal(getProviderKey("tokenrouter"), undefined);
    });
  });

  it("persisted config keeps providerKeys across saves", () => {
    withTempConfigDir(() => {
      saveProviderKey("openrouter", "sk-or-key");
      const cfg = loadPersistedConfig();
      assert.equal(cfg.providerKeys?.["openrouter"], "sk-or-key");
    });
  });

  it("createClient never leaks OPENAI_API_KEY to non-OpenAI endpoints", () => {
    const savedEnv = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-openai-env-leak";

    try {
      // OpenRouter endpoint with no explicit key must NOT get the OpenAI env key
      const orClient = createClient("https://openrouter.ai/api/v1", undefined);
      assert.equal((orClient as any).apiKey, "", "foreign endpoint must not receive OPENAI_API_KEY");

      // Explicit key always wins
      const explicit = createClient("https://openrouter.ai/api/v1", "sk-or-explicit");
      assert.equal((explicit as any).apiKey, "sk-or-explicit");

      // OpenAI endpoint still falls back to env var
      const openai = createClient("https://api.openai.com/v1", undefined);
      assert.equal((openai as any).apiKey, "sk-openai-env-leak");

      // No baseURL = OpenAI direct
      const noBase = createClient(undefined, undefined);
      assert.equal((noBase as any).apiKey, "sk-openai-env-leak");
    } finally {
      if (savedEnv === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = savedEnv;
    }
  });

  it("model switch resolves the model's own provider key, not the active one", () => {
    withTempConfigDir(() => {
      // User is on OpenRouter, picks a TokenRouter model from the catalog
      saveProviderKey("openrouter", "sk-or-active-key");
      // (tokenrouter deliberately NOT configured)

      const model = DEFAULT_MODELS.find(
        (m) => m.id === "anthropic/claude-3.5-sonnet" && m.providerId === "tokenrouter"
      );
      assert.ok(model, "tokenrouter claude model must exist in catalog");

      // This is the logic entry.ts onModelChange now uses
      const key = getProviderKey(model.providerId) ?? (model.providerId === "local" ? "ollama" : "");
      assert.equal(key, "", "unconfigured provider must yield empty key, not OpenRouter's key");
    });
  });
});
