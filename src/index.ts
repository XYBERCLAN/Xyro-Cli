#!/usr/bin/env node

import { matchInstant } from "./agent/instant.js";
import { program } from "commander";
import { xyroVersion } from "./version.js";
import { connectMcpServers } from "./mcp/manager.js";
import pc from "picocolors";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent } from "./agent/loop.js";
import { handleCommand } from "./agent/commands.js";
import { UsageTracker } from "./agent/usage.js";
import { renderConfigBanner, renderInfo, renderError, setJsonMode } from "./ui/render.js";
import { interactiveSetup, askForInput, CANCEL, FREE_PROVIDERS } from "./ui/prompts.js";
import { loadPersistedConfig, savePersistedConfig, saveProviderKey, getProviderKey } from "./config/persist.js";
import { initializeTools, getToolCount } from "./tools/registry.js";

// Suppress punycode deprecation warning (from internal Node.js usage)
process.removeAllListeners("warning");
process.on("warning", (warn) => {
  if (warn.name === "DeprecationWarning" && warn.message.includes("punycode")) return;
  console.warn(warn.message);
});

function packageVersion(): string {
  return xyroVersion();
}

program
  .name("xyro")
  .description("XYRO — AI coding agent")
  .version(packageVersion(), "-V, --version", "output the version number")
  .option("-v", "output the version number (shorthand for --version)")
  .option("--api-key <key>", "API key")
  .option("-m, --model <model>", "LLM model")
  .option("--base-url <url>", "OpenAI-compatible base URL")
  .option("--provider <id>", "Provider ID (e.g. groq, openrouter, deepseek)")
  .option("--max-tool-calls <n>", "Max tool calls per turn", "25")
  .option("--resume", "Resume previous conversation", false)
  .option("--no-banner", "Skip interactive setup and banner")
  .option("--json", "JSON output mode (skips banner)", false)
  .option("--tui", "Full-screen XYRO interactive terminal interface", false)
  .parse(process.argv);

const opts = program.opts();

// commander exposes --base-url as opts.baseUrl (camelCase) — normalize
const baseURLArg = (opts.baseURL || opts.baseUrl) as string | undefined;

if (opts.v) {
  console.log(packageVersion());
  process.exit(0);
}

if (opts.json) {
  setJsonMode(true);
}

function formatApiError(err: unknown, provider: string, model: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status;

  if (status === 401 || msg.includes("401") || msg.toLowerCase().includes("invalid api key") || msg.toLowerCase().includes("unauthorized")) {
    return (
      `Invalid API key for ${provider}.` +
      `\n  ${pc.dim("Use /provider to reconfigure your key, or pass --api-key / set OPENAI_API_KEY")}`
    );
  }
  if (status === 403 || msg.includes("403") || msg.toLowerCase().includes("forbidden") || msg.toLowerCase().includes("access denied")) {
    return `Access denied by ${provider}. The model "${model}" may be restricted or your key lacks permissions.`;
  }
  if (
    status === 429 ||
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("quota") ||
    msg.toLowerCase().includes("resource has been exhausted") ||
    msg.toLowerCase().includes("resource_exhausted") ||
    msg.toLowerCase().includes("too many requests")
  ) {
    return (
      `Rate limit reached on ${provider} (${model}).` +
      `\n  ${pc.yellow("Tip:")} Use ${pc.cyan("/model")} to switch to a different model (e.g. gemini-2.0-flash, llama-3.3-70b)` +
      `\n  ${pc.dim("Or use /provider to switch provider (Google AI Studio, Groq, OpenRouter, GitHub Models)")}`
    );
  }
  if (status === 404 || msg.includes("404") || msg.toLowerCase().includes("not found")) {
    return (
      `Model "${model}" not found on ${provider}.` +
      `\n  ${pc.dim("Use /model to pick an available model for this provider")}`
    );
  }
  if ((status && status >= 500) || msg.includes("500") || msg.includes("502") || msg.includes("503")) {
    return `${provider} server error (${status || 500}). Try again in a moment.`;
  }
  if (msg.toLowerCase().includes("etimedout") || msg.toLowerCase().includes("connection error") || msg.toLowerCase().includes("fetch failed")) {
    return (
      `Network connection to ${provider} timed out or failed.` +
      `\n  ${pc.dim("Check your internet connection / VPN / proxy, or switch provider with /provider")}`
    );
  }
  return `${provider} error${status ? ` (${status})` : ""}: ${msg}`;
}

async function main(): Promise<void> {
  // Initialize built-in + plugin tools
  await initializeTools();
  // MCP servers connect in the background — never delays start-up
  void connectMcpServers();

  // Priority: CLI arg > env var > saved config > default
  const saved = loadPersistedConfig();

  let provider: string;
  let baseURL: string;
  let model: string;
  let apiKey: string;

  if (opts.provider) {
    const match = FREE_PROVIDERS.find((p) => p.id === opts.provider);
    if (!match) {
      console.error(pc.red(`\n  ✗ Unknown provider "${opts.provider}"`));
      console.error(pc.dim(`  Available: ${FREE_PROVIDERS.map((p) => p.id).join(", ")}`));
      process.exit(1);
    }
    provider = match.name;
    baseURL = opts.baseURL || match.baseURL;
    model = opts.model || match.defaultModel;
  } else if (opts.baseURL) {
    provider = new URL(opts.baseURL).hostname;
    baseURL = opts.baseURL;
    model = opts.model || process.env["WOLF_MODEL"] || saved.model || "gpt-4o";
  } else if (saved.provider) {
    provider = saved.provider;
    baseURL = saved.baseURL || "";
    const requestedModel = opts.model || process.env["WOLF_MODEL"] || "";
    const preset = FREE_PROVIDERS.find((p) => p.name === saved.provider);
    if (requestedModel) {
      model = requestedModel;
    } else if (preset && !preset.models.includes(saved.model || "")) {
      model = preset.defaultModel;
    } else {
      model = saved.model || "gpt-4o";
    }
  } else {
    provider = "OpenAI";
    baseURL = "";
    model = opts.model || process.env["WOLF_MODEL"] || "gpt-4o";
  }

  apiKey = opts.apiKey || process.env["OPENAI_API_KEY"] || saved.apiKey || "";

  if (!apiKey && opts.banner !== false && !opts.json) {
    const config = await interactiveSetup();
    apiKey = config.apiKey;
    model = config.model;
    baseURL = config.baseURL;
    provider = config.provider;
    savePersistedConfig({ provider, model, baseURL, apiKey });
    // Seed per-provider key store so future model switches reuse the right key
    const prov = FREE_PROVIDERS.find((p) => p.name === provider);
    if (prov) saveProviderKey(prov.id, apiKey);
  }

  if (!apiKey) {
    console.error(pc.red("\n  ✗ No API key provided"));
    console.error(pc.dim("  Pass --api-key, --provider, or set OPENAI_API_KEY"));
    process.exit(1);
  }

  const agent = new Agent({
    model,
    baseURL,
    apiKey,
    maxToolCalls: parseInt(opts.maxToolCalls, 10),
  });

  const usage = new UsageTracker();
  agent.onLLMResponse((usageData) => usage.track(usageData as { prompt_tokens?: number; completion_tokens?: number } | null));

  let currentModel = model;

  if (opts.resume) {
    const loaded = agent.load();
    renderInfo(loaded ? "Resumed previous conversation" : "No saved session found");
  }

  renderConfigBanner(model, provider);

  while (true) {
    const input = await askForInput();

    if (input === CANCEL) {
      console.log();
      agent.save();
      break;
    }

    const text = input as string;
    const trimmed = text.trim();

    if (!trimmed) continue;

    // Slash commands (and bare-word aliases) take priority
    const cmdResult = await handleCommand(trimmed, {
      agent,
      model: currentModel,
      setModel: (m) => {
        currentModel = m;
        agent.setModel(m);
      },
      provider,
      setProvider: (p) => { provider = p; },
      baseURL,
      setBaseURL: (u) => { baseURL = u; },
      apiKey,
      setApiKey: (k) => { apiKey = k; },
      usage,
      persistConfig: (c) => savePersistedConfig({ provider: c.provider, model: c.model, baseURL: c.baseURL, apiKey: c.apiKey }),
      keyForProvider: (pid) => getProviderKey(pid),
      saveProviderKey: (pid, k) => saveProviderKey(pid, k),
    });

    if (cmdResult) {
      if (cmdResult.action === "exit") break;
      continue;
    }

    const instant = matchInstant(trimmed);
    if (instant) {
      const result = await instant.run().catch((e: unknown) => `❌ ${e instanceof Error ? e.message : String(e)}`);
      console.log(`\n${pc.dim(`instant · ${instant.label} (no model call)`)}\n${result}\n`);
      agent.recordLocalExchange(trimmed, result);
      continue;
    }

    try {
      await agent.run(trimmed);
    } catch (err: unknown) {
      const formatted = formatApiError(err, provider, agent.getModel());
      if (formatted) {
        renderError(formatted);
      } else if (err instanceof Error) {
        renderError(err.message);
      } else {
        renderError(String(err));
      }
    }
  }
}

// TUI dispatch: full-screen XYRO terminal interface when interactive.
async function bootstrap(): Promise<void> {
  const wantTui =
    opts.tui || (process.stdin.isTTY && process.stdout.isTTY && !opts.json && opts.banner !== false);
  if (wantTui) {
    const { runTuiMode } = await import("./tui/entry.js");
    await runTuiMode({
      provider: opts.provider,
      model: opts.model,
      baseUrl: baseURLArg,
      apiKey: opts.apiKey,
      maxToolCalls: parseInt(opts.maxToolCalls, 10),
      resume: opts.resume,
    });
    return;
  }
  await main();
}

bootstrap().catch((err) => {
  console.error(pc.red(`Fatal: ${err.message}`));
  process.exit(1);
});
