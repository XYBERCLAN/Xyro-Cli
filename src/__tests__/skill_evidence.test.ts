import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { recordSkillOutcome, isQuarantined, trackRecord, skillHealth } from "../agents/skill-stats.js";
import { matchSkills, skillsIndex, findSkill } from "../agents/skills-catalog.js";
import { forgeSkill } from "../agents/skill-forge.js";

let tmp: string;
let oldCwd: string;
const oldEnv = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-skillev-"));
  process.env.HOME = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  oldCwd = process.cwd();
  process.chdir(tmp);
  execSync("git init -q && git config user.email t@t && git config user.name t && echo a > a.txt && git add . && git commit -qm init", { cwd: tmp });
});
afterEach(() => {
  process.chdir(oldCwd);
  process.env.HOME = oldEnv.HOME;
  if (oldEnv.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldEnv.XDG;
});

const skill = (name: string, description: string) => {
  fs.mkdirSync(path.join(tmp, ".xyro", "skills", name), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".xyro", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nbody`);
};

describe("Skill track records", () => {
  it("quarantines a skill that keeps failing verification; asking by name still works", () => {
    skill("react-forms", "build react forms with validation");
    assert.equal(matchSkills("build the signup react forms with validation")[0]?.name, "react-forms");
    for (let i = 0; i < 4; i++) recordSkillOutcome(["react-forms"], i === 0);
    assert.equal(trackRecord("react-forms"), "1/4 verified, quarantined");
    assert.ok(isQuarantined("react-forms"));
    assert.equal(matchSkills("build the signup react forms with validation").length, 0, "no longer auto-loaded");
    assert.ok(findSkill("react-forms"), "still available by name");
    assert.match(skillsIndex(tmp)!, /react-forms: .*\(1\/4 verified, quarantined\)/);
  });

  it("a proven skill outranks an untested one on the same match", () => {
    skill("api-route-a", "add an api route handler endpoint");
    skill("api-route-b", "add an api route handler endpoint");
    for (let i = 0; i < 3; i++) recordSkillOutcome(["api-route-b"], true);
    assert.ok(skillHealth("api-route-b") > skillHealth("api-route-a"));
    assert.equal(matchSkills("add an api route for users")[0].name, "api-route-b");
  });
});

describe("skill_forge", () => {
  const body = "## When\nAdding a CLI flag.\n\n## Steps\n1. Add the option in src/index.ts\n2. Normalise camelCase\n3. Add a test\n\n## Pitfall\ncommander camelCases flags.";

  it("saves a skill only when its evidence check passes now, and records the evidence", async () => {
    const failed = await forgeSkill({ name: "add-cli-flag", description: "How to add a new CLI flag in this project", body, check: "test -f missing.txt" });
    assert.match(failed, /Not saved: the evidence check fails/);
    assert.ok(!fs.existsSync(path.join(tmp, ".xyro", "skills", "add-cli-flag")));

    const ok = await forgeSkill({ name: "add-cli-flag", description: "How to add a new CLI flag in this project", body, check: "test -f a.txt" });
    assert.match(ok, /Forged skill "add-cli-flag"/);
    const text = fs.readFileSync(path.join(tmp, ".xyro", "skills", "add-cli-flag", "SKILL.md"), "utf-8");
    assert.match(text, /evidence: "`test -f a.txt` passed on \d{4}-\d{2}-\d{2} at commit [0-9a-f]+"/);
    assert.equal(findSkill("add-cli-flag")?.description, "How to add a new CLI flag in this project");
    assert.equal(trackRecord("add-cli-flag"), "1/1 verified");
    assert.match(await forgeSkill({ name: "add-cli-flag", description: "How to add a new CLI flag in this project", body, check: "true" }), /already exists/);
  });

  it("refuses thin, secret-bearing or dangerous skills", async () => {
    assert.match(await forgeSkill({ name: "X Y", description: "d".repeat(30), body, check: "true" }), /lowercase/);
    assert.match(await forgeSkill({ name: "thin", description: "too short", body, check: "true" }), /description/);
    assert.match(await forgeSkill({ name: "thin", description: "How to do the thing properly", body: "do it", check: "true" }), /too short/);
    assert.match(await forgeSkill({ name: "leaky", description: "How to call the payments API", body: body + "\nAPI_KEY=sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4", check: "true" }), /secret/);
    assert.match(await forgeSkill({ name: "boom", description: "How to clean the build folder", body, check: "rm -rf /" }), /dangerous/);
  });
});
