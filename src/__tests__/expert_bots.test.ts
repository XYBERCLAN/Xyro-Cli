import { describe, it } from "node:test";
import assert from "node:assert";
import { botFrame, teamGrid, botsFor, BOT_W, BOT_H, Bot } from "../tui/expert-bots.js";
import { renderSidePanel } from "../tui/side-panel.js";
import { visualWidth } from "../tui/core.js";

const width = (row: { text: string }[]) => row.reduce((w, s) => w + visualWidth(s.text), 0);
const text = (rows: { text: string }[][]) => rows.map((r) => r.map((s) => s.text).join("")).join("\n");

describe("Expert mascots", () => {
  it("every frame is exactly BOT_W × BOT_H cells, in every state and beat", () => {
    for (const state of ["running", "done", "failed", "idle"] as const) {
      for (let tick = 0; tick < 60; tick++) {
        const f = botFrame({ name: "builder", title: "builder", state }, tick);
        assert.equal(f.length, BOT_H);
        for (const r of f) assert.equal(width(r), BOT_W, `${state}@${tick}: "${r.map((s) => s.text).join("")}"`);
      }
    }
  });

  it("is animated while working and still when idle except the drifting z", () => {
    const frames = (state: Bot["state"]) => new Set(Array.from({ length: 40 }, (_, t) => text(botFrame({ name: "api", title: "api", state }, t))));
    assert.ok(frames("running").size >= 4, "working bots move");
    assert.equal(frames("done").size, 1, "a finished bot rests");
    assert.match(text(botFrame({ name: "api", title: "api", state: "done" }, 0)), /\^ \^/);
    assert.match(text(botFrame({ name: "api", title: "api", state: "failed" }, 0)), /x x/);
  });

  it("shows working experts first, workers beside their lead, otherwise the resting team", () => {
    const bots = botsFor(
      [
        { expert: "tester", title: "Tester", status: "done" },
        { expert: "builder", title: "Builder", status: "running" },
        { expert: "builder-worker", title: "Builder worker 1", status: "running" },
      ],
      []
    );
    assert.deepEqual(bots.map((b) => [b.name, b.state, Boolean(b.worker)]), [["builder", "running", false], ["builder-worker", "running", true], ["tester", "done", false]]);
    assert.ok(botsFor([], [{ name: "scout", title: "Scout" }]).every((b) => b.state === "idle"));
  });

  it("fills only the free space at the bottom of the panel and never overflows", () => {
    const roster = ["scout", "architect", "builder", "tester", "reviewer", "security"].map((n) => ({ name: n, title: n }));
    for (const h of [12, 20, 30, 50]) {
      const p = renderSidePanel({ mood: "idle", caption: "Ready", todos: [], plan: null, roster }, 40, h, 3, { mascot: false });
      assert.equal(p.rows.length, h);
      const all = text(p.rows.map((r) => r.spans));
      if (h >= 20) assert.match(all, /TEAM/);
      else assert.doesNotMatch(all, /TEAM/, "no room, no team");
    }
    assert.deepEqual(teamGrid([], 40, 0, 30), []);
    assert.ok(teamGrid(roster.map((r) => ({ ...r, state: "idle" as const })), 40, 0, 30).every((r) => width(r) <= 40));
  });
});

describe("Waking up and working", () => {
  const frameText = (b: Bot, tick = 5) => text(botFrame(b, tick));

  it("an expert wakes up when it gets a task: dozing, eyes pop open, a happy hop, then work", () => {
    const at = (since: number) => frameText({ name: "builder", title: "builder", state: "running", since }, 5);
    assert.match(at(100), /- -/);
    assert.match(at(100), /z/);
    assert.match(at(600), /O O/);
    assert.match(at(600), /!/);
    assert.match(at(1000), /\^ \^/);
    assert.doesNotMatch(at(5000), /O O|z/, "after waking it works");
    for (const since of [0, 300, 700, 1100, 1300, 9000]) {
      for (const r of botFrame({ name: "builder", title: "builder", state: "running", since }, 3)) assert.equal(width(r), BOT_W);
    }
  });

  it("each kind of expert has its own work animation, and the eyes follow it", async () => {
    const { workStyle, workBeat } = await import("../tui/expert-bots.js");
    assert.equal(workStyle("scout"), "inspect");
    assert.equal(workStyle("tester"), "hunt");
    assert.equal(workStyle("builder-worker"), "build", "workers work like their lead");
    const sweep = [0, 1, 2].map((b) => workBeat("inspect", b));
    assert.deepEqual(sweep.map((s) => s.top.indexOf("o")), [0, 2, 4], "the lens sweeps across");
    assert.deepEqual(sweep.map((s) => s.eyes), ["● ●  ", " ● ● ", "  ● ●"], "the eyes follow the lens");
    assert.match(workBeat("hunt", 3).top, /x/, "the bug gets caught");
    for (const style of ["build", "inspect", "hunt", "write", "plan", "ship"] as const) {
      for (let b = 0; b < 8; b++) {
        const w = workBeat(style, b);
        assert.equal(visualWidth(w.top), 7, `${style} top`);
        assert.equal(visualWidth(w.eyes), 5, `${style} eyes`);
      }
    }
  });
});

describe("XYRO mascot wakes up and works", () => {
  it("wake-up closes then flashes the eyes open, then hops; working glances and hops now and then", async () => {
    const { mascotRows, pickMascot, mascotHop, workGlance } = await import("../tui/mascot.js");
    const art = pickMascot(30, 10)!;
    const chars = (rows: { spans: { text: string; fg?: string }[] }[]) => rows.map((r) => r.spans.map((s) => s.text).join("")).join("\n");
    assert.equal(chars(mascotRows(art, 0, "thinking", false, { wake: 0.1 })), art.blink.join("\n"), "eyes shut first");
    assert.equal(chars(mascotRows(art, 0, "thinking", false, { wake: 0.5 })), art.open.join("\n"), "then open");
    const flash = mascotRows(art, 0, "thinking", false, { wake: 0.5 }).flatMap((r) => r.spans).some((s) => s.fg === "#FFFFFF");
    assert.ok(flash, "with a bright flash");
    assert.equal(mascotHop(0, "thinking", 0.7), true);
    assert.equal(mascotHop(0, "thinking", 0.2), false);
    assert.equal(mascotHop(20, "idle"), false, "no hopping while idle");
    assert.deepEqual([0, 12, 24, 36].map(workGlance), [0, -1, 0, 1]);
    // Glancing only re-colours the eyes; the traced drawing never changes
    assert.equal(chars(mascotRows(art, 0, "thinking", false, { glance: -1 })), art.open.join("\n"));
  });

  it("the panel keeps the same height while XYRO hops", () => {
    for (const workingFor of [100, 700, 5000]) {
      for (const tick of [0, 1, 2, 20]) {
        const p = renderSidePanel({ mood: "thinking", caption: "thinking…", todos: [], plan: null, workingFor }, 40, 40, tick);
        assert.equal(p.rows.length, 40);
      }
    }
  });
});

describe("Team strip beside the input box", () => {
  it("always the same size, robots sit on the bottom edge, extras become +N", async () => {
    const { teamStrip, miniBotFrame, MINI_W, MINI_H } = await import("../tui/expert-bots.js");
    for (const state of ["running", "ready", "done", "failed", "idle"] as const) {
      for (let tick = 0; tick < 30; tick++) {
        const f = miniBotFrame({ name: "builder", title: "builder", state, since: tick * 100 }, tick);
        assert.equal(f.length, MINI_H);
        for (const r of f) assert.equal(width(r), MINI_W, `${state}@${tick}`);
      }
    }
    const many = ["scout", "architect", "builder", "tester", "reviewer", "security"].map((n) => ({ name: n, title: n, state: "idle" as const }));
    const strip = teamStrip(many, 36, 5, 0);
    assert.equal(strip.length, 5);
    assert.ok(strip.every((r) => width(r) <= 36));
    assert.match(text(strip), /\+3/);
    assert.equal(text([strip[0]]).trim(), "", "the robots sit on the bottom edge");
  });

  it("the side panel leaves the team out when it has its own strip", () => {
    const state = { mood: "idle" as const, caption: "", todos: [], plan: null, roster: [{ name: "scout", title: "scout" }] };
    const panelText = (opts: { mascot: boolean; team?: boolean }) => text(renderSidePanel(state, 40, 40, 0, opts).rows.map((r) => r.spans));
    assert.match(panelText({ mascot: false }), /TEAM/);
    assert.doesNotMatch(panelText({ mascot: false, team: false }), /TEAM/);
  });
});
