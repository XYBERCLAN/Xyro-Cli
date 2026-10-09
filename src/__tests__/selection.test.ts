import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SelectionManager } from "../tui/selection.js";
import { line, span, visualWidth } from "../tui/core.js";

function frame(): any[] {
  return [
    line(span("hello world foo")),
    line(span("second line of text")),
    line(span("third row here")),
  ];
}

describe("Mouse Text Selection", () => {
  it("press → drag → release selects text across rows", () => {
    const sel = new SelectionManager();
    sel.frameRows = frame();

    sel.onMouse({ kind: "press", x: 3, y: 1 });
    assert.ok(sel.isSelecting(), "should be selecting after press");

    sel.onMouse({ kind: "drag", x: 8, y: 2 });
    sel.onMouse({ kind: "release", x: 8, y: 2 });

    assert.ok(sel.hasSelection(), "completed selection after release");
    const text = sel.selectedText();
    // Row 1: from col 3 to end-of-line; row 2: from col 1 through col 8
    assert.equal(text, "llo world foo\nsecond l");
  });

  it("plain click (zero-width) clears the selection", () => {
    const sel = new SelectionManager();
    sel.frameRows = frame();

    sel.onMouse({ kind: "press", x: 3, y: 1 });
    sel.onMouse({ kind: "release", x: 3, y: 1 });

    assert.equal(sel.hasSelection(), false);
    assert.equal(sel.selectedText(), "");
  });

  it("selects a full single row", () => {
    const sel = new SelectionManager();
    sel.frameRows = frame();

    sel.onMouse({ kind: "press", x: 1, y: 2 });
    sel.onMouse({ kind: "release", x: 19, y: 2 });

    assert.equal(sel.selectedText(), "second line of text");
  });

  it("supports right-to-left (reverse) drags", () => {
    const sel = new SelectionManager();
    sel.frameRows = frame();

    sel.onMouse({ kind: "press", x: 8, y: 2 });
    sel.onMouse({ kind: "drag", x: 3, y: 1 });
    sel.onMouse({ kind: "release", x: 3, y: 1 });

    // Same content as forward drag between those points (row 1 → end of line)
    assert.equal(sel.selectedText(), "llo world foo\nsecond l");
  });

  it("highlight overlay marks only rows in range", () => {
    const sel = new SelectionManager();
    sel.frameRows = frame();

    sel.onMouse({ kind: "press", x: 1, y: 2 });
    sel.onMouse({ kind: "release", x: 5, y: 2 });

    const overlay = sel.highlightOverlay();
    assert.equal(overlay.length, 1, "single-row selection overlays one row");
    const row = overlay[0]!;
    assert.ok(row.spans.some((s) => s.bg && s.fg), "highlight swaps fg/bg");
    // Highlighted span text is a prefix of the row
    const joined = row.spans.map((s) => s.text).join("");
    assert.ok(joined.startsWith("second"));
  });

  it("toast expires after its TTL", async () => {
    const sel = new SelectionManager();
    sel.showToast("Copied!", "success", 30);
    assert.ok(sel.hasToast());
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(sel.hasToast(), false);
  });

  it("clear() resets all state", () => {
    const sel = new SelectionManager();
    sel.frameRows = frame();
    sel.onMouse({ kind: "press", x: 1, y: 1 });
    sel.onMouse({ kind: "drag", x: 5, y: 3 });
    sel.onMouse({ kind: "release", x: 5, y: 3 });

    sel.clear();
    assert.equal(sel.hasSelection(), false);
    assert.equal(sel.isSelecting(), false);
    assert.equal(sel.selectedText(), "");
  });
});
