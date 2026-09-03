import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "../tools/read.js";
import { writeFile, editFile } from "../tools/write.js";
import { searchCode } from "../tools/search.js";
import { listFiles } from "../tools/fs.js";
import { generateDiff, generateInlineDiff } from "../tools/diff.js";
import { runCommand } from "../tools/shell.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(process.cwd(), "__test_tmp__");

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe("readFile", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("reads a file with line numbers", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "hello\nworld\n", "utf-8");

    const result = await readFile({ path: filePath });

    assert.ok(result.includes("lines"), `Expected 'lines' in result: ${result.slice(0, 200)}`);
    assert.ok(result.includes("1 | hello"), `Expected '1 | hello' in result`);
    assert.ok(result.includes("2 | world"), `Expected '2 | world' in result`);
  });

  it("handles \\r\\n line endings", async () => {
    const filePath = join(TEST_DIR, "crlf.txt");
    writeFileSync(filePath, "line1\r\nline2\r\n", "utf-8");

    const result = await readFile({ path: filePath });

    assert.ok(result.includes("1 | line1"));
    assert.ok(result.includes("2 | line2"));
  });
});

describe("writeFile", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("writes a new file and shows diff", async () => {
    const filePath = join(TEST_DIR, "new.txt");

    const result = await writeFile({ path: filePath, content: "hello world" });

    assert.ok(result.includes("Written to"));
    assert.ok(result.includes("new file"));
    assert.ok(existsSync(filePath));
  });

  it("shows diff when overwriting existing file", async () => {
    const filePath = join(TEST_DIR, "existing.txt");
    writeFileSync(filePath, "old content", "utf-8");

    const result = await writeFile({ path: filePath, content: "new content" });

    assert.ok(result.includes("Written to"));
    assert.ok(result.includes("- old content"));
    assert.ok(result.includes("+ new content"));
  });

  it("reports no changes when content is identical", async () => {
    const filePath = join(TEST_DIR, "same.txt");
    writeFileSync(filePath, "unchanged", "utf-8");

    const result = await writeFile({ path: filePath, content: "unchanged" });

    assert.ok(result.includes("no changes needed"));
  });

  it("creates directories recursively", async () => {
    const filePath = join(TEST_DIR, "a", "b", "c", "file.txt");

    await writeFile({ path: filePath, content: "nested" });

    assert.ok(existsSync(filePath));
  });
});

describe("editFile", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("replaces text and shows inline diff", async () => {
    const filePath = join(TEST_DIR, "edit.txt");
    writeFileSync(filePath, "hello world", "utf-8");

    const result = await editFile({
      path: filePath,
      old_text: "world",
      new_text: "XYRO",
    });

    assert.ok(result.includes("Edited"), `Expected 'Edited' in: ${result.slice(0, 200)}`);

    // Verify file was actually changed
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(filePath, "utf-8");
    assert.strictEqual(content, "hello XYRO");
  });

  it("returns error when target text not found", async () => {
    const filePath = join(TEST_DIR, "no-match.txt");
    writeFileSync(filePath, "hello", "utf-8");

    const result = await editFile({
      path: filePath,
      old_text: "nonexistent",
      new_text: "replaced",
    });

    assert.ok(result.includes("not found"));
  });
});

describe("searchCode", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("finds matching lines across files", async () => {
    writeFileSync(join(TEST_DIR, "a.ts"), "const x = 1;\nconst y = 2;\n", "utf-8");
    writeFileSync(join(TEST_DIR, "b.ts"), "const z = x + 1;\n", "utf-8");

    const result = await searchCode({ pattern: "const", path: TEST_DIR });

    assert.ok(result.includes("a.ts:1: const x = 1;"));
    assert.ok(result.includes("a.ts:2: const y = 2;"));
    assert.ok(result.includes("b.ts:1: const z = x + 1;"));
  });

  it("returns no matches message when nothing found", async () => {
    writeFileSync(join(TEST_DIR, "a.ts"), "hello\n", "utf-8");

    const result = await searchCode({ pattern: "xyz", path: TEST_DIR });

    assert.ok(result.includes("No matches"));
  });
});

describe("listFiles", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("lists directory structure", async () => {
    mkdirSync(join(TEST_DIR, "subdir"));
    writeFileSync(join(TEST_DIR, "file.txt"), "", "utf-8");
    writeFileSync(join(TEST_DIR, "subdir", "nested.txt"), "", "utf-8");

    const result = await listFiles({ path: TEST_DIR });

    assert.ok(result.includes("file.txt"));
    assert.ok(result.includes("subdir"));
    assert.ok(result.includes("nested.txt"));
  });

  it("returns empty message for empty directory", async () => {
    const result = await listFiles({ path: TEST_DIR });

    assert.ok(result.includes("Empty directory"));
  });
});

describe("generateDiff", () => {
  it("shows added and removed lines", () => {
    const diff = generateDiff("line1\nline2\n", "line1\nline3\n", "test.ts");

    assert.ok(diff.includes("line2"));
    assert.ok(diff.includes("line3"));
    assert.ok(diff.includes("1 removal"));
    assert.ok(diff.includes("1 addition"));
  });

  it("reports no changes for identical content", () => {
    const diff = generateDiff("same\n", "same\n", "test.ts");

    assert.ok(diff.includes("no changes"));
  });
});

describe("generateInlineDiff", () => {
  it("shows old and new text", () => {
    const diff = generateInlineDiff("old text", "new text", "test.ts");

    assert.ok(diff.includes("- old text"));
    assert.ok(diff.includes("+ new text"));
    assert.ok(diff.includes("test.ts"));
  });
});

describe("runCommand", () => {
  it("executes a simple command", async () => {
    const result = await runCommand({ command: "echo hello" });

    assert.ok(result.includes("hello"));
  });

  it("blocks dangerous commands", async () => {
    const result = await runCommand({ command: "rm -rf /" });

    assert.ok(result.includes("Refused"));
  });

  it("reports errors for invalid commands", async () => {
    const result = await runCommand({ command: "nonexistent_command_xyz_12345" });

    // On Windows, the error message is in French; on Unix, it's in English
    // Both should contain 'error' or 'not found' or '❌'
    assert.ok(
      result.includes("error") || result.includes("not found") || result.includes("❌"),
      `Expected error in result: ${result.slice(0, 200)}`
    );
  });
});
