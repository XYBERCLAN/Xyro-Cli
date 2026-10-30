import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { applyWorkingTreePatch } from "../agents/worktree.js";

// A worktree is only useful when the user's uncommitted diff lands in it: if
// git apply rejects the patch, the expert would judge HEAD instead of the real
// working tree. These tests pin the detection of that failure.
const read = (file: string) => fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");

describe("applyWorkingTreePatch", () => {
  let repo: string;

  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-apply-"));
    execSync("git init -q", { cwd: repo });
    execSync("git config user.name test && git config user.email test@example.com", { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    execSync("git add a.txt && git -c commit.gpgsign=false commit -q -m init", { cwd: repo });
  });

  const resetToBase = () => {
    execSync("git checkout -- a.txt", { cwd: repo });
  };

  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("returns null when the patch applies", async () => {
    resetToBase();
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "index 5626abf..f719efd 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-one",
      "+two",
      "",
    ].join("\n");
    assert.strictEqual(await applyWorkingTreePatch(repo, patch), null);
    assert.strictEqual(read(path.join(repo, "a.txt")), "two\n");
  });

  it("returns git's reason when the patch does not apply", async () => {
    resetToBase();
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "index 5626abf..f719efd 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-this line is not in the file",
      "+replacement",
      "",
    ].join("\n");
    const reason = await applyWorkingTreePatch(repo, patch);
    assert.ok(reason, "expected a failure reason");
    assert.match(reason, /patch|apply|error/i);
    // The worktree keeps its previous content instead of a half-applied patch
    assert.strictEqual(read(path.join(repo, "a.txt")), "one\n");
  });
});
