/**
 * Permission rules: allow/deny/ask resolution, path-scoped globs, hard denies
 * on credential paths, and the fail-closed behaviour outside a TTY.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  addRule,
  checkPermission,
  clearRules,
  evaluatePermission,
  extractPath,
  isHardDeniedPath,
  loadRules,
  matchesPathPattern,
  permissionDeniedResult,
  removeRule,
  shouldAskPermission,
} from "../tools/permissions.js";
import { proposeWriteFile } from "../tools/propose.js";
import { writeFile, editFile } from "../tools/write.js";

const OLD_CWD = process.cwd();
const ROOT = join(OLD_CWD, "__test_perms__");
const PROJECT = join(ROOT, "proj");
const CONFIG_HOME = join(ROOT, "config");
const OLD_CONFIG = process.env["XDG_CONFIG_HOME"];
const OLD_NO_APPROVE = process.env["XYRO_NO_APPROVE"];

function setup(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });
  mkdirSync(CONFIG_HOME, { recursive: true });
  process.env["XDG_CONFIG_HOME"] = CONFIG_HOME;
  process.chdir(PROJECT);
}

function teardown(): void {
  process.chdir(OLD_CWD);
  if (OLD_CONFIG === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = OLD_CONFIG;
  if (OLD_NO_APPROVE === undefined) delete process.env["XYRO_NO_APPROVE"];
  else process.env["XYRO_NO_APPROVE"] = OLD_NO_APPROVE;
  rmSync(ROOT, { recursive: true, force: true });
}

// ─── path globs ─────────────────────────────────────────────────────────

describe("permissions — path patterns", () => {
  beforeEach(setup);
  afterEach(teardown);

  const at = (...p: string[]) => resolve(PROJECT, ...p);

  it("matches a rooted glob at any depth", () => {
    assert.equal(matchesPathPattern("src/**", at("src", "a.ts")), true);
    assert.equal(matchesPathPattern("src/**", at("src", "deep", "nested", "a.ts")), true);
    assert.equal(matchesPathPattern("src/**", at("srcfoo", "a.ts")), false);
    assert.equal(matchesPathPattern("src/**", at("other", "a.ts")), false);
  });

  it("matches ** in the middle of a pattern", () => {
    assert.equal(matchesPathPattern("**/*.test.ts", at("a.test.ts")), true);
    assert.equal(matchesPathPattern("**/*.test.ts", at("src", "a.test.ts")), true);
    assert.equal(matchesPathPattern("**/*.test.ts", at("src", "x", "y", "a.test.ts")), true);
    assert.equal(matchesPathPattern("**/*.test.ts", at("src", "a.ts")), false);
  });

  it("matches a bare pattern against the basename at any depth", () => {
    assert.equal(matchesPathPattern("*.log", at("a.log")), true);
    assert.equal(matchesPathPattern("*.log", at("deep", "nested", "a.log")), true);
    assert.equal(matchesPathPattern("*.log", at("a.txt")), false);
  });

  it("treats a trailing slash as the whole directory", () => {
    assert.equal(matchesPathPattern("build/", at("build", "out.js")), true);
    assert.equal(matchesPathPattern("build/", at("src", "out.js")), false);
  });

  it("supports absolute patterns", () => {
    assert.equal(matchesPathPattern("/etc/**", "/etc/hosts"), true);
    assert.equal(matchesPathPattern("/etc/**", "/etc/ssl/cert.pem"), true);
    assert.equal(matchesPathPattern("/etc/**", "/etcetera/x"), false);
  });

  it("never matches a relative pattern against a path outside the project", () => {
    assert.equal(matchesPathPattern("src/**", resolve(PROJECT, "..", "elsewhere", "a.ts")), false);
  });

  it("treats an empty pattern as 'any path'", () => {
    assert.equal(matchesPathPattern("", at("anything")), true);
  });

  it("escapes regex metacharacters in the pattern", () => {
    assert.equal(matchesPathPattern("a+b(c).ts", at("a+b(c).ts")), true);
    assert.equal(matchesPathPattern("a+b(c).ts", at("aab(c).ts")), false);
  });
});

describe("permissions — credential paths are never writable", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("flags secrets anywhere in the tree", () => {
    assert.equal(isHardDeniedPath(resolve(PROJECT, ".env")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, ".env.production")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, "config", ".env")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, "certs", "server.pem")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, "id_rsa.pub")), true);
  });

  it("flags ssh/aws/vcs internals", () => {
    assert.equal(isHardDeniedPath(resolve(PROJECT, ".ssh", "id_ed25519")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, ".aws", "credentials")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, ".git", "config")), true);
    assert.equal(isHardDeniedPath(resolve(PROJECT, "sub", ".git", "HEAD")), true);
  });

  it("leaves ordinary source files alone", () => {
    assert.equal(isHardDeniedPath(resolve(PROJECT, "src", "index.ts")), false);
    assert.equal(isHardDeniedPath(resolve(PROJECT, "environment.ts")), false);
    assert.equal(isHardDeniedPath(resolve(PROJECT, "keyboard.ts")), false);
  });

  it("denies a write to .env before any rule can allow it", async () => {
    addRule({ action: "allow", tools: ["write_file"], paths: ["**"] });
    assert.equal(evaluatePermission("write_file", { path: ".env" }), "deny");

    const out = await writeFile({ path: ".env", content: "SECRET=1" });
    assert.match(out, /⛔|denied/i);
  });

  it("does not apply to read-only tools", () => {
    assert.equal(evaluatePermission("read_file", { path: ".env" }), "allow");
  });
});

// ─── rule storage ───────────────────────────────────────────────────────

describe("permissions — rule store", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("persists and reloads rules", () => {
    const rule = addRule({ action: "allow", tools: ["write_file"], paths: ["src/**"] });
    const reloaded = loadRules();
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].id, rule.id);
    assert.deepEqual(reloaded[0].paths, ["src/**"]);
  });

  it("survives a round-trip through the file", () => {
    addRule({ action: "deny", tools: ["run_command"] });
    addRule({ action: "allow", tools: ["edit_file"], paths: ["**/*.md"] });
    assert.equal(loadRules().length, 2);
  });

  it("refuses a rule with no tool", () => {
    assert.throws(() => addRule({ action: "allow", tools: ["  "] }), /at least one tool/);
  });

  it("does not duplicate an identical rule", () => {
    const a = addRule({ action: "allow", tools: ["write_file"], paths: ["src/**"] });
    const b = addRule({ action: "allow", tools: ["write_file"], paths: ["src/**"] });
    assert.equal(a.id, b.id);
    assert.equal(loadRules().length, 1);
  });

  it("removes one rule and resets all of them", () => {
    const a = addRule({ action: "allow", tools: ["write_file"] });
    addRule({ action: "deny", tools: ["run_command"] });
    assert.equal(removeRule(a.id), true);
    assert.equal(removeRule("nope"), false);
    assert.equal(loadRules().length, 1);
    assert.equal(clearRules(), 1);
    assert.deepEqual(loadRules(), []);
  });

  it("ignores a corrupted rules file instead of failing every call", () => {
    mkdirSync(join(CONFIG_HOME, "xyro"), { recursive: true });
    writeFileSync(join(CONFIG_HOME, "xyro", "permissions.json"), "{ not json", "utf-8");
    assert.deepEqual(loadRules(), []);
    assert.equal(evaluatePermission("write_file", { path: "a.ts" }), "ask", "falls back to defaults");
  });

  it("ignores entries of the wrong shape", () => {
    mkdirSync(join(CONFIG_HOME, "xyro"), { recursive: true });
    writeFileSync(
      join(CONFIG_HOME, "xyro", "permissions.json"),
      JSON.stringify([{ nope: true }, { id: "x", action: "allow", tools: ["write_file"] }]),
      "utf-8"
    );
    const rules = loadRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, "x");
  });
});

// ─── decision ───────────────────────────────────────────────────────────

describe("permissions — decision resolution", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("allows read-only tools without asking", () => {
    assert.equal(evaluatePermission("read_file", { path: "src/a.ts" }), "allow");
    assert.equal(evaluatePermission("glob", { pattern: "**/*.ts" }), "allow");
    assert.equal(evaluatePermission("git_status"), "allow");
  });

  it("asks for mutating and networked tools", () => {
    assert.equal(evaluatePermission("write_file", { path: "a.ts" }), "ask");
    assert.equal(evaluatePermission("edit_file", { path: "a.ts" }), "ask");
    assert.equal(evaluatePermission("run_command", { command: "ls" }), "ask");
    assert.equal(evaluatePermission("fetch_url", { url: "https://example.com" }), "ask");
    assert.equal(evaluatePermission("propose_write_file", { path: "a.ts" }), "ask");
  });

  it("honours an allow rule for a specific path only", () => {
    addRule({ action: "allow", tools: ["write_file"], paths: ["src/**"] });
    assert.equal(evaluatePermission("write_file", { path: "src/a.ts" }), "allow");
    assert.equal(evaluatePermission("write_file", { path: "docs/a.md" }), "ask", "outside the pattern");
    assert.equal(evaluatePermission("edit_file", { path: "src/a.ts" }), "ask", "other tool");
  });

  it("honours a deny rule", () => {
    addRule({ action: "deny", tools: ["run_command"], paths: ["*rm*"] });
    assert.equal(evaluatePermission("run_command", { command: "rm -rf /" }), "deny");
    assert.equal(evaluatePermission("run_command", { command: "ls" }), "ask");
  });

  it("lets deny beat allow, even for the same tool", () => {
    addRule({ action: "allow", tools: ["write_file"] });
    addRule({ action: "deny", tools: ["write_file"], paths: ["vendor/**"] });
    assert.equal(evaluatePermission("write_file", { path: "src/a.ts" }), "allow");
    assert.equal(evaluatePermission("write_file", { path: "vendor/lib.js" }), "deny");
  });

  it("applies a wildcard rule to every tool", () => {
    addRule({ action: "deny", tools: ["*"] });
    assert.equal(evaluatePermission("write_file", { path: "a.ts" }), "deny");
    assert.equal(evaluatePermission("read_file", { path: "a.ts" }), "deny");
  });

  it("reads the target path from any of its aliases", () => {
    assert.equal(extractPath({ path: "a.ts" }), "a.ts");
    assert.equal(extractPath({ file_path: "b.ts" }), "b.ts");
    assert.equal(extractPath({ filePath: "c.ts" }), "c.ts");
    assert.equal(extractPath({}), null);
    assert.equal(extractPath(undefined), null);
    assert.equal(extractPath({ path: "   " }), null);
  });

  it("does not apply a path rule to a call that has no path", () => {
    addRule({ action: "allow", tools: ["run_command"], paths: ["src/**"] });
    assert.equal(evaluatePermission("run_command", { command: "ls" }), "ask");
  });

  it("reports whether a call needs a human", () => {
    assert.equal(shouldAskPermission("write_file", { path: "a.ts" }), true);
    assert.equal(shouldAskPermission("read_file", { path: "a.ts" }), false);
  });
});

// ─── fail-closed behaviour ──────────────────────────────────────────────

describe("permissions — unattended runs fail closed", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("denies a tool that would need a prompt when there is no terminal", async () => {
    // node:test is not a TTY, so no prompt can be shown.
    const outcome = await checkPermission("write_file", { path: "a.ts" });
    assert.equal(outcome.decision, "deny");
    assert.match(outcome.reason ?? "", /not an interactive terminal/);
    assert.match(outcome.reason ?? "", /--no-approve/, "tells the user how to unblock it");
  });

  it("allows when the user pre-approved unattended runs", async () => {
    process.env["XYRO_NO_APPROVE"] = "1";
    const outcome = await checkPermission("write_file", { path: "a.ts" });
    assert.equal(outcome.decision, "allow");
  });

  it("still refuses credential paths even with pre-approval", async () => {
    process.env["XYRO_NO_APPROVE"] = "1";
    const outcome = await checkPermission("write_file", { path: ".env" });
    assert.equal(outcome.decision, "deny");
    assert.match(outcome.reason ?? "", /credentials/);
  });

  it("lets a saved allow rule work unattended", async () => {
    addRule({ action: "allow", tools: ["write_file"], paths: ["src/**"] });
    assert.equal((await checkPermission("write_file", { path: "src/a.ts" })).decision, "allow");
    assert.equal((await checkPermission("write_file", { path: "other.ts" })).decision, "deny");
  });

  it("lets a saved deny rule work unattended", async () => {
    addRule({ action: "deny", tools: ["run_command"] });
    const outcome = await checkPermission("run_command", { command: "ls" });
    assert.equal(outcome.decision, "deny");
    assert.match(outcome.reason ?? "", /permission rule denies run_command/);
  });

  it("names the rule that refused the call", async () => {
    const rule = addRule({ action: "deny", tools: ["write_file"], paths: ["secrets/**"] });
    const outcome = await checkPermission("write_file", { path: "secrets/a.txt" });
    assert.match(outcome.reason ?? "", new RegExp(rule.id));
  });

  it("explains itself to the agent", () => {
    const message = permissionDeniedResult("write_file", "no rule");
    assert.match(message, /⛔/);
    assert.match(message, /no rule/);
    assert.match(message, /Do NOT retry/);
  });
});

// ─── propose_write_file ─────────────────────────────────────────────────

describe("propose_write_file — no longer an unguarded writer", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("refuses a path outside the project", async () => {
    const outside = resolve(PROJECT, "..", "escaped.txt");
    const out = await proposeWriteFile({ path: outside, content: "nope" });
    assert.match(out, /outside the project/i);
    assert.equal(statSync(outside, { throwIfNoEntry: false }), undefined, "nothing was written");
  });

  it("refuses a ../ traversal", async () => {
    const out = await proposeWriteFile({ path: "../escaped.txt", content: "nope" });
    assert.match(out, /outside the project/i);
  });

  it("refuses an empty path", async () => {
    const out = await proposeWriteFile({ path: "  ", content: "x" });
    assert.match(out, /Invalid path/i);
  });

  it("does not write when there is no terminal to confirm with", async () => {
    const out = await proposeWriteFile({ path: "notes.md", content: "# hi" });
    assert.match(out, /refused/i);
    assert.match(out, /not modified/i);
    assert.equal(statSync(resolve(PROJECT, "notes.md"), { throwIfNoEntry: false }), undefined);
  });

  it("leaves the file untouched when the content already matches", async () => {
    writeFileSync(resolve(PROJECT, "same.md"), "same", "utf-8");
    const out = await proposeWriteFile({ path: "same.md", content: "same" });
    assert.match(out, /No changes needed/);
  });

  it("still routes through the permission gate as an ask-tool", () => {
    assert.equal(evaluatePermission("propose_write_file", { path: "notes.md" }), "ask");
  });
});

// ─── write tools under a saved rule ─────────────────────────────────────

describe("permissions — rules apply to the write tools", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("allows a permitted write and refuses a denied one", async () => {
    addRule({ action: "allow", tools: ["write_file"], paths: ["src/**"] });
    addRule({ action: "deny", tools: ["write_file"], paths: ["vendor/**"] });

    const ok = await checkPermission("write_file", { path: "src/a.ts" });
    assert.equal(ok.decision, "allow");
    const denied = await checkPermission("write_file", { path: "vendor/b.js" });
    assert.equal(denied.decision, "deny");

    assert.match(await writeFile({ path: "src/a.ts", content: "ok" }), /✅/);
  });

  it("keeps path confinement for edit_file regardless of rules", async () => {
    addRule({ action: "allow", tools: ["edit_file"] });
    const out = await editFile({ path: "../outside.txt", old_text: "a", new_text: "b" });
    assert.match(out, /outside the project/i);
  });

  it("refuses to edit a credential file even with an allow rule", async () => {
    writeFileSync(resolve(PROJECT, ".env"), "SECRET=1", "utf-8");
    addRule({ action: "allow", tools: ["edit_file"] });
    const out = await editFile({ path: ".env", old_text: "SECRET=1", new_text: "SECRET=2" });
    assert.match(out, /⛔|refused/i);
    assert.equal(readFileSync(resolve(PROJECT, ".env"), "utf-8"), "SECRET=1", "content untouched");
  });

  it("does not leak rules between checks after a reset", () => {
    addRule({ action: "deny", tools: ["write_file"] });
    assert.equal(evaluatePermission("write_file", { path: "a.ts" }), "deny");
    clearRules();
    assert.equal(evaluatePermission("write_file", { path: "a.ts" }), "ask");
  });
});