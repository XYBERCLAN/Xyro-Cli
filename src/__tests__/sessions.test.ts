import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { HistoryManager } from "../agent/history.js";
import { listSessions, sessionsDir, loadSession } from "../agent/sessions.js";
import { savePersistedConfig, tightenPrivateFiles } from "../config/persist.js";
import { SessionsModal } from "../tui/capabilities.js";

let tmp: string;
let oldCwd: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-sess-"));
  oldCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(() => process.chdir(oldCwd));

describe("Sessions live in the project", () => {
  it("a session is saved in .xyro/sessions with its prompts, privately, and kept out of git", () => {
    execSync("git init -q", { cwd: tmp });
    const h = new HistoryManager();
    h.save();
    assert.equal(listSessions().length, 0, "nothing saved before the first prompt");
    h.notePrompt("fix the login bug");
    h.add({ role: "user", content: "fix the login bug" });
    h.add({ role: "assistant", content: "Fixed." });
    h.notePrompt("now add a test");
    h.save();
    const [s] = listSessions();
    assert.equal(s.title, "fix the login bug");
    assert.equal(s.turns, 2);
    const file = path.join(sessionsDir(), `${s.id}.json`);
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
    assert.match(fs.readFileSync(path.join(tmp, ".git", "info", "exclude"), "utf-8"), /\.xyro\/sessions\//);
    assert.ok(!loadSession(s.id)!.messages.some((m) => m.role === "system"), "the system prompt is rebuilt, not stored");
  });

  it("reopening a session restores the conversation and its prompts; a new session keeps the old one", () => {
    const a = new HistoryManager();
    a.notePrompt("first idea");
    a.add({ role: "user", content: "first idea" });
    a.save();
    a.newSession();
    a.notePrompt("second idea");
    a.save();
    assert.equal(listSessions().length, 2);
    const b = new HistoryManager();
    assert.ok(b.load(listSessions().find((x) => x.title === "first idea")!.id));
    assert.deepEqual(b.getPrompts(), ["first idea"]);
    assert.equal(b.getAll()[0].role, "system");
    assert.equal(b.getAll()[1].content, "first idea");
    assert.ok(new HistoryManager().load(), "no id = this project's latest session");
  });

  it("another project never sees these sessions", () => {
    const h = new HistoryManager();
    h.notePrompt("secret project work");
    h.save();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-other-"));
    process.chdir(other);
    assert.equal(listSessions().length, 0);
    assert.equal(new HistoryManager().load(), false);
  });

  it("/sessions lists them; enter reopens, n starts a new one", () => {
    const opened: string[] = [];
    let fresh = 0;
    const m = new SessionsModal();
    m.open([{ id: "a", title: "Fix login", updatedAt: new Date().toISOString(), turns: 3, current: true }, { id: "b", title: "Add docs", updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), turns: 1, current: false }], "proj", (id) => opened.push(id), () => fresh++);
    const text = m.render(100).map((l) => l.spans.map((s) => s.text).join("")).join("\n");
    assert.match(text, /Sessions in proj/);
    assert.match(text, /● Fix login/);
    assert.match(text, /3 h ago/);
    m.handleKey("\u001b[B");
    m.handleKey("\r");
    assert.deepEqual(opened, ["b"]);
    m.open([], "proj", () => {}, () => fresh++);
    m.handleKey("n");
    assert.equal(fresh, 1);
  });
});

describe("Private files", () => {
  it("the config with your keys is written readable by you only, and old open files are tightened", () => {
    const cfgDir = path.join(process.env.XDG_CONFIG_HOME!, "xyro");
    savePersistedConfig({ apiKey: "sk-test" });
    const file = path.join(cfgDir, "config.json");
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
    fs.chmodSync(file, 0o644);
    const legacy = path.join(tmp, "session.json");
    fs.writeFileSync(legacy, "{}", { mode: 0o644 });
    tightenPrivateFiles([legacy]);
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
    assert.equal((fs.statSync(legacy).mode & 0o777).toString(8), "600");
  });
});
