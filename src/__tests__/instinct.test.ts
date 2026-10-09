import { describe, it } from "node:test";
import assert from "node:assert";
import { instinctExpert } from "../agents/instinct.js";
import { renderSidePanel } from "../tui/side-panel.js";

const text = (rows: { spans: { text: string }[] }[]) => rows.map((r) => r.spans.map((s) => s.text).join("")).join("\n");

describe("Experts recognise their own work (no trigger words)", () => {
  it("each kind of work wakes its specialist", () => {
    const cases: Record<string, string> = {
      read_file: "scout", search_code: "scout", glob: "scout", repo_map: "scout",
      edit_file: "builder", write_file: "builder",
      run_tests: "tester", diagnostics: "reviewer", run_command: "devops",
      git_commit: "git", git_status: "git", web_search: "researcher", fetch_url: "researcher",
      propose_plan: "architect", intent_check: "verifier",
    };
    for (const [tool, expert] of Object.entries(cases)) assert.equal(instinctExpert(tool), expert, tool);
  });

  it("bookkeeping wakes nobody; unknown tools go to the narrowest expert that has them", () => {
    assert.equal(instinctExpert("end_turn"), null);
    assert.equal(instinctExpert("delegate"), null, "delegation shows the delegated expert instead");
    assert.equal(instinctExpert("totally_unknown_tool"), null);
    // git_pr_view is a git tool: also owned by the git expert by trade
    assert.equal(instinctExpert("git_pr_view"), "git");
  });

  it("the side panel shows the scout working while XYRO reads, without filling the AGENTS list", () => {
    const p = renderSidePanel(
      { mood: "thinking", caption: "working · read file", todos: [], plan: null, agents: [], instinct: [{ expert: "scout", title: "scout", status: "running", startedAt: Date.now() - 5000 }] },
      40,
      40,
      8,
      { mascot: false }
    );
    const all = text(p.rows);
    assert.match(all, /TEAM ─+ 1 working/);
    assert.match(all, /╭──S──╮/);
    assert.match(all, /scout/);
    assert.doesNotMatch(all, /AGENTS/, "instinct is not delegation");
  });
});
