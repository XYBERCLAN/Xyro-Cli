import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runWorkflow } from "../tools/delegate.js";
import { runExpert, setExpertSession } from "../agents/runtime.js";
import { getExpert } from "../agents/experts.js";
import { parseStages, getWorkflow } from "../agents/workflows.js";
import { setExpertModel, expertBudget } from "../agents/team-config.js";

type Handler = (who: string, body: { model: string; messages: { role: string }[] }) => { delta: object; usage?: object };
let handler: Handler = () => ({ delta: { role: "assistant", content: "ok" } });
const seen: { who: string; model: string }[] = [];
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      const who = ((j.messages[0].content as string).match(/You are XYRO's ([a-z-]+)/) ?? [])[1] ?? "?";
      if (j.messages[j.messages.length - 1].role === "user") seen.push({ who, model: j.model });
      const { delta, usage } = handler(who, j);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
      // Real providers send usage in a final chunk with an empty choices list
      if (usage) res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  setExpertSession(() => ({ baseURL: base, apiKey: "k", model: "session-model" }));
});
after(() => {
  server.close();
  setExpertSession(null);
});

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-team-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
  process.chdir(tmp);
  seen.length = 0;
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

describe("Token budgets", () => {
  it("stop a runaway expert and say why", async () => {
    // Every step asks for another tool call and reports 40k tokens used
    handler = () => ({
      delta: { role: "assistant", tool_calls: [{ index: 0, id: "t", type: "function", function: { name: "list_files", arguments: "{}" } }] },
      usage: { total_tokens: 40_000 },
    });
    assert.equal(expertBudget("scout"), 60_000);
    const r = await runExpert(getExpert("scout")!, "map everything");
    assert.equal(r.budgetHit, true);
    assert.equal(r.steps, 2, "stops once 60k is reached (2 × 40k)");
    assert.ok(r.output.includes("reached its token budget"));
    assert.equal(r.tokens, 80_000);
  });

  it("reads per-expert budgets from experts.json", () => {
    fs.mkdirSync(path.join(tmp, "cfg", "xyro"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "cfg", "xyro", "experts.json"), JSON.stringify({ budgets: { default: 30000, builder: 200000 } }));
    assert.equal(expertBudget("scout"), 30000);
    assert.equal(expertBudget("builder"), 200000);
  });
});

describe("Per-expert models", () => {
  it("an expert uses its assigned model; others keep the session model", async () => {
    handler = () => ({ delta: { role: "assistant", content: "done" } });
    setExpertModel("scout", { model: "tiny-fast-model" });
    await runExpert(getExpert("scout")!, "find x");
    await runExpert(getExpert("reviewer")!, "review x");
    assert.deepEqual(seen, [
      { who: "scout", model: "tiny-fast-model" },
      { who: "reviewer", model: "session-model" },
    ]);
  });
});

describe("Workflows", () => {
  it("parses numbered stages and parallel steps", () => {
    const stages = parseStages("1. architect: Plan {{goal}}\n2. tester: Test it || reviewer: Review it\nnot a step\n");
    assert.deepEqual(stages, [
      [{ expert: "architect", task: "Plan {{goal}}" }],
      [
        { expert: "tester", task: "Test it" },
        { expert: "reviewer", task: "Review it" },
      ],
    ]);
    assert.equal(getWorkflow("feature")!.stages.length, 4);
  });

  it("runs stages in order with verification, parallel steps together", async () => {
    // Debugger and tester change files (→ verified); review experts only read
    handler = (who, body) =>
      ["debugger", "tester"].includes(who) && body.messages[body.messages.length - 1].role === "user"
        ? { delta: { role: "assistant", tool_calls: [{ index: 0, id: `w-${who}`, type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: `${who}.ts`, content: "x" }) } }] } }
        : { delta: { role: "assistant", content: who === "verifier" ? "VERIFIED" : `${who} done` } };
    const out = await runWorkflow({ name: "bugfix", goal: "login crashes on empty email" });
    assert.deepEqual(seen.map((s) => s.who), ["debugger", "verifier", "tester", "verifier"]);
    assert.ok(out.includes("Stage 1: debugger") && out.includes("Stage 2: tester"));

    seen.length = 0;
    await runWorkflow({ name: "review", goal: "auth module" });
    assert.deepEqual(seen.map((s) => s.who).sort(), ["performance", "reviewer", "security"]);
  });

  it("loads custom workflows and lists them", async () => {
    fs.mkdirSync(path.join(tmp, ".xyro", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".xyro", "workflows", "ship.md"), "---\nname: ship\ndescription: Test then commit\n---\n1. tester: run tests\n2. git: commit\n");
    const list = await runWorkflow({ name: "list" });
    assert.ok(list.includes("ship (project): Test then commit") && list.includes("1. tester → 2. git"));
  });
});
