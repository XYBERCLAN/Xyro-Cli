/**
 * Socle features — per-project sessions, headless one-shot plumbing and the
 * verification tools (diagnostics / run_tests).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  createSession,
  deleteSession,
  getOrCreateProjectSession,
  getSessionMeta,
  listSessions,
  loadSessionMessages,
  migrateLegacySession,
  projectKey,
  renameSession,
  resolveSessionId,
  saveSessionMessages,
} from "../agent/sessions.js";
import { HistoryManager } from "../agent/history.js";
import { renderDone, setJsonMode } from "../ui/render.js";
import {
  detectProject,
  parseFindings,
  parseTestSummary,
  runDiagnostics,
  runProjectTests,
  runRawCommand,
} from "../tools/verify.js";
import { getToolDefinitions, executeTool, getPlanModeToolDefinitions } from "../tools/registry.js";
import { shouldAskPermission } from "../tools/permissions.js";
import type { Message } from "../agent/types.js";

const OLD_CWD = process.cwd();
const ROOT = join(OLD_CWD, "__test_socle__");
const PROJECT_A = join(ROOT, "project-a");
const PROJECT_B = join(ROOT, "project-b");
// Fully sandboxed data/config dirs so nothing touches the real ~/.local/share.
const DATA_HOME = join(ROOT, "data");
const CONFIG_HOME = join(ROOT, "config");
const OLD_DATA = process.env["XDG_DATA_HOME"];
const OLD_CONFIG = process.env["XDG_CONFIG_HOME"];

function makeProject(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
}

function setup(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(PROJECT_A, { recursive: true });
  mkdirSync(PROJECT_B, { recursive: true });
  mkdirSync(DATA_HOME, { recursive: true });
  mkdirSync(CONFIG_HOME, { recursive: true });
  process.env["XDG_DATA_HOME"] = DATA_HOME;
  process.env["XDG_CONFIG_HOME"] = CONFIG_HOME;
  process.chdir(PROJECT_A);
}

function teardown(): void {
  process.chdir(OLD_CWD);
  if (OLD_DATA === undefined) delete process.env["XDG_DATA_HOME"];
  else process.env["XDG_DATA_HOME"] = OLD_DATA;
  if (OLD_CONFIG === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = OLD_CONFIG;
  rmSync(ROOT, { recursive: true, force: true });
}

/**
 * A `test` script that prints a TAP-shaped summary and exits with the matching
 * status. Shelling out to a real `node --test` from inside `node --test` does
 * not work (Node skips nested runs), so the fixture fakes the runner output.
 */
function TAP_FIXTURE(pass: number, fail: number): string {
  const lines = [fail > 0 ? "not ok 1 - beta fails" : "ok 1 - alpha passes"];
  lines.push(`# tests ${pass + fail}`, `# pass ${pass}`, `# fail ${fail}`);
  const js = `const l=${JSON.stringify(lines.join("\n"))};console.log(l);process.exit(${fail > 0 ? 1 : 0});`;
  return `node -e ${JSON.stringify(js)}`;
}

const userMsg: Message = { role: "user", content: "hello" };
const asstMsg: Message = { role: "assistant", content: "hi" };

// ─── Sessions ───────────────────────────────────────────────────────────

describe("sessions — project scoping", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("derives a stable key per project path", () => {
    assert.equal(projectKey(PROJECT_A), projectKey(PROJECT_A));
    assert.notEqual(projectKey(PROJECT_A), projectKey(PROJECT_B));
    assert.match(projectKey(PROJECT_A), /^[0-9a-f]{12}$/);
  });

  it("creates the project default session once and reuses it afterwards", () => {
    const first = getOrCreateProjectSession();
    const second = getOrCreateProjectSession();
    assert.equal(first, second, "default session must be stable for a project");
    assert.equal(getSessionMeta(first)?.name, "default");
    assert.equal(getSessionMeta(first)?.projectPath, PROJECT_A);
  });

  it("keeps two projects on two separate sessions", () => {
    process.chdir(PROJECT_A);
    const a = getOrCreateProjectSession();
    process.chdir(PROJECT_B);
    const b = getOrCreateProjectSession();
    assert.notEqual(a, b, "sessions must not be shared across projects");

    // Writing in B must not touch A.
    saveSessionMessages(b, [{ role: "user", content: "from B" }]);
    assert.equal(loadSessionMessages(a)?.length, 0);
    assert.equal(loadSessionMessages(b)?.length, 1);
  });

  it("names sessions independently inside one project", () => {
    const dflt = getOrCreateProjectSession();
    const named = getOrCreateProjectSession("refactor");
    assert.notEqual(dflt, named);
    assert.equal(getSessionMeta(named)?.name, "refactor");
  });

  it("round-trips messages through disk", () => {
    const id = getOrCreateProjectSession();
    saveSessionMessages(id, [{ role: "system", content: "s" }, userMsg, asstMsg]);
    const loaded = loadSessionMessages(id);
    assert.equal(loaded?.length, 3);
    assert.equal(loaded?.[2].content, "hi");
    assert.equal(loadSessionMessages("does-not-exist"), null);
  });
});

describe("sessions — listing, resolution, mutation", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("lists sessions newest first and flags the current project", async () => {
    const a = getOrCreateProjectSession();
    saveSessionMessages(a, [userMsg]);
    // Timestamps have millisecond resolution: wait so B is unambiguously newer
    // instead of relying on the ordering of two same-millisecond writes.
    await new Promise((r) => setTimeout(r, 5));
    process.chdir(PROJECT_B);
    const b = getOrCreateProjectSession();
    saveSessionMessages(b, [userMsg, asstMsg]);

    const sessions = listSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, b, "most recently updated first");
    assert.equal(sessions[0].current, true, "B is the cwd here");
    assert.equal(sessions[1].id, a);
    assert.equal(sessions[1].current, false);
    assert.equal(sessions[1].messageCount, 1);
  });

  it("keeps the listing order stable for same-millisecond sessions", async () => {
    const a = getOrCreateProjectSession();
    process.chdir(PROJECT_B);
    const b = getOrCreateProjectSession();
    saveSessionMessages(a, [userMsg]);
    saveSessionMessages(b, [userMsg]);

    const first = listSessions().map((s) => s.id);
    assert.deepEqual(listSessions().map((s) => s.id), first, "ties must not reshuffle");
    assert.deepEqual([...first].sort(), [a, b].sort(), "both sessions are listed");
  });

  it("resolves a session by id, exact name and loose name", () => {
    const id = getOrCreateProjectSession("My Refactor");
    assert.equal(resolveSessionId(id), id);
    assert.equal(resolveSessionId("My Refactor"), id);
    assert.equal(resolveSessionId("my refactor"), id);
    assert.equal(resolveSessionId("my-refactor"), id, "slugified match");
    assert.equal(resolveSessionId("nope"), null);
    assert.equal(resolveSessionId(""), null);
  });

  it("renames and deletes sessions", () => {
    const id = getOrCreateProjectSession();
    assert.equal(renameSession(id, "shipping"), true);
    assert.equal(getSessionMeta(id)?.name, "shipping");
    assert.equal(renameSession("ghost", "x"), false);

    assert.equal(deleteSession(id), true);
    assert.equal(getSessionMeta(id), null);
    assert.equal(deleteSession(id), false, "deleting twice is a no-op");
  });

  it("creates an explicit named session with no messages", () => {
    const id = createSession("scratch");
    assert.equal(getSessionMeta(id)?.name, "scratch");
    assert.equal(getSessionMeta(id)?.messageCount, 0);
    assert.equal(loadSessionMessages(id)?.length, 0);
  });

  it("skips corrupted session files instead of throwing", () => {
    const id = getOrCreateProjectSession();
    const file = join(DATA_HOME, "xyro", "sessions", `${id}.json`);
    writeFileSync(file, "{ not json", "utf-8");

    assert.deepEqual(listSessions(), [], "the list survives a corrupted file");
    assert.equal(loadSessionMessages(id), null);
    assert.equal(getSessionMeta(id), null, "metadata lookup survives it too");
    assert.equal(resolveSessionId(id), null, "and the id is no longer resolvable");
  });

  it("rejects a session file whose shape is wrong", () => {
    const id = getOrCreateProjectSession();
    const file = join(DATA_HOME, "xyro", "sessions", `${id}.json`);
    // Valid JSON, but no messages array: must not be mistaken for a session.
    writeFileSync(file, JSON.stringify({ id, name: "broken" }), "utf-8");

    assert.equal(getSessionMeta(id), null);
    assert.equal(loadSessionMessages(id), null);
    assert.deepEqual(listSessions(), []);

    // A non-object payload is rejected just the same.
    writeFileSync(file, JSON.stringify("nope"), "utf-8");
    assert.equal(getSessionMeta(id), null);
    assert.deepEqual(listSessions(), []);
  });

  it("ignores non-file entries in the sessions directory", () => {
    getOrCreateProjectSession();
    mkdirSync(join(DATA_HOME, "xyro", "sessions", "subdir.json"), { recursive: true });
    const sessions = listSessions();
    assert.equal(sessions.length, 1, "a directory named like a session is not listed");
  });

  it("migrates the legacy single-file session exactly once", () => {
    const legacyDir = join(DATA_HOME, "xyro");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "session.json"), JSON.stringify([{ role: "user", content: "old" }]), "utf-8");

    const id = migrateLegacySession();
    assert.ok(id, "migration returns the new session id");
    assert.equal(getSessionMeta(id)?.name, "migrated");
    assert.equal(loadSessionMessages(id)?.[0].content, "old");
    assert.equal(existsSync(join(legacyDir, "session.json")), false, "legacy file removed");

    // Nothing left to migrate.
    assert.equal(migrateLegacySession(), null);
  });

  it("ignores an empty legacy session", () => {
    const legacyDir = join(DATA_HOME, "xyro");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "session.json"), "[]", "utf-8");
    assert.equal(migrateLegacySession(), null);
  });
});

describe("HistoryManager — session binding and autosave", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("binds to the project default session", () => {
    const h = new HistoryManager();
    assert.equal(h.getSessionId(), getOrCreateProjectSession());
    assert.equal(h.getSessionName(), "default");
  });

  it("persists on flush and reloads into a fresh manager", () => {
    const h = new HistoryManager();
    h.add(userMsg);
    h.add(asstMsg);
    h.flush();

    const reloaded = new HistoryManager({ sessionId: h.getSessionId() });
    assert.equal(reloaded.load(), true);
    assert.equal(reloaded.getAll().length, 3, "system + 2 messages");
    assert.equal(reloaded.getAll()[2].content, "hi");
  });

  it("autosave (touch) writes without an explicit save", async () => {
    const h = new HistoryManager();
    h.add(userMsg);
    h.touch();
    // Debounce is 1.5s; the unref'd timer must still fire while we wait.
    await new Promise((r) => setTimeout(r, 1800));
    const id = h.getSessionId();
    assert.equal(loadSessionMessages(id)?.length, 2);
  });

  it("flush() cancels a pending autosave and writes once", () => {
    const h = new HistoryManager();
    h.add(userMsg);
    h.touch();
    h.flush();
    const id = h.getSessionId();
    const first = readFileSync(join(DATA_HOME, "xyro", "sessions", `${id}.json`), "utf-8");
    assert.ok(first.includes("hello"));
  });

  it("switchSession loads another conversation and adopts its id", () => {
    const target = createSession("other");
    saveSessionMessages(target, [{ role: "system", content: "sys" }, { role: "user", content: "from other" }]);

    const h = new HistoryManager();
    assert.equal(h.switchSession(target), true);
    assert.equal(h.getSessionId(), target);
    assert.equal(h.getSessionName(), "other");
    assert.equal(h.getAll().at(-1)?.content, "from other");
    assert.equal(h.switchSession("ghost"), false, "unknown id keeps current session");
  });

  it("newSession starts an empty conversation under a new id", () => {
    const h = new HistoryManager();
    const before = h.getSessionId();
    h.add(userMsg);
    const after = h.newSession("fresh");
    assert.notEqual(after, before);
    assert.equal(h.getSessionName(), "fresh");
    assert.equal(h.getAll().length, 1, "only the system message remains");
  });

  it("keeps a system message when loading a session saved without one", () => {
    const id = createSession("bare");
    saveSessionMessages(id, [userMsg, asstMsg]);
    const h = new HistoryManager({ sessionId: id });
    assert.equal(h.load(), true);
    assert.equal(h.getAll()[0].role, "system");
    assert.equal(h.getAll().length, 3);
  });

  it("load() reports false for an empty session", () => {
    const h = new HistoryManager();
    assert.equal(h.load(), false);
  });
});

// ─── Headless ───────────────────────────────────────────────────────────

describe("headless — done event", () => {
  const originalLog = console.log;
  let captured: string[] = [];

  beforeEach(() => {
    captured = [];
    console.log = (...args: unknown[]) => {
      captured.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    setJsonMode(false);
  });

  it("emits a machine-readable done line in JSON mode", () => {
    setJsonMode(true);
    renderDone({
      ok: true,
      exitCode: 0,
      session: "abc",
      usage: { apiCalls: 2, promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: 0.5,
    });
    const done = JSON.parse(captured.at(-1) as string);
    assert.equal(done.type, "done");
    assert.equal(done.ok, true);
    assert.equal(done.exit_code, 0);
    assert.equal(done.session, "abc");
    assert.equal(done.usage.totalTokens, 15);
    assert.equal(done.cost, 0.5);
  });

  it("carries the error and a non-zero code on failure", () => {
    setJsonMode(true);
    renderDone({ ok: false, exitCode: 1, error: "Invalid API key" });
    const done = JSON.parse(captured.at(-1) as string);
    assert.equal(done.ok, false);
    assert.equal(done.exit_code, 1);
    assert.equal(done.error, "Invalid API key");
  });

  it("prints a human summary outside JSON mode", () => {
    setJsonMode(false);
    renderDone({
      ok: false,
      exitCode: 1,
      usage: { apiCalls: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      error: "boom",
    });
    const line = captured.at(-1) as string;
    assert.match(line, /failed \(exit 1\)/);
    assert.match(line, /boom/);
  });
});

// ─── Verification tools ─────────────────────────────────────────────────

describe("verify — project detection", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("prefers the project's own scripts", () => {
    makeProject(PROJECT_A, {
      "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc -b" } }),
      "package-lock.json": "{}",
    });
    const p = detectProject(PROJECT_A);
    assert.equal(p.ecosystem, "node");
    assert.equal(p.packageManager, "npm");
    assert.equal(p.test, "npm run test");
    assert.equal(p.lint, "npm run lint");
    assert.equal(p.typecheck, "npm run typecheck");
  });

  it("uses the matching package manager binary", () => {
    makeProject(PROJECT_A, { "package.json": JSON.stringify({ scripts: { test: "vitest" } }), "pnpm-lock.yaml": "" });
    assert.equal(detectProject(PROJECT_A).packageManager, "pnpm");
    assert.equal(detectProject(PROJECT_A).test, "pnpm test");

    makeProject(PROJECT_B, { "package.json": JSON.stringify({ scripts: { test: "jest" } }), "yarn.lock": "" });
    assert.equal(detectProject(PROJECT_B).packageManager, "yarn");
    assert.equal(detectProject(PROJECT_B).test, "yarn test");
  });

  it("falls back to tsc --noEmit when only tsconfig.json exists", () => {
    makeProject(PROJECT_A, { "package.json": JSON.stringify({ name: "x" }), "tsconfig.json": "{}" });
    assert.equal(detectProject(PROJECT_A).typecheck, "npx --no-install tsc --noEmit");
  });

  it("falls back to eslint when a config file exists", () => {
    makeProject(PROJECT_A, { "package.json": JSON.stringify({ name: "x" }), "eslint.config.js": "export default [];" });
    assert.equal(detectProject(PROJECT_A).lint, "npx --no-install eslint .");
  });

  it("detects rust, go and python projects", () => {
    makeProject(PROJECT_A, { "Cargo.toml": "[package]" });
    const rust = detectProject(PROJECT_A);
    assert.equal(rust.ecosystem, "rust");
    assert.equal(rust.test, "cargo test");

    makeProject(PROJECT_B, { "go.mod": "module x" });
    const go = detectProject(PROJECT_B);
    assert.equal(go.ecosystem, "go");
    assert.equal(go.test, "go test ./...");

    mkdirSync(ROOT, { recursive: true });
    const py = join(ROOT, "pyproj");
    makeProject(py, { "pyproject.toml": "" });
    const python = detectProject(py);
    assert.equal(python.ecosystem, "python");
    assert.equal(python.test, "python -m pytest -q");
  });

  it("reports an unknown ecosystem for an empty directory", () => {
    assert.equal(detectProject(PROJECT_A).ecosystem, "unknown");
  });

  it("survives a malformed package.json", () => {
    writeFileSync(join(PROJECT_A, "package.json"), "{ broken", "utf-8");
    assert.equal(detectProject(PROJECT_A).ecosystem, "unknown");
  });
});

describe("verify — diagnostic parsing", () => {
  it("parses TypeScript errors", () => {
    const findings = parseFindings(
      "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/b.ts(3,1): warning TS6133: 'x' is declared but never used."
    );
    assert.equal(findings.length, 2);
    assert.deepEqual(findings[0], {
      file: "src/a.ts",
      line: 12,
      column: 5,
      severity: "error",
      code: "TS2322",
      message: "Type 'string' is not assignable to type 'number'.",
    });
    assert.equal(findings[1].severity, "warning");
  });

  it("parses cargo errors with their location line", () => {
    const findings = parseFindings(
      "error[E0308]: mismatched types\n --> src/main.rs:10:5\n  |\n10 |     let x: i32 = \"s\";"
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, "src/main.rs");
    assert.equal(findings[0].line, 10);
    assert.equal(findings[0].code, "E0308");
  });

  it("parses go and python errors", () => {
    const go = parseFindings("./main.go:12:5: undefined: foo");
    assert.equal(go[0].file, "./main.go");
    assert.equal(go[0].line, 12);

    const py = parseFindings("app.py:7: SyntaxError: invalid syntax");
    assert.equal(py[0].file, "app.py");
    assert.equal(py[0].line, 7);
  });

  it("parses eslint problem lines", () => {
    const findings = parseFindings("  12:5  error  Unexpected var  no-var");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    assert.equal(findings[0].message, "Unexpected var");
  });

  it("returns nothing for a clean log", () => {
    assert.deepEqual(parseFindings("All good, no errors found."), []);
  });
});

describe("verify — test output parsing", () => {
  it("parses node:test summaries and failing names", () => {
    const s = parseTestSummary(
      "not ok 3 - beta fails\n# tests 2\n# pass 1\n# fail 1\n"
    );
    assert.equal(s.passed, 1);
    assert.equal(s.failed, 1);
    assert.equal(s.total, 2);
    assert.deepEqual(s.failures, ["beta fails"]);
  });

  it("parses cargo, go, jest, vitest and pytest output", () => {
    assert.equal(parseTestSummary("test result: FAILED. 3 passed; 2 failed; 0 ignored").failed, 2);

    const go = parseTestSummary("--- FAIL: TestAlpha (0.00s)\nFAIL\nFAIL\tgithub.com/x/y\t0.1s");
    assert.deepEqual(go.failures, ["TestAlpha (0.00s)", "FAIL\tgithub.com/x/y\t0.1s"]);

    const jest = parseTestSummary("Tests:       2 failed, 5 passed, 7 total");
    assert.equal(jest.failed, 2);
    assert.equal(jest.passed, 5);

    const pytest = parseTestSummary("FAILED tests/test_a.py::test_one - assert 1 == 2\n2 failed, 8 passed");
    assert.equal(pytest.failed, 2);
    assert.equal(pytest.passed, 8);
    assert.deepEqual(pytest.failures, ["tests/test_a.py::test_one"]);
  });

  it("returns an empty summary for unparsable output", () => {
    const s = parseTestSummary("something went sideways");
    assert.equal(s.passed, null);
    assert.equal(s.failed, null);
    assert.deepEqual(s.failures, []);
  });
});

describe("verify — command execution", () => {
  it("captures stdout and a zero exit code", () => {
    const out = runRawCommand("echo hello-xyro", 5000);
    assert.equal(out.ok, true);
    assert.equal(out.exitCode, 0);
    assert.match(out.stdout, /hello-xyro/);
  });

  it("captures a non-zero exit code without throwing", () => {
    const out = runRawCommand("exit 3", 5000);
    assert.equal(out.ok, false);
    assert.equal(out.exitCode, 3);
  });

  it("reports a timeout instead of hanging", () => {
    const out = runRawCommand("sleep 5", 300);
    assert.equal(out.timedOut, true);
  });
});

describe("verify — end-to-end on a fixture project", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("run_tests reports the failing test name of a real suite", async () => {
    makeProject(PROJECT_A, {
      "package.json": JSON.stringify({ name: "fixture", scripts: { test: TAP_FIXTURE(1, 1) } }),
    });
    const out = await runProjectTests({});
    assert.match(out, /❌ tests failed/);
    assert.match(out, /1 passed, 1 failed/);
    assert.match(out, /✗ beta fails/);
    assert.match(out, /Fix the failures/);
  });

  it("run_tests reports success for a green suite", async () => {
    makeProject(PROJECT_A, {
      "package.json": JSON.stringify({ name: "fixture", scripts: { test: TAP_FIXTURE(2, 0) } }),
    });
    const out = await runProjectTests({});
    assert.match(out, /✅ tests passed/);
    assert.match(out, /2 passed, 0 failed/);
  });

  it("run_tests explains itself when the project has no tests", async () => {
    makeProject(PROJECT_A, { "package.json": JSON.stringify({ name: "fixture" }) });
    const out = await runProjectTests({});
    assert.match(out, /No test command detected/);
  });

  it("diagnostics explains itself on an unrecognised project", async () => {
    const out = await runDiagnostics({});
    assert.match(out, /No recognised project/);
  });

  it("diagnostics skips checks the project does not define", async () => {
    makeProject(PROJECT_A, { "package.json": JSON.stringify({ name: "fixture" }) });
    const out = await runDiagnostics({});
    assert.match(out, /typecheck: no typecheck command detected/);
    assert.match(out, /lint: no lint command detected/);
  });

  it("diagnostics runs a project typecheck script and surfaces findings", async () => {
    // A "typecheck" that prints TypeScript-shaped errors: exercises the whole
    // detect → run → parse → format path without needing a real compiler.
    makeProject(PROJECT_A, {
      "package.json": JSON.stringify({
        name: "fixture",
        scripts: { typecheck: `node -e "console.error('src/x.ts(4,9): error TS2322: Type mismatch')"` },
      }),
    });
    const out = await runDiagnostics({ scope: "typecheck" });
    assert.match(out, /❌ typecheck: 1 error/);
    assert.match(out, /src\/x\.ts:4:9 error TS2322: Type mismatch/);
    assert.match(out, /Fix these findings/);
  });

  it("diagnostics reports a clean typecheck", async () => {
    makeProject(PROJECT_A, {
      "package.json": JSON.stringify({ name: "fixture", scripts: { typecheck: "node -e \"console.log('all good')\"" } }),
    });
    const out = await runDiagnostics({ scope: "typecheck" });
    assert.match(out, /✅ typecheck: clean/);
  });
});

describe("verify — registry wiring", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("registers diagnostics and run_tests", () => {
    const names = getToolDefinitions().map((t) => t.function.name);
    assert.ok(names.includes("diagnostics"), "diagnostics missing");
    assert.ok(names.includes("run_tests"), "run_tests missing");
  });

  it("exposes diagnostics but not run_tests in plan mode", () => {
    const planNames = getPlanModeToolDefinitions().map((t) => t.function.name);
    assert.ok(planNames.includes("diagnostics"), "diagnostics should be usable while planning");
    assert.ok(!planNames.includes("run_tests"), "run_tests must stay out of plan mode");
  });

  it("gates run_tests behind the permission prompt", () => {
    assert.equal(shouldAskPermission("run_tests"), true);
    assert.equal(shouldAskPermission("diagnostics"), false, "diagnostics is read-only analysis");
  });

  it("executeTool routes both tools", async () => {
    makeProject(PROJECT_A, { "package.json": JSON.stringify({ name: "fixture" }) });
    const diag = await executeTool("diagnostics", {});
    assert.match(diag, /No recognised project|skipped/);
    const tests = await executeTool("run_tests", {});
    assert.match(tests, /No test command detected/);
  });

  it("clamps an absurd timeout instead of hanging", async () => {
    makeProject(PROJECT_A, {
      "package.json": JSON.stringify({ name: "fixture", scripts: { test: TAP_FIXTURE(1, 0) } }),
    });
    const out = await runProjectTests({ timeout_ms: 99_999_999 });
    assert.match(out, /tests passed|tests failed/);
  });
});
