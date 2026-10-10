import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LanguagePicker, LANGUAGES } from "../tui/language-picker.js";
import { savePersistedConfig, loadPersistedConfig } from "../config/persist.js";
import { HistoryManager } from "../agent/history.js";

let oldXdg: string | undefined;
beforeEach(() => {
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-welcome-"));
});
afterEach(() => {
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

const text = (p: LanguagePicker) => p.render(100).map((l) => l.spans.map((s) => s.text).join("")).join("\n");

describe("First launch: language", () => {
  it("welcomes the user and offers languages in their own names", () => {
    const p = new LanguagePicker();
    p.open(undefined, true);
    const t = text(p);
    assert.match(t, /Welcome to XYRO\./);
    for (const native of ["English", "Français", "Español", "Kiswahili", "中文"]) assert.ok(t.includes(native), native);
    assert.match(t, /▌ English/, "English is selected first");
  });

  it("enter picks the highlighted language; Esc on the welcome keeps English and moves on", () => {
    const picked: string[] = [];
    const p = new LanguagePicker();
    p.onSelect((l) => picked.push(l.code));
    p.open(undefined, true);
    p.handleKey("\u001b[B");
    p.handleKey("\r");
    assert.deepEqual(picked, ["fr"]);
    assert.equal(p.isOpen(), false);
    p.open(undefined, true);
    p.handleKey("\u001b");
    assert.deepEqual(picked, ["fr", "en"]);
  });

  it("the choice is saved and XYRO replies in it", () => {
    savePersistedConfig({ language: "fr" });
    assert.equal(loadPersistedConfig().language, "fr");
    assert.match(String(new HistoryManager().getAll()[0].content), /always reply in French/);
    savePersistedConfig({ language: "en" });
    assert.doesNotMatch(String(new HistoryManager().getAll()[0].content), /always reply in/);
  });

  it("every language has its own words for the greeting", () => {
    assert.equal(new Set(LANGUAGES.map((l) => l.choose)).size, LANGUAGES.length);
  });
});
