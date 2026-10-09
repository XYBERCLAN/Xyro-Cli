import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "../agent/loop.js";

type Mode = "slow-text" | "long-command" | "quick";
let mode: Mode = "quick";
let calls = 0;
let server: http.Server;
let url = "";

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      calls++;
      const last = JSON.parse(body).messages.at(-1);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (delta: object) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
      if (mode === "slow-text") {
        send({ role: "assistant", content: "Here is the first part" });
        await new Promise((r) => setTimeout(r, 4000)); // the rest would take a while
        send({ content: " and the rest." });
      } else if (mode === "long-command" && last.role === "user") {
        send({ role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "sleep 30; echo done" }) } }, { index: 1, id: "c2", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "a.txt" }) } }] });
      } else {
        send({ role: "assistant", content: "Fresh answer." });
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
after(() => server.close());

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-stop-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  process.env.XYRO_NO_POOL = "1";
  process.env.XYRO_HEDGE = "off";
  process.chdir(tmp);
  calls = 0;
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  delete process.env.XYRO_NO_POOL;
  delete process.env.XYRO_HEDGE;
});

function agentWithUi() {
  const agent = new Agent({ baseURL: url, apiKey: "k", model: "fake" });
  const notices: string[] = [];
  let shown = "";
  agent.setOutputAdapter({ requestPermission: async () => true, onNotice: (t) => notices.push(t), onAssistantText: (c) => (shown += c) });
  return { agent, notices, shown: () => shown };
}

const lastMessages = (agent: Agent) => (agent as unknown as { history: { getAll(): { role: string; content: string | null; tool_call_id?: string }[] } }).history.getAll();

describe("Esc stops XYRO", () => {
  it("stops a reply mid-stream, keeps what was said, and the next turn works", async () => {
    mode = "slow-text";
    const { agent, notices, shown } = agentWithUi();
    const started = Date.now();
    const run = agent.run("explain the auth flow");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(agent.stop(), true);
    await run;
    assert.ok(Date.now() - started < 2000, `stopped promptly (${Date.now() - started}ms)`);
    assert.equal(shown(), "Here is the first part");
    const last = lastMessages(agent).at(-1)!;
    assert.equal(last.role, "assistant");
    assert.equal(last.content, "Here is the first part\n\n(stopped by the user)");
    assert.ok(notices.some((n) => n.startsWith("Stopped")));
    assert.equal(agent.stop(), false, "nothing left to stop");

    mode = "quick";
    await agent.run("ok, continue");
    assert.equal(lastMessages(agent).at(-1)!.content, "Fresh answer.");
  });

  it("kills a running command and records unrun tool calls so the conversation stays valid", async () => {
    mode = "long-command";
    fs.writeFileSync(path.join(tmp, "a.txt"), "x");
    const { agent } = agentWithUi();
    const started = Date.now();
    const run = agent.run("run the long job");
    await new Promise((r) => setTimeout(r, 800));
    agent.stop();
    await run;
    assert.ok(Date.now() - started < 5000, `the 30s command was killed (${Date.now() - started}ms)`);
    const msgs = lastMessages(agent);
    const results = msgs.filter((m) => m.role === "tool");
    assert.deepEqual(results.map((m) => m.tool_call_id), ["c1", "c2"], "every tool call has a result");
    assert.match(results[1].content!, /Not run: the user stopped this turn/);
    assert.equal(msgs.at(-1)!.content, "(stopped by the user)");
    assert.equal(calls, 1, "no further model call after stopping");
  });
});
