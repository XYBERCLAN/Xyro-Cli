import { describe, it } from "node:test";
import assert from "node:assert";
import { ScrollRegion, line, span, RenderLine } from "../tui/core.js";
import { fitToScreen } from "../tui/fit.js";
import { CommandPicker, ExpertsModal, COMMAND_ITEMS } from "../tui/overlays.js";

const text = (r: RenderLine) => r.spans.map((s) => s.text).join("");
const lines = (n: number, from = 0) => Array.from({ length: n }, (_, i) => line(span(`line ${from + i}`)));

describe("Chat scrolling", () => {
  it("scrolls up and down, never past the first line", () => {
    const s = new ScrollRegion();
    s.appendAll(lines(100));
    s.visible(20);
    s.scrollBy(500);
    assert.equal(text(s.visible(20)[0]), "line 0", "stops at the top");
    s.scrollBy(-3);
    assert.equal(text(s.visible(20)[0]), "line 3");
    s.scrollToBottom();
    assert.equal(text(s.visible(20)[19]), "line 99");
  });

  it("new messages don't move the view while you read older ones", () => {
    const s = new ScrollRegion();
    s.appendAll(lines(100));
    s.visible(20);
    s.scrollBy(30);
    const before = s.visible(20).map(text);
    s.appendAll(lines(5, 100));
    s.append(line(span("line 105")));
    assert.deepEqual(s.visible(20).map(text), before);
    assert.equal(s.isSticky(), false);
  });

  it("at the bottom it follows new messages", () => {
    const s = new ScrollRegion();
    s.appendAll(lines(30));
    s.visible(10);
    s.append(line(span("newest")));
    assert.equal(text(s.visible(10)[9]), "newest");
  });
});

describe("Long menus fit the screen", () => {
  it(`the main menu (${COMMAND_ITEMS.length} commands) keeps the search field and the selection in view`, () => {
    const p = new CommandPicker();
    p.open();
    const full = p.render(100);
    assert.ok(full.length > 20, "the menu is taller than a small screen");
    let scroll = 0;
    for (let i = 0; i < COMMAND_ITEMS.length; i++) {
      const fit = fitToScreen(p.render(100), 20, 4, scroll);
      scroll = fit.scroll;
      assert.ok(fit.rows.length <= 20, `fits (${fit.rows.length})`);
      assert.ok(fit.hasCursor);
      assert.match(text(fit.rows[2]), /❯/, "search field stays");
      const selected = fit.rows.filter((r) => /^│\s?▌/.test(text(r)));
      assert.equal(selected.length, 1, `selection visible at item ${i}`);
      p.handleKey("\u001b[B");
    }
  });

  it("shows how much is hidden above and below", () => {
    const p = new CommandPicker();
    p.open();
    for (let i = 0; i < 15; i++) p.handleKey("\u001b[B");
    const fit = fitToScreen(p.render(100), 20, 4, 0);
    const all = fit.rows.map(text).join("\n");
    assert.match(all, /↑ \d+ more/);
    assert.match(all, /↓ \d+ more · scroll or ↑↓/);
  });

  it("pop-ups without a list scroll freely; short pop-ups are untouched", () => {
    const tall = [line(span("╭ top ╮")), ...lines(40).map((l) => line(span("│"), ...l.spans, span("│"))), line(span("╰ hint ╯"))];
    const a = fitToScreen(tall, 20, 1, 0);
    assert.equal(a.hasCursor, false);
    const b = fitToScreen(tall, 20, 1, 10);
    assert.match(text(b.rows[2]), /line 10/);
    assert.match(text(b.rows[1]), /↑ 10 more/);
    const short = [line(span("a")), line(span("b"))];
    assert.equal(fitToScreen(short, 20, 1, 0).rows, short);
  });

  it("the experts roster scrolls with its selection too", () => {
    const m = new ExpertsModal();
    m.open(Array.from({ length: 25 }, (_, i) => ({ name: `e${i}`, title: `Expert ${i}`, description: "d", tools: [], skills: [], plugins: [], triggers: [], maxSteps: 8, source: "builtin", runs: 0, ok: 0, model: "", budget: 1000 })) as never);
    for (let i = 0; i < 24; i++) m.handleKey("\u001b[B");
    const fit = fitToScreen(m.render(100), 18, 1, 0);
    assert.ok(fit.rows.length <= 18);
    assert.ok(fit.rows.some((r) => /▌.*Expert 24/.test(text(r))), "last expert reachable");
  });
});
