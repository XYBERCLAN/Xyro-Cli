import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeFile, editFile } from "../tools/write.js";
import { readFile } from "../tools/read.js";
import { searchCode } from "../tools/search.js";
import { listFiles } from "../tools/fs.js";
import { glob } from "../tools/glob.js";
import { runCommand } from "../tools/shell.js";
import { fetchUrl } from "../tools/fetch.js";

const TEST_ROOT = join(process.cwd(), "__test_security__");
const PROJECT_DIR = join(TEST_ROOT, "project");
const OUTSIDE_DIR = join(TEST_ROOT, "outside");

function setup() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(PROJECT_DIR, { recursive: true });
  mkdirSync(OUTSIDE_DIR, { recursive: true });
  process.chdir(PROJECT_DIR);
  writeFileSync(join(PROJECT_DIR, ".gitignore"), "secret.txt\nnode_modules/\n.env\n", "utf-8");
  mkdirSync(join(PROJECT_DIR, "src"), { recursive: true });
  writeFileSync(join(PROJECT_DIR, "src", "ok.ts"), "const fine = 1;\n", "utf-8");
  writeFileSync(join(PROJECT_DIR, "secret.txt"), "TOP-SECRET-CONTENT\n", "utf-8");
  writeFileSync(join(PROJECT_DIR, ".env"), "API_KEY=should-be-hidden\n", "utf-8");
  writeFileSync(join(OUTSIDE_DIR, "outside.txt"), "OUTSIDE-CONTENT\n", "utf-8");
}

function teardown() {
  process.chdir(TEST_ROOT);
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

describe("edit_file replaces ALL occurrences when asked", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("replaces every occurrence not just the first", async () => {
    writeFileSync(join(PROJECT_DIR, "multi.txt"), "foo foo foo\n", "utf-8");
    const result = await editFile({
      path: "multi.txt",
      old_text: "foo",
      new_text: "bar",
    });
    assert.ok(result.includes("Edited"), result);
    const content = readFileSync(join(PROJECT_DIR, "multi.txt"), "utf-8");
    assert.equal(content, "bar bar bar\n");
  });

  it("reports error when target text not found", async () => {
    writeFileSync(join(PROJECT_DIR, "nomatch.txt"), "hello\n", "utf-8");
    const result = await editFile({
      path: "nomatch.txt",
      old_text: "zzz",
      new_text: "yyy",
    });
    assert.ok(result.includes("not found"), result);
  });
});

describe("path confinement — tools stay inside the project directory", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("write_file refuses paths outside cwd (incl. ../ traversal)", async () => {
    const result = await writeFile({
      path: join(OUTSIDE_DIR, "escaped.txt"),
      content: "pwned",
    });
    assert.ok(result.includes("❌"), `Expected refusal, got: ${result}`);
    assert.ok(!existsSync(join(OUTSIDE_DIR, "escaped.txt")), "File must not be written outside the project");
  });

  it("write_file refuses absolute paths outside cwd", async () => {
    const result = await writeFile({
      path: "/etc/xyro_probe_should_not_write",
      content: "pwned",
    });
    assert.ok(result.includes("❌"), `Expected refusal, got: ${result}`);
    assert.ok(!existsSync("/etc/xyro_probe_should_not_write"), "File must not be written outside the project");
  });

  it("read_file refuses paths outside cwd", async () => {
    const result = await readFile({
      path: join(OUTSIDE_DIR, "outside.txt"),
    });
    assert.ok(result.includes("❌"), `Expected refusal, got: ${result.slice(0, 100)}`);
  });

  it("search_code stays inside the provided scope", async () => {
    const result = await searchCode({
      pattern: "OUTSIDE-CONTENT",
      path: PROJECT_DIR,
    });
    assert.ok(!result.includes("outside.txt"), `Must not find outside files: ${result}`);
  });
});

describe(".gitignore is respected by exploration tools", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("list_files does not show .gitignore-entered files", async () => {
    const result = await listFiles({ path: PROJECT_DIR });
    assert.ok(!result.includes("secret.txt"), `secret.txt listed: ${result}`);
    assert.ok(!result.includes(".env"), `.env listed: ${result}`);
    assert.ok(result.includes("ok.ts"), `src/ok.ts should still be listed: ${result}`);
  });

  it("search_code ignores .gitignore-entered files", async () => {
    const result = await searchCode({ pattern: "TOP-SECRET", path: PROJECT_DIR });
    assert.ok(result.includes("No matches"), `Should not find secret: ${result}`);
  });

  it("glob ignores .gitignore-entered files", async () => {
    const result = await glob({ pattern: "**/*", path: PROJECT_DIR });
    assert.ok(!result.includes("secret.txt"), `secret.txt in glob: ${result}`);
    assert.ok(!result.includes(".env"), `.env in glob: ${result}`);
    assert.ok(result.includes("src/ok.ts"), `ok.ts should be in glob: ${result}`);
  });
});

describe("run_command dangerous filter hardening", () => {
  beforeEach(setup);
  afterEach(teardown);

  const dangerous = [
    "rm -rf /",
    "rm -rf /tmp/x",
    "rm -rf  /tmp/x",
    "rm -r -f /tmp/x",
    "rm -rf/tmp/x",
    "cd /tmp && rm -rf xyro_proj_test",
    "rm --recursive --force /tmp/x",
    "rm -If /tmp/x",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    "shutdown -h now",
    ":(){ :|:& };:",
  ];

  for (const cmd of dangerous) {
    it(`blocks: ${cmd}`, async () => {
      const result = await runCommand({ command: cmd });
      assert.ok(result.includes("Refused") || result.includes("❌"), `Not blocked: "${cmd}" → ${result.slice(0, 80)}`);
    });
  }

  it("still allows safe commands", async () => {
    const result = await runCommand({ command: "echo hello-safe" });
    assert.ok(result.includes("hello-safe"), result);
  });
});

describe("fetch_url blocks SSRF (private/local hostnames)", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("rejects localhost URL", async () => {
    const result = await fetchUrl({ url: "http://localhost:9/x" });
    assert.ok(result.includes("❌"), result);
  });

  it("rejects loopback IP", async () => {
    const result = await fetchUrl({ url: "http://127.0.0.1:9/x" });
    assert.ok(result.includes("❌"), result);
  });

  it("rejects link-local metadata endpoint", async () => {
    const result = await fetchUrl({ url: "http://169.254.169.254/latest/meta-data/" });
    assert.ok(result.includes("❌"), result);
  });
});

describe("spawn_agent inherits session credentials/model", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("sub-agent refuses cleanly when NO config and NO env are set (no silent OpenAI default)", async () => {
    const { spawnAgent } = await import("../tools/subagent.js");
    delete process.env.XYRO_MODEL;
    delete process.env.XYRO_API_KEY;
    delete process.env.XYRO_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    // Redirect persisted-config lookup to an empty dir so the node's real
    // ~/.config/xyro cannot leak the developer's live credentials into the test.
    const emptyCfg = join(TEST_ROOT, "empty_config");
    mkdirSync(emptyCfg, { recursive: true });
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = emptyCfg;
    process.env.XDG_DATA_HOME = join(TEST_ROOT, "empty_data");
    try {
      const result = await spawnAgent({
        type: "task_planner",
        prompt: "plan: untar the archive",
      });
      assert.ok(
        result.includes("❌") || result.includes("config") || result.includes("api key") || result.includes("model"),
        `Expected a clear config error, got: ${result.slice(0, 200)}`
      );
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
      delete process.env.XDG_DATA_HOME;
    }
  });
});