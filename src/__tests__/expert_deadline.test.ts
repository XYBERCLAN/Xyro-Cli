import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { beginTurn, cancelTurn } from "../agent/cancel.js";
import { getExpert } from "../agents/experts.js";
import { runExpert, setExpertSession } from "../agents/runtime.js";
import { workspaceRoot } from "../agent/workspace.js";
import { delegateTeam } from "../tools/delegate.js";
import { registerExternalTools, unregisterExternalTools } from "../tools/registry.js";

let server: http.Server;
let baseURL: string;
let toolStarted: (() => void) | undefined;
let finishTool: (() => void) | undefined;
let toolRoot = "";

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const request = JSON.parse(body);
      if (request.model === "hung") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": waiting\n\n");
        return;
      }
      const delta = request.model === "approval"
        ? { tool_calls: [{ index: 0, id: "t", type: "function", function: { name: "write_file", arguments: '{"path":"test.txt","content":"test"}' } }] }
        : request.model === "tool"
        ? { tool_calls: [{ index: 0, id: "t", type: "function", function: { name: "deadline_test_tool", arguments: "{}" } }] }
        : { content: "done" };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  registerExternalTools([{
    definition: { type: "function", function: { name: "deadline_test_tool", description: "test", parameters: { type: "object", properties: {} } } },
    execute: async () => {
      toolRoot = workspaceRoot();
      toolStarted?.();
      await new Promise<void>((resolve) => { finishTool = resolve; });
      return "done";
    },
  }], { mainVisible: true });
});

after(() => {
  finishTool?.();
  unregisterExternalTools("deadline_test_");
  server.closeAllConnections();
  server.close();
});

const expert = { ...getExpert("scout")!, tools: ["deadline_test_tool"] };
const session = (model: string) => ({ baseURL, apiKey: "test", model });

describe("expert cancellation", () => {
  it("stops a stalled stream without cancelling a parallel expert", async () => {
    beginTurn();
    const [slow, fast] = await Promise.all([
      runExpert(expert, "slow", { session: session("hung"), timeoutMs: 300 }),
      runExpert(expert, "fast", { session: session("fast"), timeoutMs: 3000 }),
    ]);
    assert.equal(slow.timedOut, true);
    assert.equal(slow.ok, false);
    assert.match(slow.output, /deadline exceeded/i);
    assert.equal(fast.ok, true);
    assert.equal(fast.output, "done");
  });

  it("returns on a stuck tool but exposes its eventual completion for cleanup", async () => {
    beginTurn();
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    const run = runExpert(expert, "tool", { session: session("tool"), timeoutMs: 500, autoApprove: () => true });
    await started;
    const report = await run;
    assert.equal(report.timedOut, true);
    assert.ok(report.pending);
    let settled = false;
    void report.pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    finishTool!();
    await report.pending;
    assert.equal(settled, true);
  });

  it("tracks an approval callback that is still using the workspace after timeout", async () => {
    beginTurn();
    let finishApproval!: () => void;
    let approvalStarted!: () => void;
    const started = new Promise<void>((resolve) => { approvalStarted = resolve; });
    const run = runExpert({ ...expert, tools: ["write_file"] }, "tool", {
      session: session("approval"),
      timeoutMs: 500,
      autoApprove: async () => {
        approvalStarted();
        await new Promise<void>((resolve) => { finishApproval = resolve; });
        return true;
      },
    });
    await started;
    const report = await run;
    assert.equal(report.timedOut, true);
    assert.ok(report.pending);
    let settled = false;
    void report.pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    finishApproval();
    await report.pending;
    assert.equal(settled, true);
  });

  it("returns when the user stops a stalled stream", async () => {
    beginTurn();
    const run = runExpert(expert, "stop", { session: session("hung"), timeoutMs: 3000 });
    setTimeout(cancelTurn, 200);
    const report = await run;
    assert.equal(report.ok, false);
    assert.equal(report.timedOut, false);
    assert.match(report.output, /stopped/i);
    beginTurn();
  });

  it("does not merge a team worktree while a stopped tool is still using it", async () => {
    const root = mkdtempSync(join(tmpdir(), "xyro-team-deadline-"));
    const cwd = process.cwd();
    const oldApproval = process.env.XYRO_NO_APPROVE;
    const builder = getExpert("builder")!;
    try {
      for (const args of [["init", "-q"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "test"]]) execFileSync("git", args, { cwd: root });
      writeFileSync(join(root, "tracked.txt"), "base");
      execFileSync("git", ["add", "tracked.txt"], { cwd: root });
      execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
      process.chdir(root);
      process.env.XYRO_NO_APPROVE = "1";
      builder.tools.push("deadline_test_tool");
      setExpertSession(() => session("tool"));
      beginTurn();
      const started = new Promise<void>((resolve) => { toolStarted = resolve; });
      const run = delegateTeam({ tasks: [{ task: "first", expert: "builder" }, { task: "second", expert: "builder" }] });
      await started;
      cancelTurn();
      const result = await run;
      assert.match(result, /Worktree kept at/);
      assert.ok(existsSync(toolRoot));
      finishTool!();
    } finally {
      builder.tools = builder.tools.filter((name) => name !== "deadline_test_tool");
      setExpertSession(null);
      if (oldApproval === undefined) delete process.env.XYRO_NO_APPROVE;
      else process.env.XYRO_NO_APPROVE = oldApproval;
      process.chdir(cwd);
      beginTurn();
    }
  });
});
