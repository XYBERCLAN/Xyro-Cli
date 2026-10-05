import * as fs from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { Agent } from "../agent/loop.js";
import { UsageTracker, formatUsage } from "../agent/usage.js";
import { summarizeHistory } from "../providers/llm.js";
import { FREE_PROVIDERS, interactiveSetup, Provider } from "../ui/prompts.js";
import { renderInfo, renderError, renderAssistant, isJsonMode } from "../ui/render.js";
import { getToolCount } from "../tools/registry.js";
import { addRule, clearRules, loadRules, removeRule } from "../tools/permissions.js";
import {
  deleteSession,
  describeSession,
  listSessions,
  renameSession,
  resolveSessionId,
  type SessionSummary,
} from "./sessions.js";

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
  /sessions          list conversation sessions (per project)
  /new [name]        start a new named session for this project
  /switch [name]     switch to another session (interactive picker if omitted)
  /rename <name>     rename the current session
  /delete [name]     delete a session (defaults to the current one)
  /permissions       list tool permission rules
  /permissions allow <tool|*> [path-pattern]
  /permissions deny <tool|*> [path-pattern]
  /permissions remove <rule-id> | reset
  /init              scaffold an AGENTS.md project context file
  /exit              save and quit
Bare words also work: help, status, model, cost, compact, history, export, save, resume, clear, plan, sessions, new, switch, rename, delete, permissions, init, exit, quit
`.trim();

const ALIASES: Record<string, string> = {
  help: "/help", status: "/status", model: "/model", provider: "/provider",
  cost: "/cost", compact: "/compact", history: "/history", export: "/export",
  save: "/save", resume: "/resume", clear: "/clear", plan: "/plan",
  init: "/init", quit: "/exit", exit: "/exit",
  sessions: "/sessions", session: "/sessions", new: "/new",
  switch: "/switch", rename: "/rename", delete: "/delete",
  permissions: "/permissions", perms: "/permissions",
};

/**
 * /permissions — inspect and edit the saved allow/deny rules.
 *
 * Rules belong to the user, never to the agent: there is deliberately no tool
 * that can add them, because a self-granting tool would void every check.
 */
function handlePermissionsCommand(arg: string): void {
  const parts = arg.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || "").toLowerCase();

  if (!sub) {
    const rules = loadRules();
    if (rules.length === 0) {
      renderInfo(
        "No permission rules saved — mutating tools ask for approval.\n" +
          "  /permissions allow write_file src/**   always allow writes under src/\n" +
          "  /permissions deny run_command rm       never run commands matching rm\n" +
          "  /permissions reset                      forget every rule"
      );
      return;
    }
    renderInfo(
      `${rules.length} permission rule(s):\n` +
        rules
          .map(
            (r) =>
              `  ${r.id}  ${r.action === "allow" ? "allow" : "deny "}  ` +
              `${r.tools.join(", ")}${r.paths.length ? `  on ${r.paths.join(", ")}` : ""}`
          )
          .join("\n")
    );
    return;
  }

  if (sub === "reset") {
    const n = clearRules();
    renderInfo(n > 0 ? `Removed ${n} rule(s)` : "No rules to remove");
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const id = parts[1];
    if (!id) {
      renderError("Usage: /permissions remove <rule-id>");
      return;
    }
    renderInfo(removeRule(id) ? `Removed rule ${id}` : `No rule with id ${id}`);
    return;
  }

  if (sub === "allow" || sub === "deny") {
    const tool = parts[1];
    if (!tool) {
      renderError(`Usage: /permissions ${sub} <tool|*> [path-pattern]`);
      return;
    }
    try {
      const rule = addRule({ action: sub, tools: [tool], paths: parts.slice(2) });
      renderInfo(
        `Rule ${rule.id}: ${sub} ${tool}${rule.paths.length ? ` on ${rule.paths.join(", ")}` : ""}`
      );
    } catch (err) {
      renderError(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  renderError(
    `Unknown /permissions sub-command "${sub}".\n` +
      "  /permissions                       list rules\n" +
      "  /permissions allow <tool|*> [path] allow a tool, optionally for paths matching a glob\n" +
      "  /permissions deny <tool|*> [path]  refuse a tool (deny rules win over allow)\n" +
      "  /permissions remove <id>           drop one rule\n" +
      "  /permissions reset                 drop every rule"
  );
}

function formatAge(ts: number): string {
  if (!ts) return "unknown";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Text table of every session, marking the ones from this project. */
function renderSessionList(sessions: SessionSummary[], currentId: string): void {
  if (sessions.length === 0) {
    renderAssistant("No sessions yet. The current conversation is saved automatically after every turn.");
    return;
  }
  const lines = sessions.map((s) => {
    const marker = s.id === currentId ? pc.green("*") : " ";
    const scope = s.current ? pc.dim("(this project)") : pc.dim(`(${s.projectPath || "unknown"})`);
    return `${marker} ${s.id}  ${s.name.padEnd(16)} ${String(s.messageCount).padStart(4)} msgs  ${formatAge(s.updatedAt).padEnd(9)} ${scope}`;
  });
  renderAssistant(
    `${sessions.length} session(s):\n${lines.join("\n")}\n\n` +
      `* = current. Switch with /switch <id|name>, start fresh with /new [name].`
  );
}

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

  /** Shared by `/switch` and `/sessions <name>`: resolve a token then load it. */
  const switchTo = async (token: string): Promise<CommandResult> => {
    const id = resolveSessionId(token);
    if (!id) {
      renderError(`No session matches "${token}". Use /sessions to list them.`);
      return { action: "continue" };
    }
    if (id === agent.getSessionId()) {
      renderInfo("Already on that session");
      return { action: "continue" };
    }
    if (agent.switchSession(id)) {
      renderInfo(`Switched to session "${agent.getSessionName()}" (${id})`);
    } else {
      renderError(`Failed to load session "${token}"`);
    }
    return { action: "continue" };
  };

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
        `session: ${agent.getSessionName()} (${agent.getSessionId()})`,
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

    case "sessions": {
      const sessions = listSessions();
      // `/sessions <name>` is a shortcut for switching.
      if (arg) {
        return await switchTo(arg);
      }
      renderSessionList(sessions, agent.getSessionId());
      return { action: "continue" };
    }

    case "new": {
      const id = agent.newSession(arg || undefined);
      renderInfo(`New session started: ${arg || "default"} (${id})`);
      return { action: "continue" };
    }

    case "switch": {
      if (!arg) {
        const sessions = listSessions();
        if (sessions.length === 0) {
          renderInfo("No sessions to switch to");
          return { action: "continue" };
        }
        if (isJsonMode()) {
          renderSessionList(sessions, agent.getSessionId());
          return { action: "continue" };
        }
        const choice = await p.select({
          message: "Switch to session",
          options: sessions.map((s) => ({
            value: s.id,
            label: describeSession(s),
            hint: `${s.messageCount} msgs · ${formatAge(s.updatedAt)}${s.id === agent.getSessionId() ? " · current" : ""}`,
          })),
        });
        if (p.isCancel(choice)) {
          renderInfo("Session switch cancelled");
          return { action: "continue" };
        }
        return switchTo(String(choice));
      }
      return await switchTo(arg);
    }

    case "rename": {
      if (!arg) {
        renderError("Usage: /rename <new name>");
        return { action: "continue" };
      }
      const ok = renameSession(agent.getSessionId(), arg);
      renderInfo(ok ? `Session renamed to "${arg}"` : "Failed to rename session");
      return { action: "continue" };
    }

    case "delete": {
      const target = arg || agent.getSessionId();
      const id = arg ? resolveSessionId(arg) : agent.getSessionId();
      if (!id) {
        renderError(`No session matches "${arg}"`);
        return { action: "continue" };
      }
      if (id === agent.getSessionId() && !arg) {
        renderError("Refusing to delete the session you are using. Use /delete <other-id> or start a /new session first.");
        return { action: "continue" };
      }
      const meta = listSessions().find((s) => s.id === id);
      if (deleteSession(id)) {
        if (id === agent.getSessionId()) {
          agent.newSession();
          renderInfo(`Deleted session "${meta?.name || target}" — started a fresh one`);
        } else {
          renderInfo(`Deleted session "${meta?.name || target}"`);
        }
      } else {
        renderError(`Failed to delete session "${target}"`);
      }
      return { action: "continue" };
    }

    case "permissions": {
      handlePermissionsCommand(arg);
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
