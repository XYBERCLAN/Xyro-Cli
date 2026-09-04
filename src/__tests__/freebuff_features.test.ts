import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "../tools/read.js";
import { writeTodos } from "../tools/todos.js";
import { glob } from "../tools/glob.js";
import { getToolDefinitions } from "../tools/registry.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(process.cwd(), "__test_freebuff_tmp__");

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe("Windowed readFile", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("slices lines by start_line and end_line", async () => {
    const filePath = join(TEST_DIR, "lines.txt");
    const content = ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n");
    writeFileSync(filePath, content, "utf-8");

    const result = await readFile({ path: filePath, start_line: 2, end_line: 4 });

    assert.ok(result.includes("lines 2-4 of 5"));
    assert.ok(result.includes("2 | line 2"));
    assert.ok(result.includes("3 | line 3"));
    assert.ok(result.includes("4 | line 4"));
    assert.ok(!result.includes("1 | line 1"));
    assert.ok(!result.includes("5 | line 5"));
  });
});

describe("write_todos", () => {
  it("manages todo lifecycle: add, mark done, clear", async () => {
    // Clear initial state
    await writeTodos({ clear: true });

    // Add items
    const added = await writeTodos({ todos: ["Research architecture", "Implement feature"] });
    assert.ok(added.includes("1. Research architecture"));
    assert.ok(added.includes("2. Implement feature"));
    assert.ok(added.includes("[ ]"));

    // Mark done
    const marked = await writeTodos({ mark_done: [1] });
    assert.ok(marked.includes("[x] 1. Research architecture"));
    assert.ok(marked.includes("[ ] 2. Implement feature"));

    // Clear
    const cleared = await writeTodos({ clear: true });
    assert.ok(cleared.includes("cleared"));
  });
});

describe("glob pattern matching", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("finds files matching glob patterns", async () => {
    const sub = join(TEST_DIR, "nested", "deep");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(TEST_DIR, "root.ts"), "code", "utf-8");
    writeFileSync(join(sub, "child.ts"), "code", "utf-8");
    writeFileSync(join(sub, "child.js"), "code", "utf-8");

    const tsFiles = await glob({ pattern: "**/*.ts", path: TEST_DIR });
    assert.ok(tsFiles.includes("root.ts"));
    assert.ok(tsFiles.includes("child.ts"));
    assert.ok(!tsFiles.includes("child.js"));
  });
});

describe("Tool Registry completeness", () => {
  it("registers all upgraded tools in definitions", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.function.name);

    assert.ok(names.includes("read_file"));
    assert.ok(names.includes("propose_write_file"));
    assert.ok(names.includes("glob"));
    assert.ok(names.includes("write_todos"));
    assert.ok(names.includes("spawn_agent"));
  });
});
