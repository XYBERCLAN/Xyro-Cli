import * as fs from "node:fs";
import * as p from "@clack/prompts";
import { Agent } from "../agent/loop.js";
import { UsageTracker, formatUsage } from "../agent/usage.js";
import { summarizeHistory } from "../providers/llm.js";
import { FREE_PROVIDERS, interactiveSetup, Provider } from "../ui/prompts.js";
import { renderInfo, renderError, renderAssistant, isJsonMode } from "../ui/render.js";
import { getToolCount } from "../tools/registry.js";
import { DEFAULT_MODELS } from "../models/catalog.js";

export interface CommandContext {
  agent: Agent;
  model: string;
  setModel: (m: string) => void;
  provider: string;
  setProvider: (p: string) => void;
  baseURL: string;
  setBaseURL: (u: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  usage: UsageTracker;
  persistConfig: (c: { provider?: string; model?: string; baseURL?: string; apiKey?: string }) => void;
  /** Resolve the saved API key for a provider id (per-provider key store) */
  keyForProvider: (providerId: string) => string | undefined;
  /** Persist a provider id → API key mapping */
  saveProviderKey: (providerId: string, apiKey: string) => void;
}

export interface CommandResult {
  action: "continue" | "exit" | "agent";
  /** for action: "agent" — the prompt to run through the agent */
  prompt?: string;
  /** optional system prompt override for this run */
  systemPrompt?: string;
  /** optional model override for this run */
  model?: string;
}

const HELP_TEXT = `
Commands:
  /help              show this help
  /status            show model, provider, and session info
  /model [name]      pick model interactively, or switch directly by name
  /provider          reconfigure provider (interactive)
  /cost              show token usage and estimated cost
  /compact           summarize conversation to free context
  /history           show session message count and sizes
  /export [file]     export conversation to markdown (default xyro-session.md)
  /save              save conversation history
  /resume            reload last saved session
  /clear             reset conversation history
  /init              scaffold an AGENTS.md project context file
  /learn             save this session's lessons to XYRO.md (project memory)
  /workflow <name> <goal>   run a team workflow (feature, bugfix, review, …)
  /exit              save and quit
Bare words also work: help, status, model, cost, compact, history, export, save, resume, clear, exit, quit
`.trim();

const ALIASES: Record<string, string> = {
  help: "/help", status: "/status", model: "/model", provider: "/provider",
  cost: "/cost", compact: "/compact", history: "/history", export: "/export",
  save: "/save", resume: "/resume", clear: "/clear", init: "/init", quit: "/exit", exit: "/exit",
};

function isCommand(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("/")) return trimmed;
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  const mapped = ALIASES[first];
  if (!mapped) return null;
  const rest = trimmed.slice(first.length).trim();
  return rest ? `${mapped} ${rest}` : mapped;
}

function writeAgentsMd(): string {
  const path = "AGENTS.md";
  if (fs.existsSync(path)) return `${path} already exists — not overwriting`;
  const content = `# Project Context

## Overview
Describe what this project does.

## Structure
- \`src/\` — source code

## Conventions
- TypeScript, ES modules
- Keep changes minimal and focused
`;
  fs.writeFileSync(path, content, "utf-8");
  return `Created ${path} — edit it to teach XYRO about this project`;
}

export async function handleCommand(
  rawInput: string,
  ctx: CommandContext
): Promise<CommandResult | null> {
  const cmd = isCommand(rawInput);
  if (!cmd) return null;

  const [name, ...rest] = cmd.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  const { agent, usage, model } = ctx;

  switch (name) {
    case "help":
      renderAssistant(HELP_TEXT);
      return { action: "continue" };

    case "status": {
      const msgs = agent.getHistory();
      const toolCalls = msgs.filter((m) => m.role === "tool").length;
      const toolInfo = getToolCount();
      const lines = [
        `model: ${ctx.model}`,
        `provider: ${ctx.provider}`,
        `cwd: ${process.cwd()}`,
        `messages: ${msgs.length} (incl. ${toolCalls} tool results)`,
        `tools: ${toolInfo.total} (${toolInfo.builtin} built-in + ${toolInfo.plugins} plugin)` ,
        `max tool calls: ${agent.getMaxToolCalls()}`,
      ];
      renderAssistant(lines.join("\n"));
      return { action: "continue" };
    }

    case "model": {
      if (arg) {
        const found = DEFAULT_MODELS.find((m) => m.id === arg);
        ctx.setModel(arg);
        if (found) {
          ctx.setProvider(found.provider);
          if (found.baseURL) ctx.setBaseURL(found.baseURL);
          // Swap to the target provider's saved key — never send another
          // provider's key to this endpoint (401 "User not found").
          const key = ctx.keyForProvider(found.providerId) ?? (found.providerId === "local" ? "ollama" : "");
          if (key) ctx.setApiKey(key);
          ctx.agent.updateClient(found.baseURL || ctx.baseURL, key);
          ctx.persistConfig({ model: arg, provider: found.provider, baseURL: found.baseURL, apiKey: key });
        } else {
          ctx.persistConfig({ model: arg });
        }
        renderInfo(`Model switched to ${arg}`);
        return { action: "continue" };
      }

      // Interactive model picker with full provider & Free/Paid details
      const current = ctx.model;

      if (isJsonMode()) {
        const list = DEFAULT_MODELS.map(
          (m) => `• ${m.id} (${m.provider}) [${m.badge}] - ${m.desc}`
        ).join("\n");
        renderAssistant(
          `Current model: ${current}\n\nAvailable Models:\n${list}\n\nSwitch with: /model <name>`
        );
        return { action: "continue" };
      }

      const options = DEFAULT_MODELS.map((m) => {
        const isCur = m.id === current;
        return {
          value: m.id,
          label: `${m.name.padEnd(26)} · ${m.provider}`,
          hint: `[${m.badge}] ${isCur ? "● CURRENT" : m.desc}`,
        };
      });

      options.push({
        value: "__custom__",
        label: "Enter a custom model name…",
        hint: "Manual model identifier",
      });

      const choice = await p.select({
        message: `Select model — current: ${current}`,
        options,
      });

      if (p.isCancel(choice)) {
        renderInfo("Model switch cancelled");
        return { action: "continue" };
      }

      let newModel: string;
      if (choice === "__custom__") {
        const typed = await p.text({
          message: "Model name",
          placeholder: "e.g. gpt-4o-mini",
        });
        if (p.isCancel(typed) || !typed || !(typed as string).trim()) {
          renderInfo("Model switch cancelled");
          return { action: "continue" };
        }
        newModel = (typed as string).trim();
      } else {
        newModel = choice as string;
      }

      const found = DEFAULT_MODELS.find((m) => m.id === newModel);
      ctx.setModel(newModel);
      if (found) {
        ctx.setProvider(found.provider);
        if (found.baseURL) ctx.setBaseURL(found.baseURL);
        // Swap to the target provider's saved key (prevents cross-provider 401s)
        const key = ctx.keyForProvider(found.providerId) ?? (found.providerId === "local" ? "ollama" : "");
        if (key) ctx.setApiKey(key);
        ctx.agent.updateClient(found.baseURL || ctx.baseURL, key);
        ctx.persistConfig({ model: newModel, provider: found.provider, baseURL: found.baseURL, apiKey: key });
      } else {
        ctx.persistConfig({ model: newModel });
      }
      renderInfo(`Model switched to ${newModel}${found ? ` (${found.provider})` : ""}`);
      return { action: "continue" };
    }

    case "provider": {
      const target = arg.toLowerCase();
      if (target) {
        const found = FREE_PROVIDERS.find(
          (p) => p.id.toLowerCase() === target || p.name.toLowerCase().includes(target)
        );
        if (found) {
          ctx.setProvider(found.name);
          ctx.setBaseURL(found.baseURL);
          ctx.setModel(found.defaultModel);
          // Use this provider's saved key when we have one; local needs no key
          const key = ctx.keyForProvider(found.id) ?? (found.id === "local" ? "ollama" : ctx.apiKey);
          ctx.setApiKey(key);
          ctx.agent.updateClient(found.baseURL, key);
          ctx.agent.setModel(found.defaultModel);
          ctx.persistConfig({ provider: found.name, model: found.defaultModel, baseURL: found.baseURL, apiKey: key });
          renderInfo(`Provider switched to ${found.name} (${found.defaultModel})`);
          return { action: "continue" };
        }
      }

      if (isJsonMode() || !process.stdin.isTTY) {
        renderInfo("Available providers: " + FREE_PROVIDERS.map((p) => p.id).join(", "));
        return { action: "continue" };
      }

      const config = await interactiveSetup();
      ctx.persistConfig(config);
      // Remember the key for this provider for future model/provider switches
      const prov = FREE_PROVIDERS.find((p) => p.name === config.provider);
      if (prov) ctx.saveProviderKey(prov.id, config.apiKey);
      // Update agent client immediately
      ctx.agent.updateClient(config.baseURL, config.apiKey);
      ctx.agent.setModel(config.model);
      // Update context variables
      ctx.setProvider(config.provider);
      ctx.setBaseURL(config.baseURL);
      ctx.setApiKey(config.apiKey);
      ctx.setModel(config.model);
      renderInfo(`Provider configured: ${config.provider} (${config.model})`);
      return { action: "continue" };
    }

    case "cost": {
      const snap = usage.snapshot(ctx.model);
      if (snap.apiCalls === 0) {
        renderAssistant("No API usage yet this session.");
      } else {
        renderAssistant(formatUsage(snap, usage.estimatedCost(ctx.model)));
      }
      return { action: "continue" };
    }

    case "compact": {
      renderInfo("Compacting conversation...");
      try {
        const summary = await agent.compact();
        if (summary) renderInfo(`Compacted — history reduced to a summary`);
        else renderInfo("Nothing to compact yet");
      } catch (err) {
        renderError(err instanceof Error ? err.message : String(err));
      }
      return { action: "continue" };
    }

    case "history": {
      const msgs = agent.getHistory();
      if (msgs.length === 0) {
        renderAssistant("No messages this session.");
        return { action: "continue" };
      }
      const lines = msgs.slice(0, 100).map((m, i) => {
        const size = (m.content || "").length;
        const preview = (m.content || "").replace(/\s+/g, " ").slice(0, 60);
        return `${String(i + 1).padStart(3)} ${m.role.padEnd(10)} ${String(size).padStart(7)}ch  ${preview}`;
      });
      renderAssistant(`${lines.length} messages shown (of ${msgs.length}):\n${lines.join("\n")}`);
      return { action: "continue" };
    }

    case "export": {
      const file = arg || "xyro-session.md";
      try {
        const md = agent.exportMarkdown();
        fs.writeFileSync(file, md, "utf-8");
        renderInfo(`Conversation exported to ${file}`);
      } catch (err) {
        renderError(err instanceof Error ? err.message : String(err));
      }
      return { action: "continue" };
    }

    case "save":
      agent.save();
      renderInfo("Conversation saved");
      return { action: "continue" };

    case "resume": {
      const loaded = agent.load();
      renderInfo(loaded ? "Resumed previous conversation" : "No saved session found");
      return { action: "continue" };
    }

    case "clear":
      agent.reset();
      usage && renderInfo("Conversation cleared");
      return { action: "continue" };

    case "init":
      renderAssistant(writeAgentsMd());
      return { action: "continue" };

    case "workflow": {
      const [wfName, ...goalWords] = arg.split(/\s+/).filter(Boolean);
      if (!wfName) {
        return { action: "agent", prompt: "Call run_workflow with name \"list\" and show me the available workflows." };
      }
      return {
        action: "agent",
        prompt: `Call run_workflow with name ${JSON.stringify(wfName)} and goal ${JSON.stringify(goalWords.join(" "))}, then summarise the outcome for me.`,
      };
    }

    case "learn":
      // The memory keeper records durable lessons from this session in XYRO.md
      return {
        action: "agent",
        prompt:
          "Use delegate with expert \"memory-keeper\" to record the durable lessons from this session in XYRO.md: conventions we followed, commands that worked, pitfalls we hit, and decisions with their reasons. Pass a concise summary of the session as context.",
      };

    case "exit":
      agent.save();
      renderInfo("Goodbye");
      return { action: "exit" };

    default:
      renderError(`Unknown command: ${name}. Type /help for the list.`);
      return { action: "continue" };
  }
}

export { isCommand };
