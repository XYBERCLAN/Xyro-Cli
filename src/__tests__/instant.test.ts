import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { matchInstant } from "../agent/instant.js";
import { runInWorkspace } from "../agent/workspace.js";

describe("Instant commands", () => {
  it("recognises whole-message requests that need no model", () => {
    const cases: Record<string, string> = {
      "run the tests": "run tests",
      "Run tests.": "run tests",
      "tests": "run tests",
      "please rerun all the tests": "run tests",
      "what changed?": "what changed",
      "git status": "what changed",
      "what did you change": "what changed",
      "show me the diff": "diff",
      "diff": "diff",
      "typecheck": "typecheck & lint",
      "check types pls": "typecheck & lint",
      "lint": "typecheck & lint",
      "show the repo map": "repo map",
      "project structure": "repo map",
      "check intents": "intent checks",
    };
    for (const [text, label] of Object.entries(cases)) assert.equal(matchInstant(text)?.label, label, text);
  });

  it("leaves anything with real intent to the model", () => {
    for (const text of [
      "run the tests and fix the failures",
      "why do the tests fail?",
      "write tests for the parser",
      "explain the diff",
      "what changed in the auth module since yesterday",
      "lint the new file and fix warnings",
    ]) {
      assert.equal(matchInstant(text), null, text);
    }
  });

  it("can be turned off", () => {
    process.env.XYRO_INSTANT = "off";
    try {
      assert.equal(matchInstant("run the tests"), null);
    } finally {
      delete process.env.XYRO_INSTANT;
    }
  });

  it("answers locally from git", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-instant-"));
    execSync("git init -q && git config user.email t@t && git config user.name t && echo a > a.txt && git add . && git commit -qm init", { cwd: tmp });
    await runInWorkspace(tmp, async () => {
      assert.match(await matchInstant("what changed")!.run(), /working tree is clean/);
      fs.writeFileSync(path.join(tmp, "a.txt"), "b\n");
      const changed = await matchInstant("what changed")!.run();
      assert.match(changed, /M a\.txt/);
      assert.match(changed, /1 file changed/);
      assert.match(await matchInstant("show the diff")!.run(), /^-a$/m);
    });
  });
});
