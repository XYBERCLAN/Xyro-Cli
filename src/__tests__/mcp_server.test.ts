import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
// Absolute loader path: the server runs in another directory, where "tsx" would not resolve
const tsx = import.meta.resolve("tsx");

describe("xyro mcp", () => {
  it("serves XYRO's tools to another agent over stdio", { timeout: 120_000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-mcp-serve-"));
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(path.join(tmp, "src", "auth.ts"), "export function login(user: string) { return user; }\n");
    const client = new Client({ name: "host", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", tsx, entry, "mcp"],
      cwd: tmp,
      env: { ...(process.env as Record<string, string>), XDG_CONFIG_HOME: path.join(tmp, ".cfg"), HOME: tmp },
      stderr: "ignore",
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const n of ["xyro_tournament", "xyro_delegate", "xyro_repo_map", "xyro_intents_check", "xyro_web_search", "xyro_quota"]) assert.ok(names.includes(n), n);

      const map = (await client.callTool({ name: "xyro_repo_map", arguments: {} })) as { content: { text: string }[]; isError?: boolean };
      assert.match(map.content[0].text, /auth\.ts/);
      assert.match(map.content[0].text, /login/);

      const quota = (await client.callTool({ name: "xyro_quota", arguments: {} })) as { content: { text: string }[] };
      assert.match(quota.content[0].text, /No providers connected/);

      const t = (await client.callTool({ name: "xyro_tournament", arguments: { task: "x" } })) as { content: { text: string }[]; isError?: boolean };
      assert.equal(t.isError, true, "errors are reported as MCP errors");
    } finally {
      await client.close();
    }
  });
});
