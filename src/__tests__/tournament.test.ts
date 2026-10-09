import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { tournament, rank, Score } from "../agents/tournament.js";
import { setExpertSession } from "../agents/runtime.js";
import { createWorktree, removeWorktree } from "../agents/worktree.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { _resetPool } from "../providers/pool.js";

// The fake provider answers per model: what each contestant writes
let plan: Record<string, string | null> = {};
const called: string[] = [];
let server: http.Server;
let url = "";
let savedGoogle = "";

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      const last = j.messages[j.messages.length - 1];
      called.push(j.model);
      const content = plan[j.model];
      const delta =
        last.role === "user" && content !== null && content !== undefined
          ? { role: "assistant", tool_calls: [{ index: 0, id: "w", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "answer.txt", content }) } }] }
          : { role: "assistant", content: "done" };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const g = FREE_PROVIDERS.find((p) => p.id === "google")!;
  savedGoogle = g.baseURL;
  g.baseURL = url; // the session is "on google", so its free models compete
  setExpertSession(() => ({ baseURL: url, apiKey: "k", model: "gemini-flash-latest" }));
});
after(() => {
  server.close();
  FREE_PROVIDERS.find((p) => p.id === "google")!.baseURL = savedGoogle;
  setExpertSession(null);
});

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-tourney-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  process.chdir(tmp);
  _resetPool();
  called.length = 0;
  execSync("git init -q && git config user.email t@t && git config user.name t && echo start > answer.txt && echo '.cfg/' > .gitignore && git add . && git commit -qm init", { cwd: tmp });
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

const worktrees = () => execSync("git worktree list", { cwd: tmp }).toString().trim().split("\n").length;

describe("Tournament", () => {
  it("runs models in parallel, judges locally, merges only the winner and remembers it", async () => {
    plan = { "gemini-flash-latest": "wrong answer", "gemini-3.5-flash": "the correct answer", "gemini-3.6-flash": null };
    const out = await tournament({ task: "write the correct answer", check: "grep -q correct answer.txt", expert: "builder" });
    assert.match(out, /1\. WINNER gemini-3\.5-flash/, out);
    assert.match(out, /check FAILED/);
    assert.match(out, /made no changes/);
    assert.equal(fs.readFileSync(path.join(tmp, "answer.txt"), "utf-8"), "the correct answer");
    assert.equal(worktrees(), 1, "all worktrees cleaned up");
    assert.ok(new Set(called).size >= 3, "every contestant ran");
    const records = JSON.parse(fs.readFileSync(path.join(tmp, ".cfg", "xyro", "tournaments.json"), "utf-8"));
    assert.equal(records["gemini-3.5-flash"].wins, 1);
    assert.equal(records["gemini-flash-latest"].wins, 0);
  });

  it("merges nothing when no attempt passes, and keeps the closest one aside", async () => {
    plan = { "gemini-flash-latest": "nope", "gemini-3.5-flash": "still nope", "gemini-3.6-flash": "no" };
    const out = await tournament({ task: "x", check: "grep -q correct answer.txt", expert: "builder", contestants: 2 });
    assert.match(out, /nothing was merged/, out);
    assert.equal(fs.readFileSync(path.join(tmp, "answer.txt"), "utf-8"), "start\n");
    assert.equal(worktrees(), 2, "only the closest attempt is kept");
  });

  it("refuses without an objective judge", async () => {
    const out = await tournament({ task: "make it nicer" });
    assert.match(out, /needs an objective judge/);
  });

  it("ranks: passing check, then fewer broken intents, failures, type errors, then smaller diff", () => {
    const s = (o: Partial<Score>): Score => ({ contestant: { model: "m", providerId: "p" }, changed: ["a"], diffLines: 10, checkPassed: true, testsPassed: null, testsFailed: null, intentsBroken: 0, typeErrors: null, checkTail: "", ...o });
    const a = s({ checkPassed: false, diffLines: 1 });
    const b = s({ diffLines: 50 });
    const c = s({ diffLines: 5 });
    const d = s({ changed: [], diffLines: 0 });
    const e = s({ intentsBroken: 1, diffLines: 2 });
    assert.deepEqual(rank([a, b, c, d, e]), [c, b, e, a, d]);
  });
});

describe("Worktree dependencies", () => {
  it("links ignored dependency folders and never stages them", async () => {
    fs.mkdirSync(path.join(tmp, "node_modules", "lib"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", "lib", "index.js"), "1");
    fs.appendFileSync(path.join(tmp, ".gitignore"), "node_modules/\n");
    execSync("git add .gitignore && git commit -qm ignore", { cwd: tmp });
    const wt = (await createWorktree("deps", tmp))!;
    assert.ok(fs.existsSync(path.join(wt.path, "node_modules", "lib", "index.js")), "dependencies available in the worktree");
    execSync("git add -A", { cwd: wt.path });
    assert.ok(!execSync("git diff --cached --name-only " + wt.base, { cwd: wt.path }).toString().includes("node_modules"));
    await removeWorktree(wt, tmp);
    assert.ok(fs.existsSync(path.join(tmp, "node_modules", "lib", "index.js")), "removing the worktree leaves the real folder alone");
  });
});
