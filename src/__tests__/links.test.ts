import { describe, it } from "node:test";
import assert from "node:assert";
import { SelectionManager } from "../tui/selection.js";
import { line, span } from "../tui/core.js";

describe("Links and copying in the chat", () => {
  const sel = () => {
    const s = new SelectionManager();
    s.frameRows = [line(span("See https://openrouter.ai/keys, then paste the key.")), line(span("no link here"))];
    return s;
  };

  it("finds the web address under a click, without trailing punctuation", () => {
    const s = sel();
    assert.equal(s.urlAt(10, 1), "https://openrouter.ai/keys");
    assert.equal(s.urlAt(2, 1), null, "outside the link");
    assert.equal(s.urlAt(3, 2), null);
  });

  it("a click is a click, not a selection: nothing is copied", () => {
    const s = sel();
    s.onMouse({ kind: "press", x: 10, y: 1 });
    s.onMouse({ kind: "release", x: 10, y: 1 });
    assert.equal(s.hasSelection(), false);
    assert.deepEqual(s.lastClick, { x: 10, y: 1 });
  });

  it("a tiny accidental drag is not a selection either; a real drag is", () => {
    const s = sel();
    s.onMouse({ kind: "press", x: 10, y: 1 });
    s.onMouse({ kind: "drag", x: 11, y: 1 });
    s.onMouse({ kind: "release", x: 11, y: 1 });
    assert.equal(s.hasSelection(), false);
    s.onMouse({ kind: "press", x: 5, y: 1 });
    s.onMouse({ kind: "drag", x: 30, y: 1 });
    s.onMouse({ kind: "release", x: 30, y: 1 });
    assert.equal(s.hasSelection(), true);
    assert.equal(s.lastClick, null);
  });
});
