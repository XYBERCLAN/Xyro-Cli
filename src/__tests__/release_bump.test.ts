import { describe, it } from "node:test";
import assert from "node:assert";
import { computeBump } from "../../scripts/release-bump.mjs";

describe("Automatic release type", () => {
  it("follows Conventional Commits", () => {
    assert.equal(computeBump(["docs: readme", "chore: deps", "test: more"], "1.2.0"), "none");
    assert.equal(computeBump(["fix(tui): flicker", "docs: x"], "1.2.0"), "patch");
    assert.equal(computeBump(["perf: faster pool"], "1.2.0"), "patch");
    assert.equal(computeBump(["fix: a", "feat(agents): council"], "1.2.0"), "minor");
    assert.equal(computeBump(["feat!: new config format"], "1.2.0"), "major");
    assert.equal(computeBump(["refactor: x\n\nBREAKING CHANGE: removed --old"], "1.2.0"), "major");
  });

  it("stays below 1.0 for breaking changes while the version is 0.x", () => {
    assert.equal(computeBump(["feat!: big change"], "0.3.0"), "minor");
  });

  it("honours [release] / [skip release] and ignores its own version commits", () => {
    assert.equal(computeBump(["chore: tweak the mascot [release]"], "1.0.0"), "patch");
    assert.equal(computeBump(["feat: wip [skip release]"], "1.0.0"), "none");
    assert.equal(computeBump(["chore(release): v1.0.1"], "1.0.0"), "none");
  });
});
