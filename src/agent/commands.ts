import * as fs from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { Agent } from "../agent/loop.js";
import { UsageTracker, formatUsage } from "../agent/usage.js";
import { summarizeHistory } from "../providers/llm.js";
import { FREE_PROVIDERS, interactiveSetup, Provider } from "../ui/prompts.js";
import { renderInfo, renderError, renderAssistant, isJsonMode } from "../ui/render.js";
import { getToolCount } from "../tools/registry.js";

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
  setPlanMode?: (v: boolean) => void;
  isPlanMode?: () => boolean;
}

export interface CommandResult {
  action: "continue" | "exit" | "agent";
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
  /plan              toggle PLAN MODE (read-only planning; switch back to build with /plan again)
  /init              scaffold an AGENTS.md project context file
  /exit              save and quit
Bare words also work: help, status, model, cost, compact, history, export, save, resume, clear, plan, exit, quit
`.trim();

const ALIASES: Record<string, string> = {
  help: "/help", status: "/status", model: "/model", provider: "/provider",
  cost: "/cost", compact: "/compact", history: "/history", export: "/export",
  save: "/save", resume: "/resume", clear: "/clear", plan: "/plan",
  init: "/init", quit: "/exit", exit: "/exit",
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
        `plan mode: ${agent.isPlanMode() ? pc.green("ON") : pc.dim("off")}`,
      ];
      renderAssistant(lines.join("\n"));
      return { action: "continue" };
    }

    case "model": {
      if (arg) {
        ctx.setModel(arg);
        ctx.persistConfig({ model: arg });
        renderInfo(`Model switched to ${arg}`);
        return { action: "continue" };
      }

      // Interactive model picker
      const current = ctx.model;
      const preset = FREE_PROVIDERS.find(
        (pr: Provider) => pr.name === ctx.provider || pr.baseURL === ctx.baseURL
      );

      const options: { value: string; label: string; hint?: string }[] = [];
      if (preset) {
        for (const m of preset.models) {
          options.push({
            value: m,
            label: m,
            hint: m === current ? "current" : m === preset.defaultModel ? "default" : undefined,
          });
        }
      }
      options.push({ value: "__custom__", label: "Enter a custom model name…" });

      if (isJsonMode()) {
        renderAssistant(
          `Current model: ${current}` +
            (preset ? `\nAvailable models for ${preset.name}:\n${preset.models.map((m) => "- " + m).join("\n")}` : "") +
            `\nSwitch with: /model <name>`
        );
        return { action: "continue" };
      }

      const choice = await p.select({
        message: `Select model${preset ? ` (${preset.name})` : ""} — current: ${current}`,
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

      ctx.setModel(newModel);
      ctx.persistConfig({ model: newModel });
      renderInfo(`Model switched to ${newModel}`);
      return { action: "continue" };
    }

    case "provider": {
      const config = await interactiveSetup();
      ctx.persistConfig(config);
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

    case "plan": {
      const next = ctx.isPlanMode ? !ctx.isPlanMode() : !agent.isPlanMode();
      ctx.setPlanMode?.(next);
      renderInfo(next ? "PLAN MODE enabled — read-only planning. Type your request to make a plan." : "PLAN MODE disabled — back to build mode.");
      return { action: "continue" };
    }

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
