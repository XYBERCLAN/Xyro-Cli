import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeTool } from "../tools/registry.js";
import { beginCheckpoint, rewindTo, listCheckpoints, _resetCheckpoints } from "../agent/checkpoints.js";
import { runHooks, projectHooksStatus, trustProjectHooks, _clearHookCache } from "../agent/hooks.js";

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-hooks-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "config");
  fs.mkdirSync(path.join(tmp, "config", "xyro"), { recursive: true });
  process.chdir(tmp);
  _resetCheckpoints();
  _clearHookCache();
});

afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  _clearHookCache();
});

describe("Checkpoints", () => {
  it("rewinds edited files and removes files created after the checkpoint", async () => {
    fs.writeFileSync("a.txt", "original");
    const cp = beginCheckpoint("change things", 3);
    await executeTool("write_file", { path: "a.txt", content: "changed once" });
    await executeTool("write_file", { path: "a.txt", content: "changed twice" });
    await executeTool("write_file", { path: "new.txt", content: "brand new" });
    assert.equal(fs.readFileSync("a.txt", "utf-8"), "changed twice");

    const r = rewindTo(cp.id)!;
    assert.equal(fs.readFileSync("a.txt", "utf-8"), "original");
    assert.equal(fs.existsSync("new.txt"), false);
    assert.deepEqual(r.restored, ["a.txt"]);
    assert.deepEqual(r.deleted, ["new.txt"]);
    assert.equal(r.historyLength, 3);
    assert.equal(listCheckpoints().length, 0, "later checkpoints are dropped");
  });

  it("rewinding to an earlier checkpoint undoes every later turn", async () => {
    fs.writeFileSync("b.txt", "v0");
    const first = beginCheckpoint("turn 1", 1);
    await executeTool("write_file", { path: "b.txt", content: "v1" });
    beginCheckpoint("turn 2", 3);
    await executeTool("write_file", { path: "b.txt", content: "v2" });
    rewindTo(first.id);
    assert.equal(fs.readFileSync("b.txt", "utf-8"), "v0");
  });
});

describe("Hooks", () => {
  const userHooks = (h: object) => fs.writeFileSync(path.join(tmp, "config", "xyro", "hooks.json"), JSON.stringify(h));

  it("a PreToolUse hook exiting 2 blocks the tool", async () => {
    fs.writeFileSync("secret.txt", "s");
    userHooks({ PreToolUse: [{ matcher: "read_file", command: "echo 'reading is off limits' >&2; exit 2" }] });
    const r = await executeTool("read_file", { path: "secret.txt" });
    assert.ok(r.startsWith("⛔ Blocked by a hook: reading is off limits"), r);
  });

  it("matchers only fire for matching tools", async () => {
    fs.writeFileSync("ok.txt", "fine");
    userHooks({ PreToolUse: [{ matcher: "write_file|edit_file", command: "exit 2" }] });
    const r = await executeTool("read_file", { path: "ok.txt" });
    assert.ok(r.includes("fine"));
  });

  it("PostToolUse output is passed back to the model", async () => {
    userHooks({ PostToolUse: [{ matcher: "write_file", command: "echo \"formatted $XYRO_TOOL\"" }] });
    const r = await executeTool("write_file", { path: "f.txt", content: "x" });
    assert.ok(r.includes("[hook output]") && r.includes("formatted write_file"), r);
  });

  it("project hooks run only after being trusted, and need re-trust when changed", async () => {
    fs.mkdirSync(".xyro");
    fs.writeFileSync(".xyro/hooks.json", JSON.stringify({ UserPromptSubmit: [{ command: "echo blocked >&2; exit 2" }] }));
    assert.equal(projectHooksStatus(), "untrusted");
    assert.equal((await runHooks("UserPromptSubmit", { prompt: "hi" })).blocked, false);

    assert.ok(trustProjectHooks());
    assert.equal(projectHooksStatus(), "trusted");
    assert.equal((await runHooks("UserPromptSubmit", { prompt: "hi" })).blocked, true);

    fs.writeFileSync(".xyro/hooks.json", JSON.stringify({ UserPromptSubmit: [{ command: "exit 2" }] }));
    _clearHookCache();
    assert.equal(projectHooksStatus(), "untrusted");
  });
});
