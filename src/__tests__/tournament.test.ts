import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { tournament, rank, Score, withTournamentWorktrees } from "../agents/tournament.js";
import { setExpertSession } from "../agents/runtime.js";
import { createWorktree, mergeWorktree, removeWorktree } from "../agents/worktree.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { _resetPool } from "../providers/pool.js";
import { beginTurn, cancelTurn } from "../agent/cancel.js";

// The fake provider answers per model: what each contestant writes
let plan: Record<string, string | { path: string; content: string } | null> = {};
const called: string[] = [];
let server: http.Server;
let url = "";
let savedGoogle = "";
let stopTournament = false;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      const last = j.messages[j.messages.length - 1];
      called.push(j.model);
      const p = plan[j.model];
      if (stopTournament) cancelTurn();
      const file = typeof p === "string" ? { path: "answer.txt", content: p } : p;
      const delta = last.role === "user" && file
          ? { role: "assistant", tool_calls: [{ index: 0, id: "w", type: "function", function: { name: "write_file", arguments: JSON.stringify(file) } }] }
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
let oldAppData: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-tourney-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  oldAppData = process.env.APPDATA;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  process.env.APPDATA = path.join(tmp, ".cfg");
  process.chdir(tmp);
  _resetPool();
  called.length = 0;
  stopTournament = false;
  beginTurn();
  execSync("git init -q && git config user.email t@t && git config user.name t && echo start > answer.txt && echo '.cfg/' > .gitignore && git add . && git commit -qm init", { cwd: tmp });
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  if (oldAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = oldAppData;
});

const worktrees = () => execSync("git worktree list", { cwd: tmp }).toString().trim().split("\n").length;

describe("Tournament", () => {
  it("reports cleanup failure after applying a worktree", async () => {
    const tree = (await createWorktree("locked", tmp))!;
    fs.writeFileSync(path.join(tree.path, "answer.txt"), "merged");
    execSync(`git worktree lock "${tree.path}"`, { cwd: tmp });
    try {
      const result = await mergeWorktree(tree, tmp);
      assert.equal(result.applied, true);
      assert.match(result.warning ?? "", /Could not clean/);
      assert.equal(fs.readFileSync(path.join(tmp, "answer.txt"), "utf8"), "merged");
    } finally {
      execSync(`git worktree unlock "${tree.path}"`, { cwd: tmp });
      await removeWorktree(tree, tmp);
    }
  });

  it("reports cleanup errors without replacing a successful result", async () => {
    const warnings: string[] = [];
    const tree = { path: path.join(tmp, "missing-tree"), branch: "missing", base: "HEAD" };
    const result = await withTournamentWorktrees(path.join(tmp, "missing-root"), [tree], new Set(), new Map(), async () => "merged", warnings);
    assert.equal(result, "merged");
    assert.match(warnings.join(" "), /Could not clean/);
  });

  it("cleans created worktrees if judging or merging throws", async () => {
    const first = (await createWorktree("first", tmp))!;
    const second = (await createWorktree("second", tmp))!;
    await assert.rejects(withTournamentWorktrees(tmp, [first, second], new Set(), new Map(), async () => {
      throw new Error("judge failed");
    }), /judge failed/);
    assert.equal(worktrees(), 1);
    assert.equal(execSync("git branch --list xyro/*", { cwd: tmp }).toString().trim(), "");
  });

  it("does not remove a worktree while its stopped tool is still running", async () => {
    const tree = (await createWorktree("pending", tmp))!;
    let finish!: () => void;
    const outstanding = new Promise<void>((resolve) => { finish = resolve; });
    await withTournamentWorktrees(tmp, [tree], new Set(), new Map([[tree, outstanding]]), async () => {});
    assert.ok(fs.existsSync(tree.path));
    finish();
    for (let i = 0; i < 100 && fs.existsSync(tree.path); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fs.existsSync(tree.path), false);
    assert.equal(worktrees(), 1);
  });

  it("cleans all worktrees when the user stops the tournament", async () => {
    plan = { "gemini-flash-latest": "first", "gemini-3.5-flash": "second" };
    stopTournament = true;
    const result = await tournament({ task: "write", check: "echo ok", expert: "builder", contestants: 2 });
    assert.match(result, /stopped by the user/i);
    assert.equal(worktrees(), 1);
    assert.equal(execSync("git branch --list xyro/*", { cwd: tmp }).toString().trim(), "");
  });

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
  it("removes a real dependency directory that replaced a link", async () => {
    fs.mkdirSync(path.join(tmp, "node_modules"));
    fs.appendFileSync(path.join(tmp, ".gitignore"), "node_modules/\n");
    const wt = (await createWorktree("deps-real", tmp))!;
    fs.unlinkSync(path.join(wt.path, "node_modules"));
    fs.mkdirSync(path.join(wt.path, "node_modules"));
    fs.writeFileSync(path.join(wt.path, "node_modules", "local"), "local");
    await removeWorktree(wt, tmp);
    assert.ok(!fs.existsSync(wt.path));
    assert.ok(fs.existsSync(path.join(tmp, "node_modules")));
  });

  it("keeps a worktree if its dependency link points somewhere unexpected", async () => {
    fs.mkdirSync(path.join(tmp, "node_modules"));
    fs.appendFileSync(path.join(tmp, ".gitignore"), "node_modules/\n");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-other-deps-"));
    fs.writeFileSync(path.join(outside, "keep"), "keep");
    const wt = (await createWorktree("deps-changed", tmp))!;
    const link = path.join(wt.path, "node_modules");
    fs.unlinkSync(link);
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(removeWorktree(wt, tmp), /dependency link changed/);
    assert.ok(fs.existsSync(path.join(outside, "keep")));
    assert.ok(fs.existsSync(wt.path));
    fs.unlinkSync(link);
    await removeWorktree(wt, tmp);
  });

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

describe("Tournament safety", () => {
  it("an attempt that edits what the tests run is never executed, by the contestant or the judge", async () => {
    const marker = path.join(tmp, "planted-ran");
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    execSync("git add . && git commit -qm pkg", { cwd: tmp });
    // One contestant plants a test script; the other solves the task honestly
    plan = {
      "gemini-flash-latest": { path: "package.json", content: JSON.stringify({ scripts: { test: `touch "${marker}"` } }) },
      "gemini-3.5-flash": "the correct answer",
      "gemini-3.6-flash": null,
    };
    const out = await tournament({ task: "x", check: "npm test --silent && grep -q correct answer.txt || grep -q correct answer.txt", expert: "builder", contestants: 2 });
    assert.ok(!fs.existsSync(marker), "the planted script never ran");
    assert.match(out, /changed package\.json, which controls what runs/, out);
    assert.match(out, /WINNER gemini-3\.5-flash/, out);
  });

  it("knows which files control what runs", async () => {
    const { touchesControlFiles } = await import("../agents/tournament.js");
    assert.deepEqual(
      touchesControlFiles(["src/a.ts", "package.json", "vitest.config.ts", "tests/conftest.py", ".xyro/intents.json", "docs/config.md"]),
      ["package.json", "vitest.config.ts", "tests/conftest.py", ".xyro/intents.json"]
    );
  });
});

describe("Path confinement follows symlinks", () => {
  it("refuses writes that leave the project through a symlink", async () => {
    const { resolveProjectPath } = await import("../tools/safety.js");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-outside-"));
    fs.symlinkSync(outside, path.join(tmp, "linked"), "dir");
    fs.mkdirSync(path.join(tmp, "real"));
    fs.symlinkSync(path.join(tmp, "real"), path.join(tmp, "inner-link"), "dir");
    assert.equal(resolveProjectPath("linked/evil.js").ok, false);
    assert.equal(resolveProjectPath("linked/new/dir/evil.js").ok, false, "not-yet-existing files are checked via their nearest real folder");
    assert.equal(resolveProjectPath("inner-link/ok.js").ok, true, "links that stay inside are fine");
    assert.equal(resolveProjectPath("src/new-file.ts").ok, true);
  });
});
