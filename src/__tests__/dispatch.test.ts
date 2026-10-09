import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dispatchFor, looksMultiStep } from "../agent/dispatch.js";
import { Agent } from "../agent/loop.js";
import { writeTodos } from "../tools/todos.js";
import { onTodosChanged, TodoView } from "../agent/ui-bridge.js";
import { botFrame, BOT_W } from "../tui/expert-bots.js";
import { renderSidePanel } from "../tui/side-panel.js";
import { visualWidth } from "../tui/core.js";

describe("Dispatch: the right experts get ready the moment the user writes", () => {
  it("knows a multi-step request from a question or a one-liner", () => {
    assert.equal(looksMultiStep("what does this function do?"), false);
    assert.equal(looksMultiStep("fix the typo"), false);
    assert.equal(looksMultiStep("add a login page, write tests for it and update the README"), true);
    assert.equal(looksMultiStep("Please:\n- add rate limiting\n- add tests\n- document it"), true);
    assert.equal(looksMultiStep("build a REST API for invoices with validation and then deploy it to fly.io"), true);
  });

  it("picks the experts and asks for a plan with owners when the work has several steps", () => {
    const d = dispatchFor("add a login page, write tests for it and update the README")!;
    assert.ok(d.multiStep);
    assert.ok(d.team.length >= 1 && d.team.length <= 3, JSON.stringify(d.team));
    assert.match(d.note, /^\[coordinator\] Multi-step request/);
    assert.match(d.note, /write_todos/);
    assert.match(d.note, /expert/);
    const q = dispatchFor("why is the sky blue?");
    assert.ok(!q || q.note === "", "a plain question gets no coordinator note");
    assert.equal(dispatchFor("[intent guard] something"), null);
  });
});

describe("Coordination in the agent loop", () => {
  let server: http.Server;
  let url = "";
  const bodies: string[] = [];
  let step = 0;
  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        bodies.push(body);
        // A model that dives straight in without planning
        const delta =
          step++ === 0
            ? { role: "assistant", tool_calls: [{ index: 0, id: "r1", type: "function", function: { name: "list_files", arguments: "{}" } }] }
            : { role: "assistant", content: "ok" };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-dispatch-"));
    oldCwd = process.cwd();
    oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
    process.env.XYRO_NO_POOL = "1";
    process.env.XYRO_HEDGE = "off";
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(oldCwd);
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldXdg;
    delete process.env.XYRO_NO_POOL;
    delete process.env.XYRO_HEDGE;
  });

  it("wakes the team, gives the model the coordinator note, and reminds it once to plan", async () => {
    const agent = new Agent({ baseURL: url, apiKey: "k", model: "fake" });
    let ready: string[] = [];
    agent.setOutputAdapter({ requestPermission: async () => true, onDispatch: (team) => (ready = team.map((m) => m.name)) });
    await agent.run("add a login page, write tests for it and update the README");
    assert.ok(ready.length >= 1, "experts were ready before any work started");
    assert.match(bodies[0], /\[coordinator\] Multi-step request/);
    const second = JSON.parse(bodies[1]).messages.map((m: { content: string }) => String(m.content ?? ""));
    assert.equal(second.filter((c: string) => c.startsWith("[coordinator] Plan before going further")).length, 1);
    assert.equal(bodies.length, 2);
  });
});

describe("Plans name the expert for each step", () => {
  it("write_todos keeps a known owner and drops an unknown one", async () => {
    let seen: TodoView[] = [];
    onTodosChanged((t) => (seen = t));
    try {
      await writeTodos({ items: [{ text: "Design the schema", status: "done", expert: "Architect" }, { text: "Build the API", status: "in_progress", expert: "builder" }, { text: "Party", status: "pending", expert: "ghost" }] });
      assert.deepEqual(seen.map((t) => t.expert), ["architect", "builder", undefined]);
    } finally {
      onTodosChanged(null as never);
      await writeTodos({ clear: true });
    }
  });

  it("the task panel shows each step's owner, and ready experts wait awake", () => {
    const p = renderSidePanel(
      { mood: "thinking", caption: "", plan: null, todos: [{ text: "Build the API", status: "in_progress", expert: "builder" }], instinct: [{ expert: "tester", title: "tester", status: "ready", startedAt: Date.now() - 5000 }] },
      40,
      40,
      3,
      { mascot: false }
    );
    const all = p.rows.map((r) => r.spans.map((s) => s.text).join("")).join("\n");
    assert.match(all, /Build the API · builder/);
    assert.match(all, /TEAM ─+ 1 ready/);
    for (let tick = 0; tick < 20; tick++) for (const r of botFrame({ name: "tester", title: "tester", state: "ready", since: 5000 }, tick)) assert.equal(r.reduce((w, s) => w + visualWidth(s.text), 0), BOT_W);
  });
});
