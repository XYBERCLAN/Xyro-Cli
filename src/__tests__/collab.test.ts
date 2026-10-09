import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { delegateTeam } from "../tools/delegate.js";
import { setExpertSession } from "../agents/runtime.js";
import { executeTool } from "../tools/registry.js";
import { clearNotes, listNotes } from "../agents/team-board.js";
import { bgStart, bgOutput, bgStop } from "../tools/background.js";
import { parseDuckDuckGo } from "../tools/websearch.js";
import { runInWorkspace, workspaceRoot } from "../agent/workspace.js";
import { resolveProjectPath } from "../tools/safety.js";

type Reply = (who: string, lastRole: string, lastContent: string) => object;
let reply: Reply = () => ({ role: "assistant", content: "ok" });
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      const who = ((j.messages[0].content as string).match(/You are XYRO's ([a-z-]+)/) ?? [])[1] ?? "?";
      const last = j.messages[j.messages.length - 1];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: reply(who, last.role, String(last.content ?? "")) }] })}\n\n`);
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-collab-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
  process.chdir(tmp);
  clearNotes();
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

const call = (name: string, args: object) => ({ role: "assistant", tool_calls: [{ index: 0, id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

describe("Worktree isolation for parallel writers", () => {
  it("each writer edits its own checkout; both changes merge back; user's uncommitted work survives", async () => {
    execSync("git init -q && git config user.email t@t && git config user.name t && echo base > base.txt && git add . && git commit -qm init", { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "base.txt"), "base + my uncommitted edit\n");

    const cwdsSeen: string[] = [];
    reply = (who, role) => {
      if (role === "user") {
        cwdsSeen.push(workspaceRoot());
        return call("write_file", { path: `${who}.txt`, content: `written by ${who}` });
      }
      return { role: "assistant", content: `${who} done` };
    };
    const out = await delegateTeam({
      tasks: [
        { task: "build part one", expert: "builder", verify: false },
        { task: "refactor part two", expert: "refactorer", verify: false },
      ],
    });
    assert.ok(out.includes("separate git worktrees"), out);
    assert.equal(fs.readFileSync(path.join(tmp, "builder.txt"), "utf-8"), "written by builder");
    assert.equal(fs.readFileSync(path.join(tmp, "refactorer.txt"), "utf-8"), "written by refactorer");
    assert.equal(fs.readFileSync(path.join(tmp, "base.txt"), "utf-8"), "base + my uncommitted edit\n");
    assert.ok(out.includes("merged 1 file"), out);
    assert.equal(execSync("git worktree list", { cwd: tmp }).toString().trim().split("\n").length, 1, "worktrees cleaned up");
    assert.equal(execSync("git branch --list 'xyro/*'", { cwd: tmp }).toString().trim(), "", "temp branches removed");
  });

  it("a single writer works in place (no worktree overhead)", async () => {
    execSync("git init -q && git config user.email t@t && git config user.name t && echo a > a.txt && git add . && git commit -qm init", { cwd: tmp });
    reply = (who, role) => (role === "user" ? call("write_file", { path: "solo.txt", content: "solo" }) : { role: "assistant", content: "done" });
    const out = await delegateTeam({ tasks: [{ task: "build it", expert: "builder", verify: false }, { task: "where is a.txt?", expert: "scout" }] });
    assert.ok(!out.includes("worktrees"), out);
    assert.ok(fs.existsSync(path.join(tmp, "solo.txt")));
  });
});

describe("Team board", () => {
  it("experts sign their notes and teammates can read them", async () => {
    reply = (who, role, content) => {
      if (who === "architect" && role === "user") return call("team_note", { note: "Auth now lives in src/auth/session.ts" });
      return { role: "assistant", content: `${who} done ${content.slice(0, 10)}` };
    };
    await delegateTeam({ tasks: [{ task: "design the auth change", expert: "architect" }] });
    assert.deepEqual(listNotes().map((n) => [n.author, n.text]), [["Architect", "Auth now lives in src/auth/session.ts"]]);
    assert.ok((await executeTool("team_notes", {})).includes("Architect: Auth now lives"));
  });
});

describe("Background jobs", () => {
  it("start, read output, stop", async () => {
    const start = await bgStart({ command: "echo server-ready; sleep 30", name: "dev" });
    assert.ok(start.includes("Started background job") && start.includes("server-ready"), start);
    const id = Number(start.match(/#(\d+)/)![1]);
    assert.ok((await bgOutput({ id })).includes("running"));
    assert.ok((await bgStop({ id })).startsWith(`Stopped job #${id}`));
  });

  it("refuses dangerous commands", async () => {
    assert.ok((await bgStart({ command: "rm -rf /" })).includes("Refused"));
  });
});

describe("Workspace root", () => {
  it("path resolution follows the task's workspace, even concurrently", async () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "ws-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "ws-b-"));
    const [ra, rb] = await Promise.all([
      runInWorkspace(a, async () => (await new Promise((r) => setTimeout(r, 20)), resolveProjectPath("x.txt"))),
      runInWorkspace(b, async () => resolveProjectPath("x.txt")),
    ]);
    assert.ok(ra.ok && rb.ok);
    assert.equal(ra.ok && ra.path, path.join(a, "x.txt"));
    assert.equal(rb.ok && rb.path, path.join(b, "x.txt"));
    assert.ok(!resolveProjectPath(path.join(a, "x.txt")).ok || workspaceRoot() !== a, "outside a workspace, other dirs stay off-limits");
  });
});

describe("web_search parsing", () => {
  it("extracts DuckDuckGo results and unwraps redirect links", () => {
    const html = `<div class="result results_links"><div class="result__body">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fdocs&amp;rut=x">Node.js <b>Docs</b></a>
      <a class="result__snippet" href="#">Official &amp; current documentation</a></div></div>`;
    assert.deepEqual(parseDuckDuckGo(html, 5), [{ title: "Node.js Docs", url: "https://nodejs.org/docs", snippet: "Official & current documentation" }]);
  });
});
