// TUI-mode entry: config resolution + full-screen XYRO terminal interface.

import pc from "picocolors";
import OpenAI from "openai";
import { Agent, AgentOutput } from "../agent/loop.js";
import { handleCommand } from "../agent/commands.js";
import { UsageTracker } from "../agent/usage.js";
import { setJsonMode } from "../ui/render.js";
import { loadPersistedTheme } from "../ui/theme.js";
import { TuiApp } from "./app.js";
import { interactiveSetup, FREE_PROVIDERS } from "../ui/prompts.js";
import { loadPersistedConfig, savePersistedConfig, saveProviderKey, getProviderKey } from "../config/persist.js";
import { DEFAULT_MODELS } from "../models/catalog.js";
import { recordRecentModel } from "../models/recents.js";

export async function runTuiMode(opts: {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  maxToolCalls: number;
  resume: boolean;
}): Promise<void> {
  setJsonMode(false);
  loadPersistedTheme();

  const saved = loadPersistedConfig();
  let provider: string;
  let baseURL: string;
  let model: string;
  let apiKey: string;

  if (opts.provider) {
    const match = FREE_PROVIDERS.find((p: { id: string }) => p.id === opts.provider);
    if (!match) {
      console.error(pc.red(`Unknown provider "${opts.provider}"`));
      process.exit(1);
    }
    provider = match.name;
    baseURL = opts.baseUrl || match.baseURL;
    model = opts.model || match.defaultModel;
  } else if (opts.baseUrl) {
    provider = new URL(opts.baseUrl).hostname;
    baseURL = opts.baseUrl;
    model = opts.model || saved.model || "gpt-4o";
  } else if (saved.provider) {
    provider = saved.provider;
    baseURL = saved.baseURL || "";
    model = opts.model || saved.model || "gpt-4o";
  } else {
    provider = "OpenAI";
    baseURL = "";
    model = opts.model || "gpt-4o";
  }

  apiKey = opts.apiKey || process.env["OPENAI_API_KEY"] || saved.apiKey || "";

  if (!apiKey) {
    if (!process.stdin.isTTY) {
      console.error(pc.red("No API key provided. Pass --api-key or set OPENAI_API_KEY"));
      process.exit(1);
    }
    const config = await interactiveSetup();
    apiKey = config.apiKey;
    model = config.model;
    baseURL = config.baseURL;
    provider = config.provider;
    savePersistedConfig({ provider, model, baseURL, apiKey });
    // Seed per-provider key store so future model switches reuse the right key
    const prov = FREE_PROVIDERS.find((p) => p.name === provider);
    if (prov) saveProviderKey(prov.id, apiKey);
  } else if (saved.provider) {
    // Migrate legacy single-key config into the per-provider store
    const prov = FREE_PROVIDERS.find(
      (p) => p.name === saved.provider || p.baseURL === saved.baseURL
    );
    if (prov && !getProviderKey(prov.id)) {
      saveProviderKey(prov.id, apiKey);
    }
  }

  const agent = new Agent({ model, baseURL, apiKey, maxToolCalls: opts.maxToolCalls });
  const usage = new UsageTracker();
  agent.onLLMResponse((u) => usage.track(u as { prompt_tokens?: number; completion_tokens?: number } | null));

  if (opts.resume) agent.load();

  const tui = new TuiApp();
  tui.setMeta(model, provider);
  tui.setApiKey(apiKey);
  recordRecentModel(model);

  const output: AgentOutput = {
    onAssistantText: (content) => tui.addAssistantText(content),
    onAssistantDone: (dur) => tui.addAssistantFooter(dur),
    onToolStart: (name, summary) => tui.addToolRunning(name, summary),
    onToolResult: (name, summary, elapsed, failed) => tui.addToolDone(name, summary, elapsed, failed),
  };
  agent.setOutputAdapter(output);

  let currentModel = model;

  tui.onSubmit(async (text) => {
    tui.addUserMessage(text);
    tui.setBusy(true);
    const cmdResult = await handleCommand(text, {
      agent,
      model: currentModel,
      setModel: (m) => {
        currentModel = m;
        agent.setModel(m);
        tui.setMeta(m, provider);
      },
      provider,
      setProvider: (p) => {
        provider = p;
        tui.setMeta(currentModel, p);
      },
      baseURL,
      setBaseURL: (u) => {
        baseURL = u;
      },
      apiKey,
      setApiKey: (k) => {
        apiKey = k;
      },
      usage,
      persistConfig: (c) => savePersistedConfig({ provider: c.provider, model: c.model, baseURL: c.baseURL, apiKey: c.apiKey }),
      keyForProvider: (pid) => getProviderKey(pid),
      saveProviderKey: (pid, k) => saveProviderKey(pid, k),
    });
    if (cmdResult) {
      if (cmdResult.action === "exit") {
        agent.save();
        tui.stop();
        process.exit(0);
      }
      if (cmdResult.action === "agent" && cmdResult.prompt) {
        await runTurn(tui, agent, provider, cmdResult.prompt, cmdResult.systemPrompt, cmdResult.model);
        return;
      }
      syncStats();
      tui.setBusy(false);
      return;
    }
    await runTurn(tui, agent, provider, text);
    syncStats();
  });

  tui.onModelChange((newModel, newBaseUrl) => {
    currentModel = newModel;
    agent.setModel(newModel);
    const found = DEFAULT_MODELS.find(
      (m) => m.id === newModel && (!newBaseUrl || m.baseURL === newBaseUrl)
    );
    if (found) {
      provider = found.provider;
      // Only switch endpoint/key when the model belongs to a different provider
      const targetBase = newBaseUrl || found.baseURL || baseURL;
      if (targetBase && targetBase !== baseURL) {
        baseURL = targetBase;
        const key = getProviderKey(found.providerId) ?? (found.providerId === "local" ? "ollama" : apiKey);
        apiKey = key;
        agent.updateClient(baseURL, apiKey);
      }
    }
    recordRecentModel(newModel);
    tui.setMeta(newModel, provider);
    savePersistedConfig({ provider, model: newModel, baseURL, apiKey });
    tui.addAssistantText(`✓ Active model switched to **${newModel}** (${provider})`);
    syncStats();
  });

  tui.onAgentModeChange((mode) => {
    tui.addAssistantText(`✓ Switched agent persona to **${mode.name}** mode: *${mode.desc}*`);
  });

  tui.onThemeChange((themeId) => {
    savePersistedConfig({ provider, model: currentModel, baseURL, apiKey });
    tui.addAssistantText(`✓ Theme applied: **${themeId}** — scanner colors will update immediately.`);
  });

  tui.onProviderChange((prov, newApiKey, newModel, newBaseUrl) => {
    provider = prov.name;
    model = newModel;
    currentModel = newModel;
    baseURL = newBaseUrl;
    if (newApiKey) {
      apiKey = newApiKey;
      // Remember this key for the provider → future model switches reuse it
      saveProviderKey(prov.id, newApiKey);
    }
    agent.updateClient(newBaseUrl, apiKey);
    agent.setModel(newModel);
    recordRecentModel(newModel);
    tui.setMeta(newModel, provider);
    tui.setApiKey(apiKey);
    savePersistedConfig({ provider, model: newModel, baseURL, apiKey });
    tui.addAssistantText(`✓ Configured provider: **${prov.name}** with model **${newModel}**`);
    syncStats();
  });

  const syncStats = () => {
    const snap = usage.snapshot(currentModel);
    const cost = usage.estimatedCost(currentModel);
    tui.setStats({
      prompt: snap.promptTokens,
      completion: snap.completionTokens,
      total: snap.totalTokens,
      cost: `$${cost.toFixed(4)}`,
    });
  };

  tui.onExit(() => {
    agent.save();
    tui.stop();
    process.exit(0);
  });

  tui.start();
}

async function runTurn(
  tui: TuiApp,
  agent: Agent,
  provider: string,
  prompt: string,
  systemPrompt?: string,
  modelOverride?: string
): Promise<void> {
  try {
    const prev = agent.getModel();
    if (modelOverride && modelOverride !== prev) agent.setModel(modelOverride);
    if (systemPrompt) {
      // /btw-style isolated runs are handled by commands; here it's a normal run
      await agent.run(prompt);
    } else {
      await agent.run(prompt);
    }
    if (modelOverride && modelOverride !== prev) agent.setModel(prev);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const msg = e.status
      ? `${provider} API error (${e.status}): ${e.message ?? ""}`
      : err instanceof Error
        ? err.message
        : String(err);
    tui.addError(msg);
  } finally {
    tui.setBusy(false);
  }
}

void OpenAI;
