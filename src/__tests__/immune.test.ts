import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { delegate, heal } from "../tools/delegate.js";
import { setExpertSession } from "../agents/runtime.js";
import { scanText, scanFiles } from "../agents/sentinel.js";
import { getExpert, getExperts } from "../agents/experts.js";

// A fake model: replies depend on which expert is asking (read from the system prompt)
type Reply = (who: string, lastRole: string, verifierCalls: number) => object;
let reply: Reply = () => ({ role: "assistant", content: "ok" });
let verifierCalls = 0;
const seen: string[] = [];
let server: http.Server;
let base = "";

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      const sys: string = j.messages[0].content;
      const who = (sys.match(/You are XYRO's ([a-z-]+)/) ?? [])[1] ?? "unknown";
      const last = j.messages[j.messages.length - 1];
      if (last.role === "user") {
        seen.push(who);
        if (who === "verifier") verifierCalls++;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: reply(who, last.role, verifierCalls) }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  setExpertSession(() => ({ baseURL: base, apiKey: "k", model: "fake" }));
});
after(() => {
  server.close();
  setExpertSession(null);
});

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-immune-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
  process.chdir(tmp);
  seen.length = 0;
  verifierCalls = 0;
});
afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

describe("Immune response: verification + escalation", () => {
  it("verifies writer work, escalates when verification fails, and verifies again", async () => {
    reply = (who, role, vc) =>
      who === "verifier"
        ? { role: "assistant", content: vc === 1 ? "NOT VERIFIED: the function still returns undefined" : "VERIFIED — returns the sum now" }
        : role === "user"
          ? { role: "assistant", tool_calls: [{ index: 0, id: `w-${who}`, type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: `${who}.ts`, content: "export const add = (a: number, b: number) => a + b;" }) } }] }
          : { role: "assistant", content: `${who} report: implemented the change` };
    const out = await delegate({ task: "implement add()", expert: "builder" });
    assert.deepEqual(seen, ["builder", "verifier", "debugger", "verifier"]);
    assert.ok(out.includes("Debugger") && out.includes("escalated (level 1)"), out);
    assert.ok(out.includes("VERIFIED — returns the sum now"));
  });

  it("work that changed no files is not sent to verification", async () => {
    reply = (who) => ({ role: "assistant", content: `${who} report` });
    await delegate({ task: "where is the config loaded?", expert: "scout" });
    assert.deepEqual(seen, ["scout"]);
  });

  it("verify:false and escalate:false turn the chain off", async () => {
    reply = (who, role) =>
      role === "user"
        ? { role: "assistant", tool_calls: [{ index: 0, id: "w", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "x.ts", content: "x" }) } }] }
        : { role: "assistant", content: `${who} report` };
    await delegate({ task: "implement x", expert: "builder", verify: false });
    assert.deepEqual(seen, ["builder"]);
  });
});

describe("heal", () => {
  it("runs tests, lets the healer fix the cause, and re-runs until green", async () => {
    reply = (who, role) =>
      who === "healer" && role === "user"
        ? { role: "assistant", tool_calls: [{ index: 0, id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "fixed.txt", content: "ok" }) } }] }
        : { role: "assistant", content: "fixed the missing file" };
    const out = await heal({ command: "test -f fixed.txt", max_rounds: 2 });
    assert.ok(out.startsWith("Healed in 1 round"), out);
    assert.ok(fs.existsSync(path.join(tmp, "fixed.txt")));
  });
});

describe("Sentinel", () => {
  it("catches leaked keys and masks them", () => {
    const f = scanText("cfg.ts", 'const k = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";\nconst aws = "AKIAABCDEFGHIJKLMNOP";');
    assert.deepEqual(f.map((x) => x.kind), ["OpenAI-style API key", "AWS access key"]);
    assert.ok(!f[0].excerpt.includes("abcdefghijklmnopqrstuvwxyz"), "secret is masked");
  });

  it("ignores placeholders and env lookups", () => {
    assert.equal(scanText("a.ts", 'const key = process.env.OPENAI_API_KEY;\napiKey = "your-api-key-here-xxxx"').length, 0);
  });

  it("flags conflict markers and un-ignored .env files", () => {
    fs.writeFileSync(".env", "TOKEN=1");
    fs.writeFileSync("m.ts", "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n");
    const kinds = scanFiles([path.join(tmp, ".env"), path.join(tmp, "m.ts")], tmp).map((x) => x.kind);
    assert.ok(kinds.includes(".env file not ignored by git"));
    assert.equal(kinds.filter((k) => k === "merge conflict marker").length, 3);
  });
});

describe("Team roster", () => {
  it("has the expanded team with unique names", () => {
    const names = getExperts().map((e) => e.name);
    for (const n of ["refactorer", "performance", "devops", "dependencies", "database", "frontend", "api", "migrator", "critic", "explainer", "verifier", "sentinel", "healer", "memory-keeper"]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    assert.equal(new Set(names).size, names.length);
    assert.ok(!getExpert("verifier")!.tools.includes("write_file"), "verifier is read-only");
  });
});
