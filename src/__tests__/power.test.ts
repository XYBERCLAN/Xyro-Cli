import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { multiEdit, parseTestOutput, repoMap, detectTestCommand } from "../tools/power.js";
import { editFile } from "../tools/write.js";

let tmp: string;
let oldCwd: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-power-"));
  oldCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(() => process.chdir(oldCwd));

describe("multi_edit", () => {
  it("applies edits across files", async () => {
    fs.writeFileSync("a.ts", "const x = 1;\nconst y = 2;\n");
    fs.writeFileSync("b.ts", "export const name = 'old';\n");
    const r = await multiEdit({
      edits: [
        { path: "a.ts", old_text: "const x = 1;", new_text: "const x = 10;" },
        { path: "a.ts", old_text: "const y = 2;", new_text: "const y = 20;" },
        { path: "b.ts", old_text: "'old'", new_text: "'new'" },
      ],
    });
    assert.ok(r.startsWith("✅ Applied 3 edits across 2 files"), r);
    assert.equal(fs.readFileSync("a.ts", "utf-8"), "const x = 10;\nconst y = 20;\n");
    assert.equal(fs.readFileSync("b.ts", "utf-8"), "export const name = 'new';\n");
  });

  it("writes nothing when any edit fails", async () => {
    fs.writeFileSync("a.ts", "alpha\n");
    fs.writeFileSync("b.ts", "beta\n");
    const r = await multiEdit({
      edits: [
        { path: "a.ts", old_text: "alpha", new_text: "ALPHA" },
        { path: "b.ts", old_text: "missing", new_text: "x" },
      ],
    });
    assert.ok(r.startsWith("❌") && r.includes("No files were changed"), r);
    assert.equal(fs.readFileSync("a.ts", "utf-8"), "alpha\n");
  });

  it("refuses ambiguous matches unless replace_all", async () => {
    fs.writeFileSync("c.ts", "foo foo\n");
    assert.ok((await multiEdit({ edits: [{ path: "c.ts", old_text: "foo", new_text: "bar" }] })).includes("matches 2 places"));
    await multiEdit({ edits: [{ path: "c.ts", old_text: "foo", new_text: "bar", replace_all: true }] });
    assert.equal(fs.readFileSync("c.ts", "utf-8"), "bar bar\n");
  });

  it("treats $ in replacement text literally", async () => {
    fs.writeFileSync("d.ts", "price\n");
    await multiEdit({ edits: [{ path: "d.ts", old_text: "price", new_text: "$&$1 cost" }] });
    assert.equal(fs.readFileSync("d.ts", "utf-8"), "$&$1 cost\n");
  });
});

describe("edit_file", () => {
  it("no longer replaces every match silently", async () => {
    fs.writeFileSync("e.ts", "a a\n");
    const r = await editFile({ path: "e.ts", old_text: "a", new_text: "b" });
    assert.ok(r.startsWith("❌") && r.includes("matches 2 places"), r);
    assert.equal(fs.readFileSync("e.ts", "utf-8"), "a a\n");
  });
});

describe("run_tests output parsing", () => {
  it("node:test / TAP", () => {
    const s = parseTestOutput("not ok 3 - adds numbers\n# pass 10\n# fail 1\n", "node:test");
    assert.deepEqual([s.passed, s.failed, s.failures], [10, 1, ["adds numbers"]]);
  });
  it("jest / vitest", () => {
    const s = parseTestOutput("● math › adds\nTests:       1 failed, 9 passed, 10 total\n");
    assert.deepEqual([s.passed, s.failed], [9, 1]);
    assert.ok(s.failures.includes("math › adds"));
  });
  it("pytest", () => {
    const s = parseTestOutput("FAILED tests/test_x.py::test_add - assert 1 == 2\n1 failed, 4 passed in 0.31s\n", "pytest");
    assert.deepEqual([s.passed, s.failed, s.failures], [4, 1, ["tests/test_x.py::test_add"]]);
  });
  it("go test", () => {
    const s = parseTestOutput("--- FAIL: TestAdd (0.00s)\nFAIL\tgithub.com/x/y\t0.01s\n", "go");
    assert.deepEqual(s.failures, ["TestAdd"]);
    assert.equal(s.failed, 1);
  });
  it("cargo test", () => {
    const s = parseTestOutput("test math::adds ... FAILED\ntest result: FAILED. 3 passed; 1 failed; 0 ignored\n", "cargo");
    assert.deepEqual([s.passed, s.failed, s.failures], [3, 1, ["math::adds"]]);
  });
  it("detects the runner from the project", () => {
    fs.writeFileSync("package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
    assert.deepEqual(detectTestCommand(tmp), { runner: "vitest", command: "npm test" });
  });
});

describe("repo_map", () => {
  it("ranks the most-referenced file first and respects focus", async () => {
    fs.mkdirSync("src");
    fs.writeFileSync("src/core.ts", "export function computeTotal(a: number) { return a; }\nexport class Cart {}\n");
    fs.writeFileSync("src/a.ts", "import { computeTotal, Cart } from './core';\ncomputeTotal(1); new Cart();\nexport function helperA() {}\n");
    fs.writeFileSync("src/b.ts", "import { computeTotal } from './core';\ncomputeTotal(2);\nexport function helperB() {}\n");
    fs.writeFileSync("src/auth.py", "class LoginService:\n    def check(self):\n        pass\n");
    const map = await repoMap({});
    assert.ok(map.indexOf("src/core.ts") < map.indexOf("src/a.ts"), map);
    assert.ok(map.includes("export function computeTotal(a: number)"));
    assert.ok(map.includes("class LoginService"));
    const focused = await repoMap({ focus: "login" });
    assert.ok(focused.indexOf("auth.py") < focused.indexOf("core.ts"), focused);
  });
});
