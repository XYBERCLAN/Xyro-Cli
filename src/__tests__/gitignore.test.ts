import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitIgnoreMatcher } from "../tools/gitignore.js";
import { listFiles } from "../tools/fs.js";

function matcherFor(gitignore: string): GitIgnoreMatcher {
  const root = mkdtempSync(join(tmpdir(), "xyro-gitignore-"));
  writeFileSync(join(root, ".gitignore"), gitignore, "utf-8");
  return new GitIgnoreMatcher(root);
}

describe("GitIgnoreMatcher: patterns end at a path-component boundary (#40)", () => {
  it("`build` hides the build dir and its contents, not src/builder.ts", () => {
    const m = matcherFor("build\n");
    assert.equal(m.isIgnored("build"), true);
    assert.equal(m.isIgnored("build/x.js"), true);
    assert.equal(m.isIgnored("src/build"), true);
    assert.equal(m.isIgnored("src/build/x.js"), true);
    assert.equal(m.isIgnored("src/builder.ts"), false);
    assert.equal(m.isIgnored("src/building.ts"), false);
  });

  it("`*.log` hides a.log at any depth, not a.logic.ts", () => {
    const m = matcherFor("*.log\n");
    assert.equal(m.isIgnored("a.log"), true);
    assert.equal(m.isIgnored("logs/a.log"), true);
    assert.equal(m.isIgnored("a.logic.ts"), false);
    assert.equal(m.isIgnored("src/a.log2"), false);
  });

  it("`test` hides test dirs, not contest.ts or src/testutil.ts", () => {
    const m = matcherFor("test\n");
    assert.equal(m.isIgnored("test"), true);
    assert.equal(m.isIgnored("src/test/util.ts"), true);
    assert.equal(m.isIgnored("contest.ts"), false);
    assert.equal(m.isIgnored("src/testutil.ts"), false);
  });

  it("`.env` hides exactly .env files, not .envrc or .env.local", () => {
    const m = matcherFor(".env\n");
    assert.equal(m.isIgnored(".env"), true);
    assert.equal(m.isIgnored("config/.env"), true);
    assert.equal(m.isIgnored(".envrc"), false);
    assert.equal(m.isIgnored("src/.env.local"), false);
  });

  it("a dir-only path pattern hides everything under that path only", () => {
    const m = matcherFor("src/generated/\n");
    assert.equal(m.isIgnored("src/generated"), true);
    assert.equal(m.isIgnored("src/generated/deep/file.ts"), true);
    assert.equal(m.isIgnored("src/generated.ts"), false);
    assert.equal(m.isIgnored("src/other.ts"), false);
  });

  it("negation still wins after the anchor change", () => {
    const m = matcherFor("*.log\n!keep.log\n");
    assert.equal(m.isIgnored("a.log"), true);
    assert.equal(m.isIgnored("keep.log"), false);
    assert.equal(m.isIgnored("logs/keep.log"), false);
  });
});

const TEST_ROOT = join(process.cwd(), "__test_gitignore__");
const PROJECT_DIR = join(TEST_ROOT, "project");

describe("list_files: .gitignore matching uses root-relative paths (#40)", () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(join(PROJECT_DIR, "src", "generated", "deep"), { recursive: true });
    mkdirSync(join(PROJECT_DIR, "build"), { recursive: true });
    process.chdir(PROJECT_DIR);
    writeFileSync(join(PROJECT_DIR, ".gitignore"), "build\n*.log\nsrc/generated/\n", "utf-8");
    writeFileSync(join(PROJECT_DIR, "src", "builder.ts"), "export const b = 1;\n", "utf-8");
    writeFileSync(join(PROJECT_DIR, "src", "generated", "deep", "hidden.ts"), "export const h = 1;\n", "utf-8");
    writeFileSync(join(PROJECT_DIR, "build", "out.js"), "console.log(1);\n", "utf-8");
    writeFileSync(join(PROJECT_DIR, "a.logic.ts"), "export const l = 1;\n", "utf-8");
    writeFileSync(join(PROJECT_DIR, "a.log"), "noise\n", "utf-8");
  });

  afterEach(() => {
    process.chdir(TEST_ROOT);
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("shows lookalike sources and hides real matches, including a path pattern below the top level", async () => {
    const result = await listFiles({ path: PROJECT_DIR });
    const lines = result.split("\n").map((l) => l.trim());
    assert.ok(lines.some((l) => l.endsWith("builder.ts")), result);
    assert.ok(lines.some((l) => l.endsWith("a.logic.ts")), result);
    assert.ok(!lines.some((l) => l.endsWith("hidden.ts")), result);
    assert.ok(!lines.some((l) => l.endsWith("generated/")), result);
    assert.ok(!lines.some((l) => l.endsWith("out.js")), result);
    assert.ok(!lines.some((l) => l === "📄 a.log"), result);
  });
});
