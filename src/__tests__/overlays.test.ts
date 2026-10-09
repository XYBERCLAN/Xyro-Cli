import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CommandPicker,
  AgentModePicker,
  StatusModal,
  CostModal,
  COMMAND_ITEMS,
  AGENT_MODE_DEFS,
} from "../tui/overlays.js";

describe("CommandPicker TUI Overlay", () => {
  it("initializes and opens correctly", () => {
    const picker = new CommandPicker();
    assert.strictEqual(picker.isOpen(), false);

    picker.open();
    assert.strictEqual(picker.isOpen(), true);

    const lines = picker.render(80);
    assert.ok(lines.length > 5, "Should render header, search bar, items and footer");
  });

  it("filters commands on query typing and selects on Enter", () => {
    const picker = new CommandPicker();
    picker.open();

    let selectedCmd: string | null = null;
    picker.onSelect((cmd) => {
      selectedCmd = cmd;
    });

    // Type "cost"
    for (const ch of "cost") {
      picker.handleKey(ch);
    }

    // Enter to run
    picker.handleKey("\r");
    assert.strictEqual(selectedCmd, "/cost");
    assert.strictEqual(picker.isOpen(), false);
  });

  it("closes on Escape key", () => {
    const picker = new CommandPicker();
    picker.open();

    let closed = false;
    picker.onClose(() => {
      closed = true;
    });

    picker.handleKey("\u001b");
    assert.strictEqual(picker.isOpen(), false);
    assert.strictEqual(closed, true);
  });
});

describe("AgentModePicker TUI Overlay", () => {
  it("displays all agent personas and allows selecting a mode", () => {
    const picker = new AgentModePicker();
    picker.open("Build");
    assert.strictEqual(picker.isOpen(), true);

    const lines = picker.render(80);
    assert.ok(lines.length >= 6);

    let chosenMode: string | null = null;
    picker.onSelect((mode) => {
      chosenMode = mode.name;
    });

    // Arrow down to Plan
    picker.handleKey("\u001b[B");
    // Enter to confirm
    picker.handleKey("\r");

    assert.strictEqual(picker.isOpen(), false);
    assert.strictEqual(chosenMode, "Plan");
  });
});

describe("StatusModal and CostModal Overlays", () => {
  it("renders status dashboard and dismisses on Enter", () => {
    const status = new StatusModal();
    status.open({
      model: "gemini-2.5-flash",
      provider: "Google AI Studio",
      agentName: "Build",
      cwd: "/workspace/project",
      gitBranch: "main",
      messagesCount: 14,
      toolCallsCount: 6,
      toolsCount: { total: 12, builtin: 10, plugins: 2 },
      mcpCount: 1,
      version: "0.3.0",
    });

    assert.strictEqual(status.isOpen(), true);
    const lines = status.render(80);
    assert.ok(lines.length >= 8);

    // Enter dismisses
    status.handleKey("\r");
    assert.strictEqual(status.isOpen(), false);
  });

  it("renders cost dashboard and dismisses on Escape", () => {
    const cost = new CostModal();
    cost.open({
      model: "gpt-4o",
      provider: "OpenAI",
      promptTokens: 12500,
      completionTokens: 3200,
      totalTokens: 15700,
      costUSD: "$0.0633",
    });

    assert.strictEqual(cost.isOpen(), true);
    const lines = cost.render(80);
    assert.ok(lines.length >= 6);

    // Escape dismisses
    cost.handleKey("\u001b");
    assert.strictEqual(cost.isOpen(), false);
  });
});
