import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { council, parseAssignments, tallyVotes } from "../agents/council.js";
import { setExpertSession, runExpert } from "../agents/runtime.js";
import { getExpert } from "../agents/experts.js";
import { clearNotes, listNotes } from "../agents/team-board.js";

type Req = { who: string; system: string; task: string; lastRole: string; tools: string[] };
let reply: (r: Req) => object = () => ({ role: "assistant", content: "ok" });
const requests: Req[] = [];
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      const system = String(j.messages[0].content);
      const who = (system.match(/^You are (worker \d+)/) ?? system.match(/You are XYRO's ([a-z-]+)/) ?? [])[1] ?? "?";
      const r: Req = { who, system, task: String(j.messages[1]?.content ?? ""), lastRole: j.messages[j.messages.length - 1].role, tools: (j.tools ?? []).map((t: { function: { name: string } }) => t.function.name) };
      requests.push(r);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: reply(r) }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  setExpertSession(() => ({ baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: "k", model: "fake" }));
});
after(() => {
  server.close();
  setExpertSession(null);
});

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-council-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  process.env.XYRO_NO_POOL = "1";
  process.chdir(tmp);
  requests.length = 0;
  clearNotes();
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  delete process.env.XYRO_NO_POOL;
});

describe("Council", () => {
  it("members propose (read-only), discuss and vote (no tools), the winner decides", async () => {
    reply = (r) => {
      if (r.task.includes("propose how the TEAM")) return { role: "assistant", content: `APPROACH: ${r.who} plan\nRISKS: none\nASSIGNMENTS:\n- builder: build it` };
      if (r.task.includes("Discuss as a teammate")) return { role: "assistant", content: `Agree mostly.\nVOTE: ${r.who === "security" ? "security" : "architect"}` };
      if (r.task.includes("Write the FINAL decision")) return { role: "assistant", content: `DECISION: follow the architect plan, add input validation (security's concern)\nASSIGNMENTS:\n- builder: implement the endpoint\n- tester: cover the validation\n- nobody: ignored` };
      return { role: "assistant", content: "?" };
    };
    const out = await council({ goal: "design the payments endpoint", experts: ["architect", "security", "tester"] });
    assert.match(out, /Votes: architect 2 · security 1 · tester 0 → the Architect's proposal/, out);
    assert.match(out, /DECISION: follow the architect plan/);
    assert.match(out, /- builder: implement the endpoint\n- tester: cover the validation/);

    const proposeReqs = requests.filter((r) => r.task.includes("propose how the TEAM"));
    assert.equal(proposeReqs.length, 3);
    for (const r of proposeReqs) assert.ok(r.tools.every((t) => !["write_file", "edit_file", "run_command"].includes(t)), `read-only: ${r.tools}`);
    const discussReqs = requests.filter((r) => r.task.includes("Discuss as a teammate"));
    assert.ok(discussReqs.every((r) => r.tools.length === 0));
    assert.ok(discussReqs.every((r) => r.task.includes("architect plan") && r.task.includes("security plan")), "everyone reads every proposal");
    assert.equal(requests.find((r) => r.task.includes("FINAL decision"))!.who, "architect", "the winner writes the decision");
    assert.ok(listNotes().some((n) => n.text.startsWith("Decision:")), "decision shared on the team board");
  });

  it("parses assignments and breaks vote ties by router order", () => {
    assert.deepEqual(parseAssignments("DECISION: x\nASSIGNMENTS:\n- Builder: do a\n* tester — do b\n- ghost: no"), [
      { expert: "builder", task: "do a" },
      { expert: "tester", task: "do b" },
    ]);
    assert.equal(tallyVotes(["api", "security"], ["VOTE: security", "VOTE: api"]).winner, "api");
  });
});

describe("Lead experts and workers", () => {
  it("a lead hands sub-tasks to workers who obey its rules, use only its tools, and can't lead", async () => {
    const call = (name: string, args: object) => ({ role: "assistant", tool_calls: [{ index: 0, id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    reply = (r) => {
      if (r.who === "builder") {
        return r.lastRole === "user"
          ? call("assign_workers", { rules: "Use 2-space indentation. Never touch tests.", tasks: [{ task: "create a.txt" }, { task: "create b.txt", tools: ["write_file", "run_command"] }] })
          : { role: "assistant", content: "Both parts done by my workers." };
      }
      if (r.who.startsWith("worker")) {
        const n = r.who.endsWith("1") ? "a" : "b";
        return r.lastRole === "user" ? call("write_file", { path: `${n}.txt`, content: n }) : { role: "assistant", content: `wrote ${n}.txt` };
      }
      return { role: "assistant", content: "?" };
    };
    const report = await runExpert(getExpert("builder")!, "build both parts", { autoApprove: () => true });
    assert.ok(fs.existsSync(path.join(tmp, "a.txt")) && fs.existsSync(path.join(tmp, "b.txt")));
    assert.equal(report.writes, 2, "workers' changes count toward the lead's verification");
    const workers = requests.filter((r) => r.who.startsWith("worker"));
    assert.ok(workers.every((w) => w.system.includes("Use 2-space indentation. Never touch tests.")), "rules reach every worker");
    assert.ok(workers.every((w) => !w.tools.includes("assign_workers")), "workers can't lead");
    const second = workers.find((w) => w.who === "worker 2")!;
    assert.ok(!second.tools.includes("edit_file") && second.tools.includes("write_file"), "a worker's tools can be narrowed");
    assert.ok(requests.some((r) => r.who === "builder" && r.tools.includes("assign_workers")), "every lead can assign workers");
  });
});
