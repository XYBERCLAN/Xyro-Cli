import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { connectMcpServers, mcpStatus, getMcpToolNames, disconnectMcpServers } from "../mcp/manager.js";
import { executeTool, getToolDefinitions } from "../tools/registry.js";
import { shouldAskPermission } from "../tools/permissions.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let tmp: string;
let oldXdg: string | undefined;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-mcp-"));
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
  const sdk = (p: string) => JSON.stringify(path.join(root, "node_modules/@modelcontextprotocol/sdk/dist/esm", p));
  fs.writeFileSync(
    path.join(tmp, "server.mjs"),
    `import { McpServer } from ${sdk("server/mcp.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { z } from ${JSON.stringify(path.join(root, "node_modules/zod/index.js"))};
const s = new McpServer({ name: "demo", version: "1.0.0" });
s.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }));
s.tool("deploy", "Deploy", {}, async () => ({ content: [{ type: "text", text: "deployed" }] }));
await s.connect(new StdioServerTransport());`
  );
  fs.mkdirSync(path.join(tmp, "xyro"), { recursive: true });
  const server = { command: process.execPath, args: [path.join(tmp, "server.mjs")] };
  fs.writeFileSync(
    path.join(tmp, "xyro", "mcp.json"),
    JSON.stringify({ mcpServers: { demo: { ...server, autoApprove: ["add"] }, hidden: { ...server, expertsOnly: true }, broken: { command: "no-such-binary-xyro" } } })
  );
  await connectMcpServers(tmp);
});

after(async () => {
  await disconnectMcpServers();
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

describe("MCP client", () => {
  it("connects servers and reports failures clearly", () => {
    const byName = Object.fromEntries(mcpStatus().map((s) => [s.name, s]));
    assert.equal(byName.demo.state, "connected");
    assert.deepEqual(byName.demo.tools, ["mcp__demo__add", "mcp__demo__deploy"]);
    assert.equal(byName.broken.state, "failed");
    assert.ok(byName.broken.error);
  });

  it("calls a server tool through the normal tool path", async () => {
    assert.equal(await executeTool("mcp__demo__add", { a: 2, b: 3 }), "5");
  });

  it("keeps experts-only servers out of the main agent's tools", () => {
    const names = getToolDefinitions().map((t) => t.function.name);
    assert.ok(names.includes("mcp__demo__add"));
    assert.ok(!names.some((n) => n.startsWith("mcp__hidden__")));
    assert.equal(getMcpToolNames("hidden").length, 2);
  });

  it("asks before MCP tools unless auto-approved", () => {
    assert.equal(shouldAskPermission("mcp__demo__add"), false);
    assert.equal(shouldAskPermission("mcp__demo__deploy"), true);
  });
});
