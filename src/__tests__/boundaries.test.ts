import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeTool, getToolDefinitions, loadToolGroups, _resetToolGroups, CORE_TOOLS } from "../tools/registry.js";
import { _resetOutsideReads } from "../tools/safety.js";
import { setToolApprover } from "../agent/ui-bridge.js";
import { shouldAskPermission } from "../tools/permissions.js";
import { saveProviderKey } from "../config/persist.js";
import { noteRateLimit, isCoolingDown, noteRejectedKey, isKeyRejected, _resetPool } from "../providers/pool.js";
import { HistoryManager } from "../agent/history.js";

let tmp: string;
let project: string;
let outside: string;
let oldCwd: string;
let oldXdg: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-bounds-"));
  project = path.join(tmp, "project");
  outside = path.join(tmp, "elsewhere");
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, "in.txt"), "inside");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside data");
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
  process.chdir(project);
  _resetOutsideReads();
  _resetPool();
});
afterEach(() => {
  setToolApprover(null);
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

describe("XYRO stays in the project", () => {
  it("reading outside the project asks first; a no is respected", async () => {
    const asked: string[] = [];
    setToolApprover(async (label) => (asked.push(label), false));
    const out = await executeTool("read_file", { path: path.join(outside, "secret.txt") });
    assert.match(out, /^⛔ Not read: .* is outside the project/);
    assert.doesNotMatch(out, /outside data/);
    assert.deepEqual(asked, [`Read outside the project: ${outside}`]);
    assert.match(await executeTool("list_files", { path: "../elsewhere" }), /^⛔/);
  });

  it("a yes opens that folder for the session (asked once); writes outside stay blocked", async () => {
    let asks = 0;
    setToolApprover(async () => (asks++, true));
    assert.match(await executeTool("read_file", { path: path.join(outside, "secret.txt") }), /outside data/);
    assert.match(await executeTool("search_code", { pattern: "outside", path: outside }), /secret\.txt/);
    assert.equal(asks, 1, "not asked again for the same folder");
    const w = await executeTool("write_file", { path: path.join(outside, "new.txt"), content: "x" });
    assert.match(w, /outside the project/);
    assert.ok(!fs.existsSync(path.join(outside, "new.txt")));
  });

  it("inside the project nothing is asked", async () => {
    setToolApprover(async () => {
      throw new Error("should not ask");
    });
    assert.match(await executeTool("read_file", { path: "in.txt" }), /inside/);
  });
});

describe("Bugs fixed", () => {
  it("git_init needs approval", () => {
    assert.equal(shouldAskPermission("git_init"), true);
  });

  it("the task list belongs to this session only (no shared file)", async () => {
    await executeTool("write_todos", { items: [{ text: "step", status: "in_progress" }] });
    assert.ok(!fs.existsSync(path.join(os.homedir(), ".xyro", "todos.json")) || fs.statSync(path.join(os.homedir(), ".xyro", "todos.json")).mtimeMs < Date.now() - 5000, "nothing written to ~/.xyro");
    await executeTool("write_todos", { clear: true });
  });

  it("saving a new key gives the provider a fresh start (new account, new key)", () => {
    saveProviderKey("openrouter", "old-key-123456789");
    noteRateLimit("openrouter", Object.assign(new Error("quota exceeded"), { status: 429 }));
    noteRejectedKey("openrouter", "old-key-123456789");
    assert.ok(isCoolingDown("openrouter"));
    saveProviderKey("openrouter", "brand-new-key-987654321");
    assert.equal(isCoolingDown("openrouter"), false);
    assert.equal(isKeyRejected("openrouter", "brand-new-key-987654321"), false);
  });
});

describe("Small requests", () => {
  it("the coordinator gets a core set of tools; groups load on demand; unloaded tools still work", async () => {
    _resetToolGroups();
    const names = getToolDefinitions().map((t) => t.function.name);
    assert.ok(names.length <= CORE_TOOLS.size + 2, `core only (${names.length})`);
    assert.ok(!names.includes("git_push") && !names.includes("assign_workers"));
    assert.match(loadToolGroups(["git"]), /Loaded git/);
    assert.ok(getToolDefinitions().some((t) => t.function.name === "git_push"));
    assert.match(loadToolGroups(["nope"]), /Unknown group/);
    _resetToolGroups();
    assert.match(await executeTool("git_status", {}), /.+/, "a tool works even when its group isn't loaded");
  });

  it("the fixed cost of a request stays small (system prompt + tools)", () => {
    _resetToolGroups();
    const sys = String(new HistoryManager().getAll()[0].content);
    const tools = JSON.stringify(getToolDefinitions());
    const tokens = Math.round((sys.length + tools.length) / 4);
    assert.ok(tokens < 5500, `≈${tokens} tokens per request before the conversation`);
  });
});
