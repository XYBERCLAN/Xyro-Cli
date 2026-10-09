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
