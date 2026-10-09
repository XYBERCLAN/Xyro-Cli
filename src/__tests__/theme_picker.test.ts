import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ThemePicker } from "../tui/theme-picker.js";
import { THEME_CATALOG } from "../ui/theme.js";

describe("ThemePicker TUI Overlay", () => {
  let picker: ThemePicker;

  beforeEach(() => {
    picker = new ThemePicker();
  });

  it("starts closed and opens without error", () => {
    assert.equal(picker.isOpen(), false);
    picker.open("xyro");
    assert.equal(picker.isOpen(), true);
  });

  it("renders rows when open and zero rows when closed", () => {
    picker.open("xyro");
    const rows = picker.render(120);
    assert.ok(rows.length > 0, "should render rows when open");
    picker.close();
    assert.equal(picker.render(120).length, 0, "should render nothing when closed");
  });

  it("Esc reverts without calling onSelect and fires onClose", () => {
    let selected: string | null = null;
    let closed = false;
    picker.onSelect((t) => { selected = t.id; });
    picker.onClose(() => { closed = true; });

    picker.open("xyro");
    picker.handleKey("\u001b[B"); // navigate to trigger live preview
    picker.handleKey("\u001b");   // Esc

    assert.equal(picker.isOpen(), false);
    assert.equal(selected, null, "onSelect should NOT fire on Esc");
    assert.equal(closed, true,   "onClose should fire on Esc");
  });

  it("Enter commits selection and fires onSelect", () => {
    let selectedId: string | null = null;
    picker.onSelect((t) => { selectedId = t.id; });

    picker.open("xyro");
    picker.handleKey("\u001b[B"); // down one
    picker.handleKey("\r");       // Enter

    assert.equal(picker.isOpen(), false);
    assert.ok(selectedId !== null, "onSelect should fire after Enter");
  });

  it("filters themes on search typing and Ctrl+U clears it", () => {
    picker.open("xyro");
    "matrix".split("").forEach((ch) => picker.handleKey(ch));
    const filtered = picker.render(120);
    assert.ok(filtered.length > 3, "filtered render should have layout rows");

    picker.handleKey(String.fromCharCode(21)); // Ctrl+U
    const all = picker.render(120);
    assert.ok(all.length >= filtered.length, "clearing filter should show same or more rows");
  });

  it("up/down stays in bounds without throwing", () => {
    picker.open("xyro");
    for (let i = 0; i < 20; i++) picker.handleKey("\u001b[A");
    for (let i = 0; i < 40; i++) picker.handleKey("\u001b[B");
    assert.equal(picker.isOpen(), true);
  });

  it("THEME_CATALOG contains valid entries", () => {
    assert.ok(THEME_CATALOG.length >= 6, "should have at least 6 themes");
    for (const t of THEME_CATALOG) {
      assert.ok(t.id,      `theme missing id: ${JSON.stringify(t)}`);
      assert.ok(t.name,    `theme missing name: ${t.id}`);
      assert.ok(t.primary, `theme missing primary: ${t.id}`);
    }
  });
});
