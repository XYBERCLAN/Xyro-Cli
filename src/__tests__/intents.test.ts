import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveIntent, listIntents, runIntents, removeIntent, intentsTrust, trustIntents, intentsPath, intentsPrompt } from "../agent/intents.js";
import { Agent } from "../agent/loop.js";

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-intents-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  process.env.XYRO_NO_POOL = "1";
  process.chdir(tmp);
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  delete process.env.XYRO_NO_POOL;
});

describe("Intent guard: saving and checking", () => {
  it("validates what it saves", () => {
    assert.ok(saveIntent({ said: "" }).startsWith("❌"));
    assert.ok(saveIntent({ said: "x" }).startsWith("❌"), "needs a check");
    assert.ok(saveIntent({ said: "x", command: "true", file: "a", pattern: "b" }).startsWith("❌"), "one kind of check");
    assert.ok(saveIntent({ said: "x", command: "rm -rf /" }).includes("dangerous"));
    assert.ok(saveIntent({ said: "x", file: "../../etc/passwd", pattern: "root" }).includes("outside the project"));
    assert.ok(saveIntent({ said: "x", file: "a.ts", pattern: "(" }).includes("not a valid"));
    assert.equal(listIntents().length, 0);
  });

  it("pattern checks pass, fail and catch forbidden code", async () => {
    fs.writeFileSync("auth.ts", "if (!password) throw new Error('empty');\n");
    saveIntent({ said: "login rejects empty passwords", file: "auth.ts", pattern: "if \\(!password\\)" });
    saveIntent({ said: "never log the API key", file: "auth.ts", pattern: "console\\.log\\(.*apiKey", absent: true });
    assert.deepEqual((await runIntents()).map((r) => r.ok), [true, true]);

    fs.writeFileSync("auth.ts", "console.log(apiKey);\n");
    const r = await runIntents();
    assert.deepEqual(r.map((x) => x.ok), [false, false]);
    assert.match(r[0].detail, /expected pattern missing/);
    assert.match(r[1].detail, /forbidden pattern found/);
  });

  it("command checks run when XYRO saved them, and are skipped after an outside edit until trusted", async () => {
    saveIntent({ said: "marker file exists", command: "test -f marker" });
    assert.equal(intentsTrust(), "trusted", "XYRO trusts what it saved after approval");
    let [r] = await runIntents();
    assert.equal(r.ok, false);
    fs.writeFileSync("marker", "");
    [r] = await runIntents();
    assert.equal(r.ok, true);

    // Someone (a git pull, the model via write_file) changes the file
    const p = intentsPath();
    fs.writeFileSync(p, fs.readFileSync(p, "utf-8").replace("test -f marker", "test -f nope"));
    assert.equal(intentsTrust(), "untrusted");
    [r] = await runIntents();
    assert.ok(r.skipped, "untrusted commands never run");
    saveIntent({ said: "another", file: "marker", pattern: "" });
    assert.equal(intentsTrust(), "untrusted", "saving does not launder an outside edit");
    assert.ok(trustIntents());
    [r] = await runIntents();
    assert.equal(r.ok, false);
  });

  it("removes intents and lists them in the prompt", () => {
    saveIntent({ said: "keep dark mode default", file: "x", pattern: "dark" });
    assert.match(intentsPrompt(), /i1: keep dark mode default/);
    assert.ok(removeIntent("i1").startsWith("✅"));
    assert.ok(removeIntent("i1").startsWith("❌"));
    assert.equal(listIntents().length, 0);
  });
});

describe("Intent guard in the agent loop", () => {
  let server: http.Server;
  let url = "";
  const seen: string[] = [];
  let step = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const j = JSON.parse(body);
        const last = j.messages[j.messages.length - 1];
        seen.push(`${last.role}:${String(last.content ?? "").slice(0, 60)}`);
        const call = (args: object) => ({ role: "assistant", tool_calls: [{ index: 0, id: `c${step}`, type: "function", function: { name: "write_file", arguments: JSON.stringify(args) } }] });
        const replies = [
          // 1. the change the user asked for, which drops the empty-password check
          call({ path: "auth.ts", content: "export const login = (u, p) => true;\n" }),
          { role: "assistant", content: "Done." },
          // 2. after the guard reports the break, fix it
          call({ path: "auth.ts", content: "export const login = (u, p) => { if (!password) return false; return true; };\n" }),
          { role: "assistant", content: "Fixed the empty password check." },
        ];
        const delta = replies[Math.min(step++, replies.length - 1)];
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  after(() => server.close());

  it("re-checks after a change, sends the break back, and the model repairs it", async () => {
    fs.writeFileSync("auth.ts", "export const login = (u, p) => { if (!password) return false; return true; };\n");
    saveIntent({ said: "login rejects empty passwords", file: "auth.ts", pattern: "if \\(!password\\)" });
    const notices: string[] = [];
    const agent = new Agent({ baseURL: url, apiKey: "k", model: "fake" });
    agent.setOutputAdapter({ requestPermission: async () => true, onNotice: (t) => notices.push(t) });
    await agent.run("simplify login");

    assert.ok(seen.some((s) => s.startsWith("user:[intent guard]")), seen.join("\n"));
    assert.match(fs.readFileSync("auth.ts", "utf-8"), /if \(!password\)/);
    assert.deepEqual(notices, ["Intent guard: 1 requirement broke, fixing"], "checked once per turn");
    assert.equal(step, 4);
  });
});
