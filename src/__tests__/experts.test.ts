import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { trustProjectExperts, getExperts, getExpert, expandTools, BUILTIN_EXPERTS } from "../agents/experts.js";
import { pickExpert, rememberOutcome, readMemory } from "../agents/router.js";
import { parseFrontmatter } from "../agents/skills-catalog.js";
import { spawnAgent } from "../tools/subagent.js";

let tmp: string;
let oldCwd: string;
let oldXdg: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-experts-"));
  oldCwd = process.cwd();
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "config");
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(oldCwd);
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

describe("Expert routing", () => {
  const cases: [string, string][] = [
    ["the tests are failing with a TypeError, fix it", "debugger"],
    ["where is the provider API key stored?", "scout"],
    ["review the diff before I merge", "reviewer"],
    ["is run_command safe from shell injection?", "security"],
    ["write unit tests for the router", "tester"],
    ["commit these changes and open a pull request", "git"],
    ["update the README with the release steps", "docs"],
    ["plan how to migrate the loop to streaming tool calls", "architect"],
  ];
  for (const [task, expected] of cases) {
    it(`routes "${task}" → ${expected}`, () => {
      assert.equal(pickExpert(task).expert.name, expected);
    });
  }

  it("falls back to the builder when nothing matches", () => {
    assert.equal(pickExpert("zzz qqq").expert.name, "builder");
  });

  it("learns from outcomes (immune memory)", () => {
    const task = "tidy the flux capacitor module";
    assert.notEqual(pickExpert(task).expert.name, "docs");
    for (let i = 0; i < 4; i++) rememberOutcome("docs", task, true);
    assert.equal(pickExpert(task).expert.name, "docs");
    assert.equal(readMemory().experts.docs.ok, 4);
  });
});

describe("Expert roster", () => {
  it("read-only experts get no write or shell tools", () => {
    for (const name of ["scout", "reviewer", "security", "architect"]) {
      const e = getExpert(name)!;
      assert.ok(!e.tools.some((t) => ["write_file", "edit_file", "run_command"].includes(t)), `${name} must be read-only`);
    }
  });

  it("expands tool groups", () => {
    const tools = expandTools(["read", "shell", "my_plugin_tool"]);
    assert.ok(tools.includes("read_file") && tools.includes("run_command") && tools.includes("my_plugin_tool"));
  });

  it("loads trusted project experts from .xyro/agents; built-ins are never replaced by project files", () => {
    fs.mkdirSync(path.join(tmp, ".xyro", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".xyro", "agents", "db.md"),
      "---\nname: db-expert\ndescription: Designs schemas and writes safe SQL migrations\ntools: read, shell\nskills: postgres\ntriggers: sql, migration, schema\n---\nYou are a database specialist."
    );
    fs.writeFileSync(path.join(tmp, ".xyro", "agents", "scout.md"), "---\nname: scout\ndescription: Custom scout\n---\nCustom.");
    assert.equal(getExperts(tmp).length, BUILTIN_EXPERTS.length, "nothing loads before trust");
    assert.equal(trustProjectExperts(tmp), 2);
    const experts = getExperts(tmp);
    const db = experts.find((e) => e.name === "db-expert")!;
    assert.equal(db.source, "project");
    assert.ok(db.tools.includes("read_file") && db.tools.includes("run_command"));
    assert.deepEqual(db.skills, ["postgres"]);
    assert.equal(experts.find((e) => e.name === "scout")!.source, "builtin");
    assert.equal(experts.length, BUILTIN_EXPERTS.length + 1);
    assert.equal(pickExpert("write a sql migration for the users schema").expert.name, "db-expert");
  });
});

describe("Skill frontmatter", () => {
  it("parses single-line and folded descriptions", () => {
    const one = parseFrontmatter("---\nname: tdd\ndescription: Test first.\n---\nBody");
    assert.equal(one.fields.description, "Test first.");
    assert.equal(one.body, "Body");
    const folded = parseFrontmatter("---\nname: x\ndescription: >-\n  Line one\n  line two\n---\n");
    assert.equal(folded.fields.description, "Line one line two");
  });
});

describe("spawn_agent compatibility", () => {
  it("rejects unknown legacy types", async () => {
    const r = await spawnAgent({ type: "nope" as never, prompt: "x" });
    assert.ok(r.includes("Unknown sub-agent type"));
  });
});
