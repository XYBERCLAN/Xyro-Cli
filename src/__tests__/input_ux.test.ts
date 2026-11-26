import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInWorkspace } from "../agent/workspace.js";
import { previewToolDiff } from "../tools/preview.js";
import { fuzzyScore, FilePicker } from "../tui/file-picker.js";
import { PermissionModal } from "../tui/overlays.js";
import { TuiApp } from "../tui/app.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-ux-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("input UX — multiline and paste", () => {
  it("Shift+Enter inserts a newline instead of sending", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as { handleKey(k: string): void; input: string; promptRows(home?: boolean): { spans: unknown[] }[] };
    anyApp.handleKey("\u001b[13;2u");
    assert.equal(anyApp.input, "\n");
    assert.equal(anyApp.promptRows(false).length, 7, "two input rows + chrome");
    anyApp.handleKey("next line");
    assert.equal(anyApp.input, "\nnext line");
  });

  it("bracketed paste keeps newlines and does not submit", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as { handleKey(k: string): void; input: string };
    anyApp.handleKey("\u001b[200~");
    anyApp.handleKey("line one\nline two\n");
    anyApp.handleKey("\u001b[201~");
    assert.equal(anyApp.input, "line one\nline two\n");
  });

  it("arrows, Backspace and Delete step over a whole emoji", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as {
      handleKey(k: string): void;
      input: string;
      cursorPos: number;
      promptRows(home?: boolean): { spans: { text: string }[] }[];
    };
    anyApp.handleKey("é👍x");
    anyApp.handleKey("\u001b[D");
    anyApp.handleKey("\u001b[D");
    assert.equal(anyApp.cursorPos, 1);
    assert.ok(anyApp.promptRows(false).some((r) => r.spans.some((s) => s.text === "👍")), "cursor cell holds the whole emoji");
    anyApp.handleKey("\u001b[C");
    assert.equal(anyApp.cursorPos, 3);
    anyApp.handleKey("\u007f");
    assert.equal(anyApp.input, "éx");
    anyApp.handleKey("ab👍");
    anyApp.handleKey("\u001b[D");
    anyApp.handleKey("\u001b[3~");
    assert.equal(anyApp.input, "éabx");
  });

  it("Backspace, Delete and arrows treat multi-code-point emoji as one character", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as {
      handleKey(k: string): void;
      input: string;
      cursorPos: number;
      promptRows(home?: boolean): { spans: { text: string }[] }[];
    };
    for (const ch of ["❤️", "👍🏽", "🇫🇷", "👨‍👩‍👧", "é"]) {
      anyApp.input = "";
      anyApp.cursorPos = 0;
      anyApp.handleKey(`a${ch}b`);
      anyApp.handleKey("\u001b[D");
      anyApp.handleKey("\u001b[D");
      assert.equal(anyApp.cursorPos, 1, `left arrow steps over ${ch}`);
      assert.ok(anyApp.promptRows(false).some((r) => r.spans.some((s) => s.text === ch)), `cursor cell holds all of ${ch}`);
      anyApp.handleKey("\u001b[C");
      assert.equal(anyApp.cursorPos, 1 + ch.length, `right arrow steps over ${ch}`);
      anyApp.handleKey("\u007f");
      assert.equal(anyApp.input, "ab", `Backspace removes all of ${ch}`);
      anyApp.handleKey(ch);
      anyApp.handleKey("\u001b[D");
      anyApp.handleKey("\u001b[3~");
      assert.equal(anyApp.input, "ab", `Delete removes all of ${ch}`);
    }
  });

  it("a scrolled prompt line never cuts an emoji at its edges", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as {
      handleKey(k: string): void;
      promptRows(home?: boolean): { spans: { text: string }[] }[];
    };
    anyApp.handleKey("a" + "👍".repeat(200));
    const text = anyApp.promptRows(false).flatMap((r) => r.spans.map((s) => s.text)).join("");
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text), "no lone surrogates");
  });

  it("a paste cut at the size cap does not end in half an emoji", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as { handleKey(k: string): void; input: string };
    anyApp.handleKey("a".repeat(199_999) + "👍");
    assert.equal(anyApp.input.length, 199_999);
  });

  it("@ at a word boundary opens the file picker", () => {
    const app = new TuiApp();
    const anyApp = app as unknown as { handleKey(k: string): void; filePicker: FilePicker; input: string };
    anyApp.handleKey("@");
    assert.equal(anyApp.filePicker.isOpen(), true);
    assert.equal(anyApp.input, "", "the @ is a picker trigger, not prompt text");
    anyApp.handleKey("\u001b");
    assert.equal(anyApp.filePicker.isOpen(), false);
  });
});

describe("file picker", () => {
  it("scores subsequence matches and rejects unrelated queries", () => {
    assert.ok(fuzzyScore("src/tui/app.ts", "app") > 0);
    assert.ok(fuzzyScore("src/tui/app.ts", "stap") > 0);
    assert.ok(fuzzyScore("src/tui/app.ts", "tui") > fuzzyScore("src/tui/app.ts", "ts"));
    assert.equal(fuzzyScore("src/tui/app.ts", "zzz"), -1);
  });

  it("filters and selects the highlighted path", () => {
    const picker = new FilePicker();
    const anyPicker = picker as unknown as { visible: boolean; files: string[]; query: string; rebuild(): void };
    let picked = "";
    picker.onSelect((p) => (picked = p));
    anyPicker.visible = true;
    anyPicker.files = ["src/tui/app.ts", "src/tools/write.ts", "README.md"];
    anyPicker.query = "write";
    anyPicker.rebuild();
    picker.handleKey("\r");
    assert.equal(picked, "src/tools/write.ts");
  });
});

describe("approval diff preview", () => {
  it("previews a write and an edit as a plain unified diff", () =>
    runInWorkspace(dir, async () => {
      fs.writeFileSync(path.join(dir, "a.ts"), "const a = 1;\n");
      const write = previewToolDiff("write_file", { path: "a.ts", content: "const a = 2;\n" });
      assert.ok(write);
      assert.ok(write.includes("- const a = 1;"));
      assert.ok(write.includes("+ const a = 2;"));

      const edit = previewToolDiff("edit_file", { path: "a.ts", old_text: "1", new_text: "3" });
      assert.ok(edit);
      assert.ok(edit.some((l) => l.includes("- const a = 1;")));
      assert.ok(edit.some((l) => l.includes("+ const a = 3;")));
    }));

  it("returns null for non-file tools and missing files", () =>
    runInWorkspace(dir, async () => {
      assert.equal(previewToolDiff("run_command", { command: "ls" }), null);
      assert.equal(previewToolDiff("edit_file", { path: "missing.ts", old_text: "a", new_text: "b" }), null);
    }));

  it("renders the diff in the permission modal", async () => {
    const modal = new PermissionModal();
    void modal.ask("write_file: a.ts", ["--- a/a.ts", "+++ b/a.ts", "- old", "+ new"]);
    const text = modal.render(120).map((l) => l.spans.map((s) => s.text).join("")).join("\n");
    assert.match(text, /Changes:/);
    assert.match(text, /- old/);
    assert.match(text, /\+ new/);
    modal.handleKey("n");
  });
});
