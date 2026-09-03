#!/usr/bin/env node

import { program } from "commander";
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
import { printXyroHead } from "./cli/banner-icon.js";
import { printBanner } from "./cli/banner.js";
import { loadPersistedConfig, savePersistedConfig } from "./config/persist.js";
import { initializeTools, getToolCount } from "./tools/registry.js";

let bannerPrinted = false;

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
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
  .parse(process.argv);

const opts = program.opts();

if (opts.v) {
  console.log(packageVersion());
  process.exit(0);
}

if (opts.json) {
  setJsonMode(true);
}

function formatApiError(err: unknown, provider: string, model: string): string {
  if (!(err instanceof OpenAI.APIError)) return "";
  const status = err.status;
  if (status === 401) {
    return (
      `Invalid API key for ${provider}.` +
      `\n  ${pc.dim("Generate a new key with --api-key or set OPENAI_API_KEY")}`
    );
  }
  if (status === 403) {
    return `Access denied by ${provider}. The model may be restricted or your key lacks access.`;
  }
  if (status === 429) {
    return (
      `Rate limited by ${provider}. Wait a moment and try again.` +
      `\n  ${pc.dim("Free tiers often have daily limits — check your provider dashboard")}`
    );
  }
  if (status === 404) {
    return (
      `Model "${model}" not found on ${provider}.` +
      `\n  ${pc.dim("Check available models or use a different provider")}`
    );
  }
  if (status && status >= 500) {
    return `${provider} server error (${status}). Try again in a moment.`;
  }
  return `${provider} API error${status ? ` (${status})` : ""}: ${err.message}`;
}

async function main(): Promise<void> {
  // Initialize built-in + plugin tools
  await initializeTools();

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

  if (
    !bannerPrinted &&
    opts.banner !== false &&
    !process.env["XYRO_NO_BANNER"] &&
    process.stdout.isTTY &&
    !opts.json
  ) {
    printXyroHead();
    printBanner();
    bannerPrinted = true;
  }

  if (!apiKey && opts.banner !== false && !opts.json) {
    const config = await interactiveSetup();
    apiKey = config.apiKey;
    model = config.model;
    baseURL = config.baseURL;
    provider = config.provider;
    savePersistedConfig({ provider, model, baseURL, apiKey });
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
      baseURL,
      apiKey,
      usage,
      persistConfig: (c) => savePersistedConfig({ provider: c.provider, model: c.model, baseURL: c.baseURL, apiKey: c.apiKey }),
    });

    if (cmdResult) {
      if (cmdResult.action === "exit") break;
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

main().catch((err) => {
  console.error(pc.red(`Fatal: ${err.message}`));
  process.exit(1);
});
