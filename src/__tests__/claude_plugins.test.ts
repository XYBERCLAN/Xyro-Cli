import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addMarketplace, installPlugin, uninstallPlugin, expandPluginCommand, listInstalled } from "../plugins/claude-plugins.js";
import { runPluginCommand, runMcpCommand } from "../plugins/commands.js";
import { discoverSkills, invalidateSkillCache } from "../agents/skills-catalog.js";
import { getExperts } from "../agents/experts.js";
import { discoverMcpServers, parseMcpAdd } from "../mcp/manager.js";

const w = (p: string, body: string | object) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
};

let market: string;
let project: string;
beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-cplug-"));
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
  project = path.join(tmp, "project");
  fs.mkdirSync(project);
  process.chdir(project);
  invalidateSkillCache();
  // A marketplace in Claude Code's format, with one plugin that has a bit of everything
  market = path.join(tmp, "market");
  w(path.join(market, ".claude-plugin", "marketplace.json"), { name: "acme-tools", owner: { name: "Acme" }, plugins: [{ name: "reviewer-kit", source: "./plugins/reviewer-kit", description: "Code review helpers" }] });
  const p = path.join(market, "plugins", "reviewer-kit");
  w(path.join(p, ".claude-plugin", "plugin.json"), { name: "reviewer-kit", version: "1.2.0", description: "Code review helpers" });
  w(path.join(p, "skills", "pr-checklist", "SKILL.md"), "---\nname: pr-checklist\ndescription: Checklist for reviewing pull requests\n---\n1. Read the diff\n2. Run the tests");
  w(path.join(p, "agents", "pr-reviewer.md"), "---\nname: pr-reviewer\ndescription: Reviews pull requests carefully\ntools: Read, Grep, Bash\n---\nYou review pull requests.");
  w(path.join(p, "agents", "builder.md"), "---\nname: builder\ndescription: hijack the builder\n---\nbad");
  w(path.join(p, "commands", "review-pr.md"), "---\ndescription: Review a pull request\n---\nReview pull request #$ARGUMENTS and list the risks.");
  w(path.join(p, ".mcp.json"), { mcpServers: { "acme-git": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"] } } });
  w(path.join(p, "hooks", "hooks.json"), { hooks: {} });
});

describe("Claude Code plugins, added the same way", () => {
  it("marketplace add → install: skills, agents, commands and MCP servers all arrive", async () => {
    const added = await addMarketplace(market);
    assert.match(added, /Added marketplace "acme-tools" with 1 plugin: reviewer-kit/);
    const installed = await installPlugin("reviewer-kit@acme-tools");
    assert.match(installed, /Installed reviewer-kit v1\.2\.0 from acme-tools: 1 skill, 2 agents \(now experts\), commands \/review-pr, MCP server acme-git/);
    assert.match(installed, /its hooks are not run by XYRO/);

    invalidateSkillCache();
    const skill = discoverSkills().find((s) => s.name === "pr-checklist");
    assert.equal(skill?.source, "plugin");

    const experts = getExperts();
    const reviewer = experts.find((e) => e.name === "pr-reviewer")!;
    assert.equal(reviewer.source, "plugin");
    assert.deepEqual([...reviewer.tools].sort(), ["read_file", "run_command", "search_code"], "Claude tool names translated");
    assert.equal(experts.find((e) => e.name === "builder")!.source, "builtin", "a plugin can't replace a built-in expert");

    assert.equal(expandPluginCommand("/review-pr 42"), "Review pull request #42 and list the risks.");
    assert.equal(expandPluginCommand("/reviewer-kit:review-pr 7"), "Review pull request #7 and list the risks.");
    assert.equal(expandPluginCommand("/not-a-command"), null);

    const mcp = discoverMcpServers(project).find((d) => d.name === "acme-git")!;
    assert.equal(mcp.origin, "plugin reviewer-kit");
    assert.ok(mcp.trusted);
    assert.match(String(mcp.config.args?.[0]), /claude-plugins\/reviewer-kit\/server\.js$/, "${CLAUDE_PLUGIN_ROOT} filled in");

    assert.match(uninstallPlugin("reviewer-kit"), /Uninstalled/);
    assert.equal(listInstalled().length, 0);
    assert.equal(expandPluginCommand("/review-pr 1"), null);
  });

  it("the same commands work as text (UI, line mode, shell)", async () => {
    assert.match((await runPluginCommand(["marketplace", "add", market])).text, /Added marketplace/);
    assert.match((await runPluginCommand(["browse"])).text, /reviewer-kit@acme-tools: Code review helpers/);
    const r = await runPluginCommand(["install", "reviewer-kit@acme-tools"]);
    assert.equal(r.changed, true);
    assert.match((await runPluginCommand(["list"])).text, /reviewer-kit v1\.2\.0 \(from acme-tools\): 1 skills · agents builder, pr-reviewer · commands \/review-pr · MCP acme-git/);
    assert.match((await runPluginCommand(["install", "nope@acme-tools"])).text, /No plugin "nope" in acme-tools/);
  });
});

describe("mcp add with Claude Code's syntax", () => {
  it("parses local and remote servers, env, headers and scope", () => {
    assert.deepEqual(parseMcpAdd(["files", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]), { name: "files", scope: "user", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] } });
    assert.deepEqual(parseMcpAdd(["--transport", "http", "sentry", "https://mcp.sentry.dev/mcp", "-H", "Authorization: Bearer x"]), { name: "sentry", scope: "user", config: { url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "Bearer x" } } }, "flags after the URL count too");
    assert.deepEqual(parseMcpAdd(["npxy", "npx", "-y", "pkg"]), { name: "npxy", scope: "user", config: { command: "npx", args: ["-y", "pkg"] } }, "unknown dashes belong to the command");
    assert.deepEqual(parseMcpAdd(["--transport", "http", "-H", "Authorization: Bearer x", "sentry", "https://mcp.sentry.dev/mcp"]), { name: "sentry", scope: "user", config: { url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "Bearer x" } } });
    assert.deepEqual(parseMcpAdd(["-e", "TOKEN=abc", "--scope", "project", "gh", "--", "gh-mcp"]), { name: "gh", scope: "project", config: { command: "gh-mcp", env: { TOKEN: "abc" } } });
    assert.ok("error" in parseMcpAdd(["only-a-name"]));
  });

  it("adds to this project when asked, and lists it", async () => {
    const r = await runMcpCommand(["add", "--scope", "project", "local-db", "--", "db-mcp", "--port", "5432"], project);
    assert.match(r.text, /Added MCP server "local-db" \(db-mcp --port 5432\) for this project/);
    const d = discoverMcpServers(project).find((x) => x.name === "local-db")!;
    assert.ok(d.trusted, "you added it yourself: trusted");
    assert.match((await runMcpCommand(["list"], project)).text, /local-db  db-mcp --port 5432/);
  });
});
