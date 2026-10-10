import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SkillsModal, PluginsModal, SkillRow } from "../tui/capabilities.js";
import { loadPlugins, pluginStatuses } from "../config/plugins.js";
import { reloadPlugins, executeTool } from "../tools/registry.js";
import { addUserMcpServer, removeUserMcpServer } from "../mcp/manager.js";

const text = (rows: { spans: { text: string }[] }[]) => rows.map((r) => r.spans.map((s) => s.text).join("")).join("\n");

let tmp: string;
let oldXdg: string | undefined;
let oldHome: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-caps-"));
  oldXdg = process.env.XDG_CONFIG_HOME;
  oldHome = process.env.HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
  process.env.HOME = tmp;
});
afterEach(() => {
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  process.env.HOME = oldHome;
});

const rows: SkillRow[] = [
  { name: "pdf", description: "Fill and merge PDF forms", source: "user", path: "/x/pdf/SKILL.md", record: "3/3 verified" },
  { name: "deploy-flow", description: "How this project deploys", source: "project", path: ".xyro/skills/deploy-flow/SKILL.md", record: "" },
  { name: "remotion", description: "Make videos with Remotion", source: "plugin", path: "/p/remotion/SKILL.md", record: "1/4 verified, quarantined" },
];

describe("/skills", () => {
  it("lists skills grouped by where they come from, with their record", () => {
    const m = new SkillsModal();
    m.open(rows, () => null);
    const t = text(m.render(100));
    assert.ok(t.indexOf("THIS PROJECT") < t.indexOf("YOURS") && t.indexOf("YOURS") < t.indexOf("FROM PLUGINS"));
    assert.match(t, /3 skills XYRO and its experts can load/);
    assert.match(t, /3\/3 verified/);
    assert.match(t, /▌ deploy-flow/, "project skills first");
  });

  it("type to filter, enter to read the whole skill, esc back to the list", () => {
    const m = new SkillsModal();
    m.open(rows, (name) => (name === "pdf" ? "# PDF\n\nUse pypdf.\n\n- fill fields\n- merge files" : null));
    for (const ch of "pdf") m.handleKey(ch);
    assert.doesNotMatch(text(m.render(100)), /deploy-flow/);
    m.handleKey("\r");
    const reading = text(m.render(100));
    assert.match(reading, /Use pypdf\./);
    assert.match(reading, /fill fields/);
    assert.match(reading, /esc back to the list/);
    m.handleKey("\u001b");
    assert.ok(m.isOpen(), "esc while reading goes back to the list");
    assert.match(text(m.render(100)), /▌ pdf/);
    m.handleKey("\u001b");
    assert.equal(m.isOpen(), false);
  });

  it("a long skill scrolls inside the pop-up", () => {
    const m = new SkillsModal();
    m.open(rows, () => Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n"));
    m.handleKey("\r");
    const first = m.render(100, 30);
    assert.ok(first.length <= 34);
    assert.match(text(first), /↓ \d+ more/);
    for (let i = 0; i < 20; i++) m.handleKey(" ");
    assert.match(text(m.render(100, 30)), /end of skill/);
  });
});

describe("/plugins", () => {
  const pluginsDir = () => path.join(tmp, "cfg", "xyro", "plugins");
  const write = (folder: string, code: string) => {
    fs.mkdirSync(path.join(pluginsDir(), folder), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir(), folder, "plugin.js"), code);
  };

  it("loads good plugins and explains broken ones instead of printing over the UI", async () => {
    write("hello", `export const manifest = { name: "hello", version: "1.0.0", description: "Says hello" };
export const tools = [{ definition: { type: "function", function: { name: "say_hello", description: "hi", parameters: { type: "object", properties: {} } } }, execute: async () => "hello!" }];`);
    write("broken", `export const nothing = 1;`);
    fs.mkdirSync(path.join(pluginsDir(), "empty"), { recursive: true });
    const tools = await loadPlugins();
    assert.deepEqual(tools.map((t) => t.definition.function.name), ["say_hello"]);
    const st = Object.fromEntries(pluginStatuses().map((p) => [p.folder, p]));
    assert.deepEqual(st.hello.tools, ["say_hello"]);
    assert.match(st.broken.error!, /does not export a `tools` array/);
    assert.match(st.empty.error!, /no plugin\.ts/);
    const m = new PluginsModal();
    m.open(pluginStatuses(), pluginsDir());
    const t = text(m.render(100));
    assert.match(t, /1 plugin loaded/);
    assert.match(t, /say_hello/);
    assert.match(t, /not loaded: it does not export/);
  });

  it("/plugins reload picks up a plugin added while XYRO runs", async () => {
    await reloadPlugins();
    write("late", `export const tools = [{ definition: { type: "function", function: { name: "late_tool", description: "x", parameters: { type: "object", properties: {} } } }, execute: async () => "late ok" }];`);
    await reloadPlugins();
    assert.equal(await executeTool("late_tool", {}), "late ok");
  });
});

describe("/mcp add and remove", () => {
  it("adds a command or URL server to your config and removes it again", () => {
    const file = path.join(tmp, "cfg", "xyro", "mcp.json");
    assert.ok(addUserMcpServer("files", "npx -y @modelcontextprotocol/server-filesystem '/tmp/a b'").ok);
    assert.ok(addUserMcpServer("docs", "https://docs.example/mcp").ok);
    const cfg = JSON.parse(fs.readFileSync(file, "utf-8")).mcpServers;
    assert.deepEqual(cfg.files, { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/a b"] });
    assert.deepEqual(cfg.docs, { url: "https://docs.example/mcp" });
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600", "the file can hold tokens: private");
    assert.ok(removeUserMcpServer("files").ok);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf-8")).mcpServers.files, undefined);
    assert.equal(addUserMcpServer("bad name!", "x").ok, false);
  });

  it("won't remove a server that comes from another tool's settings, and says where it is", () => {
    fs.writeFileSync(path.join(tmp, ".claude.json"), JSON.stringify({ mcpServers: { sentry: { url: "https://mcp.sentry.dev/mcp" } } }));
    const r = removeUserMcpServer("sentry");
    assert.equal(r.ok, false);
    assert.match(r.message, /your claude settings/);
  });
});
