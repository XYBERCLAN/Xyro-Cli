// TUI-mode entry: config resolution + full-screen XYRO terminal interface.

import pc from "picocolors";
import OpenAI from "openai";
import { Agent, AgentOutput } from "../agent/loop.js";
import { handleCommand } from "../agent/commands.js";
import { UsageTracker } from "../agent/usage.js";
import { setJsonMode } from "../ui/render.js";
import { loadPersistedTheme } from "../ui/theme.js";
import { onTodosChanged, setPlanApprover, onAgentActivity, setToolApprover } from "../agent/ui-bridge.js";
import { setExpertSession } from "../agents/runtime.js";
import { beginCheckpoint, listCheckpoints, rewindTo } from "../agent/checkpoints.js";
import { scanFiles } from "../agents/sentinel.js";
import { clearNotes } from "../agents/team-board.js";
import { listIntents, runIntents, removeIntent, trustIntents, intentsTrust } from "../agent/intents.js";
import { matchInstant } from "../agent/instant.js";
import { privacyStatus, setPrivacyEnabled } from "../providers/privacy.js";
import { runHooks, loadHooks, projectHooksStatus, trustProjectHooks, HOOK_EVENTS } from "../agent/hooks.js";
import { mcpStatus, onMcpChange, connectedServerCount, projectMcpTrust, trustProjectMcp, reloadMcpServers } from "../mcp/manager.js";
import { getAllModels } from "../models/catalog.js";
import { canonicalProviderId } from "../models/live.js";
import { recordModelUse } from "../models/recents.js";
import { checkForUpdate, performUpdate, installMethod, PACKAGE_NAME } from "../update/updater.js";
import { xyroVersion } from "../version.js";
import { setRetryReporter } from "../providers/llm.js";
import { TuiApp } from "./app.js";
import { interactiveSetup, FREE_PROVIDERS } from "../ui/prompts.js";
import { loadPersistedConfig, savePersistedConfig, saveProviderKey, getProviderKey } from "../config/persist.js";
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
    requestPermission: (label) => tui.askPermission(label),
    onNotice: (text, kind) => tui.addNotice(text, kind),
    onModelSwitched: (sw) => {
      const where = sw.crossProvider ? `${sw.toProvider} · ${sw.to}` : sw.to;
      tui.addNotice(`${sw.from}: ${sw.reason} — continuing on **${where}**`, "info");
    },
  };
  // Retry notices go into the chat instead of drawing over the screen
  setRetryReporter((msg) => tui.addNotice(msg, "info"));
  agent.setOutputAdapter(output);

  // Tools → UI: live task list and plan approval in the side panel
  onTodosChanged((todos) => tui.setTodos(todos));
  setPlanApprover((plan) => tui.requestPlan(plan));

  // Experts: live activity in the side panel, approvals through the same
  // pop-up as XYRO, and the session's current model / key
  onAgentActivity((a) => tui.setAgentActivity(a));
  setToolApprover((label) => tui.askPermission(label));
  setExpertSession(() => ({ baseURL, apiKey, model: currentModel }));

  let currentModel = model;

  // A dead or missing key (HTTP 401/403): open the key screen for the active provider
  const promptForKey = (status: number) => {
    const prov = FREE_PROVIDERS.find((p) => p.name === provider || p.baseURL === baseURL);
    if (prov && prov.id !== "local") {
      tui.requestProviderKey(prov.id, currentModel, `${prov.name} rejected your API key (${status}). Paste a new key to continue.`);
    }
  };

  tui.onSubmit(async (text) => {
    // Checkpoint before every real message (slash commands change nothing)
    if (!text.startsWith("/")) {
      clearNotes(); // fresh team board for each request
      const cp = beginCheckpoint(text, agent.historyLength());
      tui.markCheckpoint(cp.id);
    }
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
        await runTurn(tui, agent, provider, cmdResult.prompt, cmdResult.systemPrompt, cmdResult.model, promptForKey);
        return;
      }
      syncStats();
      tui.setBusy(false);
      return;
    }
    // UserPromptSubmit reflex: may block the message or add context to it
    const gate = await runHooks("UserPromptSubmit", { prompt: text });
    if (gate.blocked) {
      tui.addError(`Blocked by a hook: ${gate.reason}`);
      tui.setBusy(false);
      return;
    }
    // Zero-token fast path: run it here, no model round trip
    const instant = gate.output ? null : matchInstant(text);
    if (instant) {
      const started = Date.now();
      tui.addToolRunning(instant.tool, `instant · ${instant.label}`);
      let result: string;
      try {
        result = await instant.run();
      } catch (e) {
        result = `❌ ${e instanceof Error ? e.message : String(e)}`;
      }
      const failed = result.startsWith("❌");
      tui.addToolDone(instant.tool, result.split("\n")[0].slice(0, 70), ((Date.now() - started) / 1000).toFixed(1), failed);
      tui.addAssistantText("```\n" + result.slice(0, 6000) + (result.length > 6000 ? "\n…" : "") + "\n```");
      tui.addAssistantFooter((Date.now() - started) / 1000);
      agent.recordLocalExchange(text, result);
      syncStats();
      tui.setBusy(false);
      return;
    }
    const prompt = gate.output ? `${text}\n\n[context from hooks]\n${gate.output}` : text;
    await runTurn(tui, agent, provider, prompt, undefined, undefined, promptForKey);
    void runHooks("Stop", { prompt: text });

    // Sentinel patrol: scan what this turn changed for secrets & conflict markers
    const touched = [...(listCheckpoints()[0]?.files.keys() ?? [])];
    for (const f of scanFiles(touched).slice(0, 5)) {
      tui.addNotice(`sentinel: **${f.kind}** in ${f.file}:${f.line} — ${f.excerpt}`, "warn");
    }
    // Count a use of the active model (powers "Most used" in /model)
    const activeProv = FREE_PROVIDERS.find((p) => p.name === provider || p.baseURL === baseURL);
    recordModelUse(currentModel, activeProv?.id);
    syncStats();
  });

  tui.onModelChange((newModel, newBaseUrl, providerId) => {
    // Look in the whole catalog (built-in + live lists), matching the provider
    const all = getAllModels();
    const found =
      all.find((m) => m.id === newModel && providerId !== undefined && canonicalProviderId(m.providerId) === canonicalProviderId(providerId)) ??
      all.find((m) => m.id === newModel && (!newBaseUrl || m.baseURL === newBaseUrl));
    if (found) {
      // Only switch endpoint/key when the model belongs to a different provider
      const targetBase = newBaseUrl || found.baseURL || baseURL;
      if (targetBase && targetBase !== baseURL) {
        // Never reuse another provider's key: ask for this provider's key first
        const pid = canonicalProviderId(found.providerId);
        const key = getProviderKey(pid) ?? (pid === "local" ? "ollama" : undefined);
        if (!key) {
          tui.setMeta(currentModel, provider);
          tui.requestProviderKey(pid, newModel, `${found.provider} has no API key yet. Add one to start using ${newModel}.`);
          return;
        }
        baseURL = targetBase;
        apiKey = key;
        agent.updateClient(baseURL, apiKey);
      }
      provider = found.provider;
    }
    currentModel = newModel;
    agent.setModel(newModel);
    recordRecentModel(newModel);
    tui.setMeta(newModel, provider);
    savePersistedConfig({ provider, model: newModel, baseURL, apiKey });
    tui.addNotice(`Active model switched to **${newModel}** (${provider})`);
    syncStats();
  });

  tui.onAgentModeChange((mode) => {
    // "Plan" persona = read-only plan mode; any other persona can act
    agent.setPlanMode(mode.name.toLowerCase() === "plan");
    tui.addNotice(`Switched agent persona to **${mode.name}** mode: *${mode.desc}*`);
  });

  tui.onThemeChange((themeId) => {
    savePersistedConfig({ provider, model: currentModel, baseURL, apiKey });
    tui.addNotice(`Theme applied: **${themeId}** — scanner colors will update immediately.`);
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
    tui.addNotice(`Configured provider: **${prov.name}** with model **${newModel}**`);
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

  // ---- checkpoints: /rewind and Esc Esc ----
  tui.onRewindRequest(() => {
    const items = listCheckpoints().map((c) => ({ id: c.id, prompt: c.prompt, at: c.at, files: c.files.size }));
    tui.openRewind(items, (id) => {
      const cp = listCheckpoints().find((c) => c.id === id);
      const r = rewindTo(id);
      if (!r || !cp) return;
      agent.truncateHistory(r.historyLength);
      const parts = [`Rewound to before "${cp.prompt.slice(0, 50)}${cp.prompt.length > 50 ? "…" : ""}"`];
      if (r.restored.length) parts.push(`restored ${r.restored.length} file${r.restored.length === 1 ? "" : "s"}`);
      if (r.deleted.length) parts.push(`removed ${r.deleted.length} new file${r.deleted.length === 1 ? "" : "s"}`);
      if (r.failed.length) parts.push(`could not restore ${r.failed.join(", ")}`);
      tui.rewindTranscript(id, parts.join(" · "));
    });
  });

  // ---- hooks: /hooks, trust, session start ----
  const hooksView = () => {
    const active = loadHooks();
    return { projectStatus: projectHooksStatus(), events: HOOK_EVENTS.map((event) => ({ event, hooks: active[event] ?? [] })) };
  };
  const openHooks = () =>
    tui.openHooks(hooksView(), () => {
      trustProjectHooks();
      tui.setHomeNotice(null);
      openHooks();
    });
  tui.onHooksRequest(openHooks);

  // ---- intent guard: /intents [trust | remove <id>] ----
  tui.onIntentsRequest((arg) => {
    const [sub, id] = arg.split(/\s+/);
    if (sub === "trust") {
      tui.addNotice(trustIntents() ? "Intent checks trusted: their commands will run after changes" : "No .xyro/intents.json to trust", "info");
      return;
    }
    if (sub === "remove" && id) {
      tui.addNotice(removeIntent(id).replace(/^\S+\s/, ""), "info");
      return;
    }
    if (!listIntents().length) {
      tui.addNotice("No saved intents yet. Tell XYRO a lasting requirement (\"login must always…\") and it saves a check.", "info");
      return;
    }
    tui.addNotice("Checking saved intents…", "info");
    void runIntents().then((results) => {
      for (const r of results) {
        const state = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
        tui.addNotice(`${state} ${r.intent.id} · ${r.intent.said}${r.ok && !r.skipped ? "" : ` — ${r.detail.split("\n")[0].slice(0, 120)}`}`, r.ok ? (r.skipped ? "warn" : "success") : "warn");
      }
      if (intentsTrust() === "untrusted") tui.addNotice("This project's intent file changed outside XYRO. Review .xyro/intents.json, then /intents trust", "warn");
    });
  });

  // ---- privacy shield: /privacy [on | off] ----
  tui.onPrivacyRequest((arg) => {
    if (arg === "on" || arg === "off") {
      setPrivacyEnabled(arg === "on");
      tui.addNotice(arg === "on" ? "Privacy shield on: secrets and personal data are replaced before requests leave" : "Privacy shield off for this session", arg === "on" ? "success" : "warn");
      return;
    }
    const st = privacyStatus();
    const kinds = (Object.keys(st.distinct) as (keyof typeof st.distinct)[]).filter((k) => st.distinct[k] > 0);
    const held = kinds.length ? kinds.map((k) => `${st.distinct[k]} ${k.toLowerCase()}${st.distinct[k] === 1 ? "" : "s"}`).join(", ") : "nothing sensitive sent yet";
    tui.addNotice(`Privacy shield ${st.enabled ? "on" : "off"} · withheld this session: ${held} · audit log ${st.auditPath}`, st.enabled ? "info" : "warn");
  });

  // ---- MCP: live server status, /mcp, project trust ----
  const mcpView = () => ({
    servers: mcpStatus().map((st) => ({ name: st.name, source: st.source, state: st.state, tools: st.tools.length, error: st.error, expertsOnly: st.expertsOnly, transport: st.transport })),
    projectUntrusted: projectMcpTrust() === "untrusted",
  });
  onMcpChange(() => tui.setMcpCount(connectedServerCount()));
  tui.onMcpRequest(() =>
    tui.openMcp(mcpView, () => {
      trustProjectMcp();
      void reloadMcpServers();
    })
  );
  if (projectHooksStatus() === "untrusted") {
    tui.setHomeNotice({ label: "hooks", text: "This project defines hooks — review and enable them with /hooks" });
  }
  void runHooks("SessionStart");

  // ---- updates: background check + /update pop-up ----
  let latestKnown: string | null = null;
  tui.onUpdate(async (action) => {
    if (action === "check") {
      const info = await checkForUpdate({ force: true });
      if (!info) {
        tui.setUpdateState({ kind: "offline", current: xyroVersion() });
        return;
      }
      latestKnown = info.latest;
      tui.setUpdateInfo(info);
      const method = installMethod();
      tui.setUpdateState(
        info.updateAvailable
          ? {
              kind: "available",
              current: info.current,
              latest: info.latest,
              method: method === "npm-global" ? `npm install -g ${PACKAGE_NAME}@${info.latest}` : method === "npx" ? "npx (always latest)" : "source checkout (git pull)",
            }
          : { kind: "uptodate", current: info.current }
      );
      return;
    }
    const latest = latestKnown ?? undefined;
    tui.setUpdateState({ kind: "installing", current: xyroVersion(), latest: latest ?? "latest", startedAt: Date.now() });
    const result = await performUpdate(latest);
    tui.setUpdateState({ kind: "done", ok: result.ok, message: result.message });
    if (result.ok) tui.setUpdateInfo(null);
  });

  tui.start();

  // Quietly look for a newer release (cached 12h, 3s timeout, never blocks)
  void checkForUpdate().then((info) => {
    if (info?.updateAvailable) tui.setUpdateInfo(info);
  });
}

async function runTurn(
  tui: TuiApp,
  agent: Agent,
  provider: string,
  prompt: string,
  systemPrompt?: string,
  modelOverride?: string,
  onAuthError?: (status: number) => void
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
    if (e.status === 401 || e.status === 403) onAuthError?.(e.status);
  } finally {
    tui.setBusy(false);
  }
}

void OpenAI;
