import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  classifyMessage, recordEvent, readJournal, reflect, reflectionDue, readProfile, profilePrompt, readLessons, forgetEverything, projectKey, LearnEvent,
} from "../agent/learning.js";
import { findSkill } from "../agents/skills-catalog.js";
import { Agent } from "../agent/loop.js";

let tmp: string;
let oldCwd: string;
const oldEnv = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-learn-"));
  process.env.HOME = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  process.env.XYRO_NO_POOL = "1";
  oldCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(() => {
  process.chdir(oldCwd);
  process.env.HOME = oldEnv.HOME;
  if (oldEnv.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldEnv.XDG;
  delete process.env.XYRO_NO_POOL;
  delete process.env.XYRO_LEARN;
});

const journalFile = () => path.join(tmp, ".cfg", "xyro", "learning", "journal.jsonl");
/** Events from an earlier session, written straight to the journal. */
function pastEvents(session: string, events: Partial<LearnEvent>[]): LearnEvent[] {
  fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
  const full = events.map((e, i) => ({ id: `${session}-${i + 1}`, at: new Date().toISOString(), project: projectKey(), session, kind: "request", ...e }) as LearnEvent);
  fs.appendFileSync(journalFile(), full.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return full;
}

describe("Learning: observing", () => {
  it("tells corrections and praise from ordinary requests", () => {
    for (const t of ["no, use pnpm", "don't touch the tests", "I said tabs", "use vitest instead", "why did you delete that?", "that's not what I asked"]) assert.equal(classifyMessage(t), "correction", t);
    for (const t of ["thanks!", "perfect", "great, ship it", "it works"]) assert.equal(classifyMessage(t), "praise", t);
    for (const t of ["add a login page", "now write the tests", "notice the bug in auth"]) assert.equal(classifyMessage(t), null, t);
  });

  it("never writes secrets to the journal", () => {
    recordEvent({ kind: "request", text: "use key sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4 for the api" });
    const [e] = readJournal();
    assert.ok(!e.text!.includes("A1b2C3d4"), e.text);
  });

  it("XYRO_LEARN=off records nothing", () => {
    process.env.XYRO_LEARN = "off";
    recordEvent({ kind: "request", text: "hello there" });
    assert.equal(readJournal().length, 0);
  });
});

describe("Learning: reflection keeps only what the evidence supports", () => {
  it("profile needs 2 real events; lessons need a recovered error or correction; skills need 2 sessions", async () => {
    const a = pastEvents("s1", [
      { kind: "correction", text: "no, use pnpm not npm" },
      { kind: "recovered", tool: "run_command", detail: "failed: npm install → worked with: pnpm install" },
      { kind: "request", text: "add an endpoint for invoices", category: "api" },
      { kind: "praise", text: "perfect" },
    ]);
    const b = pastEvents("s2", [
      { kind: "correction", text: "I said pnpm" },
      { kind: "request", text: "add an endpoint for refunds", category: "api" },
      { kind: "praise", text: "great" },
    ]);
    let seen = "";
    const proposal = {
      profile: [
        { text: "Uses pnpm, never npm", evidence: [a[0].id, b[0].id] },
        { text: "Likes long explanations", evidence: [a[2].id] },
        { text: "Invented preference", evidence: ["nope-1", "nope-2"] },
      ],
      lessons: [
        { text: "Install with pnpm install; npm install fails in this repo", evidence: [a[1].id] },
        { text: "Use clean code", evidence: [] },
      ],
      skills: [
        {
          name: "add-api-endpoint",
          description: "How endpoints are added in this project",
          body: "## Steps\n1. Add the route in src/routes\n2. Add the handler with zod validation\n3. Register it in src/app.ts\n4. Add a test in tests/routes and run pnpm test\n",
          evidence: [a[2].id, a[3].id, b[1].id, b[2].id],
        },
        { name: "one-off", description: "Something seen once only here", body: "x".repeat(200), evidence: [a[2].id] },
      ],
    };
    const r = (await reflect(async (_sys, user) => {
      seen = user;
      return "Here you go:\n" + JSON.stringify(proposal);
    }, { force: true }))!;
    assert.match(seen, /no, use pnpm not npm/, "the model saw the journal");
    assert.deepEqual(r.profileAdded, ["Uses pnpm, never npm"]);
    assert.equal(r.rejected.filter((x) => x.startsWith("profile")).length, 2);
    assert.deepEqual(r.lessonsAdded, ["Install with pnpm install; npm install fails in this repo"]);
    assert.deepEqual(r.skillsAdded, ["add-api-endpoint"]);
    assert.ok(r.rejected.some((x) => x.includes("one-off")));

    assert.match(profilePrompt(), /Uses pnpm, never npm/);
    assert.deepEqual(readLessons(), ["Install with pnpm install; npm install fails in this repo"]);
    const md = fs.readFileSync(path.join(tmp, "XYRO.md"), "utf-8");
    assert.match(md, /xyro:lessons:start/);
    assert.match(fs.readFileSync(path.join(tmp, ".xyro", "skills", "add-api-endpoint", "SKILL.md"), "utf-8"), /learned from 4 observations across 2 sessions/);
    assert.ok(findSkill("add-api-endpoint"));
  });

  it("keeps the user's own XYRO.md text and old profile items the model forgot", async () => {
    fs.writeFileSync(path.join(tmp, "XYRO.md"), "# My notes\nDeploy on Fridays never.\n");
    const ev = pastEvents("s1", [{ kind: "correction", text: "tabs not spaces" }, { kind: "correction", text: "tabs!" }, { kind: "recovered", tool: "x", detail: "y" }]);
    await reflect(async () => JSON.stringify({ profile: [{ text: "Prefers tabs", evidence: [ev[0].id, ev[1].id] }], lessons: [{ text: "Lesson one", evidence: [ev[2].id] }] }), { force: true });
    const ev2 = pastEvents("s2", [{ kind: "recovered", tool: "x", detail: "z" }]);
    await reflect(async () => JSON.stringify({ profile: [], lessons: [{ text: "Lesson two", evidence: [ev2[0].id] }] }), { force: true });
    assert.deepEqual(readProfile().map((p) => p.text), ["Prefers tabs"]);
    assert.deepEqual(readLessons(), ["Lesson one", "Lesson two"]);
    assert.match(fs.readFileSync(path.join(tmp, "XYRO.md"), "utf-8"), /Deploy on Fridays never\./);
  });

  it("only reflects after enough new evidence, and /forget erases it", async () => {
    assert.equal(reflectionDue(), false);
    for (let i = 0; i < 20; i++) recordEvent({ kind: "request", text: `request number ${i}` });
    assert.equal(reflectionDue(), true);
    await reflect(async () => "{}", {});
    assert.equal(reflectionDue(), false, "nothing new since the last reflection");
    forgetEverything();
    assert.equal(readJournal().length, 0);
    assert.equal(profilePrompt(), "");
  });

  it("a garbage reply changes nothing", async () => {
    pastEvents("s1", [{ kind: "correction", text: "x" }]);
    const r = (await reflect(async () => "I cannot do that", { force: true }))!;
    assert.deepEqual([r.profileAdded, r.lessonsAdded, r.skillsAdded], [[], [], []]);
  });
});

describe("Learning in the agent loop", () => {
  let server: http.Server;
  let url = "";
  let step = 0;
  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const call = (args: object) => ({ role: "assistant", tool_calls: [{ index: 0, id: `c${step}`, type: "function", function: { name: "read_file", arguments: JSON.stringify(args) } }] });
        const replies = [call({ path: "missing.txt" }), call({ path: "real.txt" }), { role: "assistant", content: "Read it." }, { role: "assistant", content: "Okay, switching." }];
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

  it("records requests, a recovered tool error, and the user's correction of the turn", async () => {
    fs.writeFileSync(path.join(tmp, "real.txt"), "hi");
    const agent = new Agent({ baseURL: url, apiKey: "k", model: "fake" });
    agent.setOutputAdapter({ requestPermission: async () => true });
    await agent.run("read the notes file");
    await agent.run("no, read the other one instead");
    const kinds = readJournal().map((e) => e.kind);
    assert.ok(kinds.includes("recovered"), kinds.join(","));
    assert.ok(kinds.includes("correction"), kinds.join(","));
    const rec = readJournal().find((e) => e.kind === "recovered")!;
    assert.match(rec.detail!, /missing\.txt.*→ worked with: real\.txt/);
    const corr = readJournal().find((e) => e.kind === "correction")!;
    assert.match(corr.detail!, /previous request: read the notes file · tools: read_file/);
  });
});
