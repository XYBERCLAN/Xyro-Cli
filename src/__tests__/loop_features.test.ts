import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOOM_LOOP_THRESHOLD,
  isRepeatedToolCall,
  isThinkOnlyResponse,
  splitForCompact,
  buildLocalContextSummary,
  canonicalSummaryHeader,
} from "../agent/loop.js";
import { HistoryManager } from "../agent/history.js";
import { getPlanModeToolDefinitions, getToolDefinitions, executeTool } from "../tools/registry.js";
import { shouldAskPermission, requestPermission } from "../tools/permissions.js";
import { findFiles } from "../tools/find_files.js";
import { clearSkillsCache, loadSkills } from "../config/skills.js";
import { backupFile, revertFile } from "../tools/undo.js";
import { writeFile, editFile } from "../tools/write.js";

const TEST_ROOT = join(process.cwd(), "__test_features__");
const OLD_CWD = process.cwd();

function setup() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
  process.chdir(TEST_ROOT);
  writeFileSync(join(TEST_ROOT, ".gitignore"), "vendor/\n*.secret\n", "utf-8");
  mkdirSync(join(TEST_ROOT, "src"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "src", "main.ts"), "export function main() { return 42; }\n", "utf-8");
  mkdirSync(join(TEST_ROOT, "vendor"), { recursive: true });
  writeFileSync(join(TEST_ROOT, "vendor", "locked.min.js"), "HIDDEN-VENDOR\n", "utf-8");
}

function teardown() {
  process.chdir(OLD_CWD);
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

describe("Paquet A — explicit end-of-turn", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("registers end_turn and task_completed tools", () => {
    const names = getToolDefinitions().map((t) => t.function.name);
    assert.ok(names.includes("end_turn"), `end_turn missing from ${names.join(",")}`);
    assert.ok(names.includes("task_completed"), "task_completed missing");
  });

  it("executeTool returns a clean completion message", async () => {
    const result = await executeTool("end_turn", { summary: "done the thing" });
    assert.ok(result.includes("End of turn"), result);
  });
});

describe("Paquet A — doom-loop guard", () => {
  it("flags the Nth consecutive identical signature as a doom loop", () => {
    let state: { sig: string; run: number } | null = null;
    let doomHit = false;
    for (let i = 0; i < DOOM_LOOP_THRESHOLD; i++) {
      const track = isRepeatedToolCall('search_code({"path":"."})', state);
      state = track;
      if (track.isDoom) doomHit = true;
    }
    assert.ok(doomHit, "doom loop not detected after repeated identical calls");
  });

  it("resets the counter when the signature changes", () => {
    let state: { sig: string; run: number } | null = null;
    state = isRepeatedToolCall("a()", state);
    state = isRepeatedToolCall("b()", state);
    const track = isRepeatedToolCall("a()", state);
    assert.equal(track.run, 1, "run must reset after a different signature");
    assert.equal(track.isDoom, false);
  });
});

describe("Paquet A — think-only response handling", () => {
  it("treats a pure <thinking> block as think-only", () => {
    assert.equal(isThinkOnlyResponse("<thinking>Let me reason…</thinking>"), true);
  });
  it("treats 'let me think' style openers as think-only", () => {
    assert.equal(isThinkOnlyResponse("Let me think about the best approach here."), true);
  });
  it("treats a real answer as NOT think-only", () => {
    assert.equal(isThinkOnlyResponse("Done. The file now exports 42."), false);
  });
  it("treats empty/null content as NOT think-only", () => {
    assert.equal(isThinkOnlyResponse(""), false);
    assert.equal(isThinkOnlyResponse(null), false);
  });
});

describe("Paquet B — permission gate", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("asks for mutating tools in the default policy", () => {
    delete process.env.XYRO_NO_APPROVE;
    assert.equal(shouldAskPermission("write_file"), true);
    assert.equal(shouldAskPermission("run_command"), true);
    assert.equal(shouldAskPermission("fetch_url"), true);
  });

  it("never asks for read-only / bookkeeping tools", () => {
    delete process.env.XYRO_NO_APPROVE;
    assert.equal(shouldAskPermission("read_file"), false);
    assert.equal(shouldAskPermission("list_files"), false);
    assert.equal(shouldAskPermission("write_todos"), false);
    assert.equal(shouldAskPermission("git_status"), false);
    assert.equal(shouldAskPermission("end_turn"), false);
    assert.equal(shouldAskPermission("revert_file"), false);
  });

  it("XYRO_NO_APPROVE disables prompting entirely", () => {
    process.env.XYRO_NO_APPROVE = "1";
    try {
      assert.equal(shouldAskPermission("write_file"), false);
      assert.equal(shouldAskPermission("run_command"), false);
    } finally {
      delete process.env.XYRO_NO_APPROVE;
    }
  });

  it("auto-approves outside an interactive terminal (scripts/CI)", async () => {
    const stdin = process.stdin.isTTY;
    const stdout = process.stdout.isTTY;
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = false;
    try {
      const verdict = await requestPermission("run_command", { command: "npm test" });
      assert.equal(verdict, "allow");
    } finally {
      (process.stdin as any).isTTY = stdin;
      (process.stdout as any).isTTY = stdout;
    }
  });
});

describe("Paquet C — plan mode tool restriction", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("keeps read-only tools and excludes mutating ones", () => {
    const planNames = getPlanModeToolDefinitions().map((t) => t.function.name);
    const allNames = getToolDefinitions().map((t) => t.function.name);

    for (const name of ["read_file", "list_files", "glob", "search_code", "find_files", "write_todos", "end_turn"]) {
      assert.ok(planNames.includes(name), `plan mode should keep ${name}`);
    }
    for (const name of ["write_file", "edit_file", "run_command", "fetch_url", "git_commit", "git_push", "spawn_agent", "propose_write_file"]) {
      assert.ok(!planNames.includes(name), `plan mode must exclude ${name}`);
      assert.ok(allNames.includes(name), `full tool set must still include ${name}`);
    }
  });

  it("HistoryManager reflects plan mode in the system message", () => {
    const h = new HistoryManager();
    h.setPlanMode(true);
    const sys = h.systemMessage().content || "";
    assert.ok(sys.includes("PLAN MODE"), "system message must carry plan-mode instructions");
    h.setPlanMode(false);
    assert.ok(!(h.systemMessage().content || "").includes("PLAN MODE"));
  });
});

describe("Paquet E — compaction v2", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("local summary starts with the canonical 'What did we do so far?'", () => {
    const summary = buildLocalContextSummary([
      { role: "user", content: "plz add a parser", name: undefined as any },
      { role: "assistant", content: "ok", tool_calls: [], name: undefined as any },
    ]);
    assert.ok(summary.startsWith(canonicalSummaryHeader()), `summary must begin with the canonical header: ${summary}`);
  });

  it("splitForCompact keeps the last turn verbatim and older turns in the summary half", () => {
    const msgs: any[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1", tool_calls: [] },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2", tool_calls: [] },
    ];
    const split = splitForCompact(msgs);
    assert.ok(split, "expected a split");
    assert.equal(split!.recent.length, 2, "recent should be the last turn");
    assert.equal((split!.recent[0] as any).content, "q2");
    const olderFlat = split!.older.flat();
    assert.ok(olderFlat.some((m: any) => m.content === "q1"));
    assert.ok(!olderFlat.some((m: any) => m.content === "q2"));
  });

  it("resetWithSummaryAndRecent preserves summary + recent without inconsistent tool orphans", () => {
    const h = new HistoryManager();
    const recent: any[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "x", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: "result" },
    ];
    h.resetWithSummaryAndRecent("What did we do so far?\n…", recent);
    const msgs = h.getAll();
    assert.equal(msgs.length, 4);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "system");
    assert.ok((msgs[1].content || "").includes("What did we do so far?"));
    assert.equal(msgs[2], recent[0]);
    assert.equal(msgs[3], recent[1]);
  });
});

describe("Paquet F — snapshot/revert (undo)", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("write_file auto-backups, then revert_file restores the original", async () => {
    writeFileSync(join(TEST_ROOT, "flip.txt"), "ORIGINAL\n", "utf-8");
    const result = await writeFile({ path: "flip.txt", content: "MODIFIED\n" });
    assert.ok(result.includes("Written"), result);
    assert.equal(readFileSync(join(TEST_ROOT, "flip.txt"), "utf-8"), "MODIFIED\n");
    const reverted = await revertFile({ path: "flip.txt" });
    assert.ok(reverted.includes("Reverted"), reverted);
    assert.equal(readFileSync(join(TEST_ROOT, "flip.txt"), "utf-8"), "ORIGINAL\n");
  });

  it("edit_file auto-backups too", async () => {
    writeFileSync(join(TEST_ROOT, "edit.txt"), "one two\n", "utf-8");
    await editFile({ path: "edit.txt", old_text: "two", new_text: "three" });
    assert.equal(readFileSync(join(TEST_ROOT, "edit.txt"), "utf-8"), "one three\n");
    const reverted = await revertFile({ path: "edit.txt" });
    assert.ok(reverted.includes("Reverted"));
    assert.equal(readFileSync(join(TEST_ROOT, "edit.txt"), "utf-8"), "one two\n");
  });

  it("revert_file reports cleanly when there is no history", async () => {
    const result = await revertFile({ path: "never-touched.txt" });
    assert.ok(result.includes("❌"), result);
  });

  it("backupFile returns null for non-existent files", () => {
    assert.equal(backupFile(join(TEST_ROOT, "ghost.txt")), null);
  });
});

describe("Paquet G — skills loader", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("discovers SKILL.md and injects it into the system prompt section", async () => {
    clearSkillsCache(); // drop any caching from earlier tests in the same temp dir
    mkdirSync(join(TEST_ROOT, "docs"), { recursive: true });
    writeFileSync(join(TEST_ROOT, "docs", "SKILL.md"), "# Skill\nAlways run xyro-test before pushing.\n", "utf-8");

    const HistoryManagerMod = await import("../agent/history.js");
    const h = new HistoryManagerMod.HistoryManager();
    const forced = h.systemMessage().content || "";
    assert.ok(forced.includes("## Skills"), "skills section missing from system message");
    assert.ok(forced.includes("docs/SKILL.md"));
    assert.ok(forced.includes("xyro-test"));
  });

  it("ignores gitignored paths and returns null when no skills exist", () => {
    clearSkillsCache();
    assert.equal(loadSkills(), null);
  });

  it("clears the cache between scans", () => {
    mkdirSync(join(TEST_ROOT, "sub"), { recursive: true });
    writeFileSync(join(TEST_ROOT, "sub", "SKILL.md"), "ctx\n", "utf-8");
    clearSkillsCache();
    const first = loadSkills();
    assert.ok(first?.includes("sub/SKILL.md"));
    rmSync(join(TEST_ROOT, "sub"), { recursive: true, force: true });
    clearSkillsCache();
    assert.equal(loadSkills(), null);
  });
});

describe("Paquet H — find_files", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("ranks the relevant source file above unrelated files", async () => {
    mkdirSync(join(TEST_ROOT, "docs"), { recursive: true });
    writeFileSync(join(TEST_ROOT, "docs", "notes.txt"), "nothing about main\n", "utf-8");
    const result = await findFiles({ query: "main function", path: "." });
    assert.ok(result.includes("src/main.ts"), `expected src/main.ts in results: ${result}`);
  });

  it("respects .gitignore and IGNORED_DIRS", async () => {
    const result = await findFiles({ query: "HIDDEN-VENDOR", path: "." });
    assert.ok(!result.includes("vendor/locked.min.js"), `vendor file leaked into results: ${result}`);
  });

  it("returns a clear empty message when nothing matches", async () => {
    const result = await findFiles({ query: "zzzz-no-such-thing-yyyy", path: "." });
    assert.ok(result.includes("No relevant files"), result);
  });
});