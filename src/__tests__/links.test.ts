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

describe("Opening links safely (security review)", () => {
  it("only well-formed http(s) addresses, never through a shell", async () => {
    const { browserCommand } = await import("../tui/app.js");
    assert.deepEqual(browserCommand("https://openrouter.ai/keys", "win32"), { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", "https://openrouter.ai/keys"] });
    assert.deepEqual(browserCommand("https://openrouter.ai/keys", "linux"), { cmd: "xdg-open", args: ["https://openrouter.ai/keys"] });
    assert.equal(browserCommand("https://x.example/a&calc.exe", "win32"), null, "an & would run a command through cmd");
    assert.equal(browserCommand("https://x.example/^|whoami", "win32"), null);
    assert.equal(browserCommand("file:///etc/passwd", "linux"), null);
    assert.equal(browserCommand("javascript:alert(1)", "linux"), null);
    assert.equal(browserCommand("not a url", "linux"), null);
  });
});
