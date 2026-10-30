import { describe, it } from "node:test";
import assert from "node:assert";
import { summarizeToolArgs } from "../agent/loop.js";

// The transcript shows one line per tool call: a readable target, never raw JSON
describe("summarizeToolArgs", () => {
  it("shows the path or command when there is one", () => {
    assert.equal(summarizeToolArgs({ path: "src/signup.js" }), "src/signup.js");
    assert.equal(summarizeToolArgs({ command: "npm   test" }), "npm test");
  });

  it("shows a task list's progress instead of its JSON", () => {
    const items = [
      { text: "Read the handler", status: "done" },
      { text: "Validate input", status: "in_progress" },
      { text: "Run the tests", status: "pending" },
    ];
    assert.equal(summarizeToolArgs({ items }), "3 tasks · 1 done");
    assert.equal(summarizeToolArgs({ items: [{ text: "Ship", status: "done" }] }), "1 task · 1 done");
  });

  it("shows an end-of-turn summary as text", () => {
    assert.equal(summarizeToolArgs({ summary: "Validation added;  tests pass." }), "Validation added; tests pass.");
  });

  it("falls back to compact JSON, and to nothing for empty args", () => {
    assert.equal(summarizeToolArgs({ count: 3 }), '{"count":3}');
    assert.equal(summarizeToolArgs({}), "");
  });
});
