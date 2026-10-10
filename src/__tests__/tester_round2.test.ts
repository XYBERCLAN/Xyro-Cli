import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import { isDailyLimitError, isMinuteLimitError, retryHintMs } from "../providers/pool.js";
import { extractRetryDelay } from "../providers/llm.js";
import { prepareForProvider, trimHistory } from "../agent/loop.js";
import { lenientArgs } from "../tools/registry.js";
import { searchOutsideProject } from "../tools/shell.js";
import type { Message } from "../agent/types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listInstalled, listMarketplaces, installPlugin, uninstallPlugin } from "../plugins/claude-plugins.js";
import { runMcpCommand } from "../plugins/commands.js";
import { discoverMcpServers } from "../mcp/manager.js";
import { markdownToLines } from "../tui/markdown-lines.js";
import { SelectionManager } from "../tui/selection.js";
import { visualWidth } from "../tui/core.js";

// What Google's OpenAI-compatible endpoint sends for a burst of requests on the free tier
const GEMINI_MINUTE_429 = Object.assign(
  new Error(
    '429 [{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 10, model: gemini-2.5-flash\\nPlease retry in 37.4s.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]}}]'
  ),
  { status: 429 }
);
const GEMINI_DAY_429 = Object.assign(
  new Error('429 Quota exceeded for metric: generate_content_free_tier_requests, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier'),
  { status: 429 }
);

describe("Gemini 429s (tester report)", () => {
  it("a per-minute 429 worded as 'quota exceeded' is not a used-up daily allowance", () => {
    assert.equal(isMinuteLimitError(GEMINI_MINUTE_429), true);
    assert.equal(isDailyLimitError(GEMINI_MINUTE_429), false);
  });
  it("a real daily limit is still recognised", () => {
    assert.equal(isDailyLimitError(GEMINI_DAY_429), true);
    assert.equal(isMinuteLimitError(GEMINI_DAY_429), false);
  });
  it("waits as long as Google asks, not a shorter guess", () => {
    assert.equal(retryHintMs("Please retry in 37.4s."), 37_400);
    assert.equal(retryHintMs('"retryDelay":"37s"'), 37_000);
    assert.equal(extractRetryDelay(GEMINI_MINUTE_429, 0), 37_400);
  });
});

describe("OpenRouter 400s (tester report)", () => {
  it("one system message first, and a user message before the first reply", () => {
    const msgs: Message[] = [
      { role: "system", content: "rules" },
      { role: "system", content: "## Previous Conversation\nsummary" },
      { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "file" },
    ];
    const out = prepareForProvider(msgs);
    assert.deepEqual(out.map((m) => m.role), ["system", "user", "assistant", "tool"]);
    assert.match(out[0].content ?? "", /rules[\s\S]*summary/);
  });

  it("a single long turn is shortened to fit instead of outgrowing the model's window", () => {
    const turn: Message[] = [{ role: "user", content: "do a big task" }];
    for (let i = 0; i < 30; i++) {
      turn.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: "{}" } }] });
      turn.push({ role: "tool", tool_call_id: `c${i}`, content: "x".repeat(4000) });
    }
    const out = trimHistory([{ role: "system", content: "rules" }, ...turn], 20_000);
    const results = out.filter((m) => m.role === "tool");
    assert.equal(results.length, 30, "no call loses its result");
    assert.equal(results.filter((m) => (m.content ?? "").length === 4000).length, 4, "the latest results stay whole");
  });
});

describe("Tool arguments as models really send them", () => {
  const schema = z.object({ filter: z.string().optional(), budget_tokens: z.number().optional(), all: z.boolean().optional() });
  it("null means 'not given', and numbers or booleans in quotes are read as such", () => {
    const args = lenientArgs(schema, { filter: null, budget_tokens: "2000", all: "true" });
    assert.deepEqual(args, { budget_tokens: 2000, all: true });
    assert.equal(schema.safeParse(args).success, true);
  });
});

describe("Shell searches stay inside the project", () => {
  it("refuses searching the home folder, system folders or the whole disk", () => {
    assert.ok(searchOutsideProject("find ~ -name '*.env'"));
    assert.ok(searchOutsideProject("grep -r password /etc"));
    assert.ok(searchOutsideProject("ls ../other-project"));
    assert.ok(searchOutsideProject("ls $HOME/Documents"));
    assert.equal(searchOutsideProject("locate secrets"), "the whole disk");
  });
  it("leaves normal project work alone", () => {
    for (const c of ['grep -rn "/api" src', "rg TODO .", "ls src", "find . -path '/x' -prune", "git log | grep fix", "cat package.json", "npm test 2>/dev/null"]) {
      assert.equal(searchOutsideProject(c), null, c);
    }
  });
});

describe("Clickable links (tester report)", () => {
  const click = (rows: ReturnType<typeof markdownToLines>, text: string) => {
    const s = new SelectionManager();
    s.frameRows = rows;
    const y = rows.findIndex((r) => r.spans.map((x) => x.text).join("").includes(text));
    const before = rows[y].spans.map((x) => x.text).join("").indexOf(text);
    return s.urlAt(visualWidth(rows[y].spans.map((x) => x.text).join("").slice(0, before)) + 2, y + 1);
  };
  it("a markdown link opens its address, though only its label is shown", () => {
    const rows = markdownToLines("Get a key at [Google AI Studio](https://aistudio.google.com/apikey).");
    assert.equal(click(rows, "Google AI Studio"), "https://aistudio.google.com/apikey");
    assert.ok(rows.flatMap((r) => r.spans).some((x) => x.underline), "links are underlined");
  });
  it("a long address wrapped onto two lines opens whole from either line", () => {
    const url = "https://openrouter.ai/settings/keys/" + "a".repeat(60);
    const rows = markdownToLines(`Open ${url} now`, 40);
    const linkRows = rows.filter((r) => r.spans.some((x) => x.link));
    assert.ok(linkRows.length >= 2);
    for (const r of linkRows) assert.equal(r.spans.find((x) => x.link)!.link, url);
  });
});

describe("Plugins and MCP servers, the Claude Code way", () => {
  const w = (p: string, body: object | string) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  };
  const setup = () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-cc-"));
    const claude = path.join(tmp, "claude");
    process.env.XYRO_CLAUDE_HOME = claude;
    process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
    const project = path.join(tmp, "project");
    fs.mkdirSync(project);
    // Claude Code downloaded the official marketplace and installed one plugin from it
    const market = path.join(claude, "plugins", "marketplaces", "claude-plugins-official");
    w(path.join(market, ".claude-plugin", "marketplace.json"), { name: "claude-plugins-official", plugins: [{ name: "pr-tools", source: "./plugins/pr-tools" }, { name: "docs-kit", source: "./plugins/docs-kit" }] });
    w(path.join(market, "plugins", "docs-kit", "commands", "doc.md"), "Write docs for $ARGUMENTS");
    const installed = path.join(claude, "plugins", "cache", "claude-plugins-official", "pr-tools", "1.0.0");
    w(path.join(installed, ".claude-plugin", "plugin.json"), { name: "pr-tools", description: "PR helpers" });
    w(path.join(installed, ".mcp.json"), { mcpServers: { "pr-server": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/s.js"] } } });
    const off = path.join(claude, "plugins", "cache", "x", "muted", "1");
    w(path.join(off, ".claude-plugin", "plugin.json"), { name: "muted" });
    const other = path.join(claude, "plugins", "cache", "x", "elsewhere", "1");
    w(path.join(other, ".claude-plugin", "plugin.json"), { name: "elsewhere" });
    w(path.join(claude, "plugins", "known_marketplaces.json"), { "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" }, installLocation: market } });
    w(path.join(claude, "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: {
        "pr-tools@claude-plugins-official": [{ scope: "user", installPath: installed, version: "1.0.0" }],
        "muted@x": [{ scope: "user", installPath: off }],
        "elsewhere@x": [{ scope: "project", projectPath: "/some/other/project", installPath: other }],
      },
    });
    w(path.join(claude, "settings.json"), { enabledPlugins: { "muted@x": false } });
    return { project };
  };

  it("plugins installed in Claude Code work in XYRO, minus switched-off and other projects' ones", () => {
    const { project } = setup();
    const names = listInstalled(project).map((p) => p.name);
    assert.deepEqual(names, ["pr-tools"]);
    assert.ok(discoverMcpServers(project).some((d) => d.name === "pr-server" && d.config.args?.[0]?.endsWith("pr-tools/1.0.0/s.js")), "its MCP server is there too");
    assert.match(uninstallPlugin("pr-tools"), /Claude Code/, "Claude Code manages its own plugins");
  });

  it("install needs no @marketplace and no download when Claude Code has the official marketplace", async () => {
    const { project } = setup();
    process.chdir(project);
    assert.ok(listMarketplaces().some((m) => m.name === "claude-plugins-official"));
    assert.match(await installPlugin("docs-kit"), /^✅ Installed docs-kit/);
  });

  it("mcp add-json takes a server's JSON as Claude Code does", async () => {
    const { project } = setup();
    const r = await runMcpCommand(["add-json", "weather", '{"type":"http","url":"https://example.com/mcp","headers":{"Authorization":"Bearer secret"}}'], project);
    assert.match(r.text, /^✅/);
    const got = await runMcpCommand(["get", "weather"], project);
    assert.match(got.text, /example\.com\/mcp/);
    assert.doesNotMatch(got.text, /secret/, "secrets are not printed");
  });
});
