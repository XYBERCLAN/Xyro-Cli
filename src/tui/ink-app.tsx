import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import chalk from "chalk";
import { logoRows } from "./logo.js";
import { currentTheme, tint } from "../ui/theme.js";
import { agentColor } from "./components.js";

interface InkAppProps {
  model: string;
  provider: string;
  agentName: string;
  gitBranch: string;
  version: string;
  mcpCount: number;
  onSubmit: (text: string) => Promise<void>;
  onExit: () => void;
}

const PLACEHOLDERS = [
  "Fix broken tests",
  "What is the tech stack of this project?",
  "Fix a TODO in the codebase",
  "Refactor the authentication flow",
  "Add unit tests for recent tools",
];

const TIPS = [
  "Use /help to show the help dialog",
  "Use /model to switch AI models on the fly",
  "Press Tab to switch agent modes (Build, Plan, Review)",
  "Use /provider to change API key or provider",
  "Use /cost to track token usage and session expense",
  "Use /compact to summarize context when sessions get long",
  "Use /status to inspect active models and tool count",
];

const AGENT_MODES = [
  { name: "Build", colorIdx: 4 },   // Light Blue (#38BDF8)
  { name: "Plan", colorIdx: 0 },    // Blue (#3B82F6)
  { name: "Review", colorIdx: 1 },  // Lemon Green (#C6F135)
  { name: "Explore", colorIdx: 2 }, // Green (#22C55E)
];

export const XyroInkApp: React.FC<InkAppProps> = ({
  model,
  provider,
  agentName: initialAgentName,
  gitBranch,
  version,
  mcpCount,
  onSubmit,
  onExit,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;
  const height = stdout?.rows || 24;

  const [input, setInput] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [agentModeIdx, setAgentModeIdx] = useState(0);
  const [phIdx, setPhIdx] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState("");

  const currentMode = AGENT_MODES[agentModeIdx];
  const modeColor = agentColor(currentMode.colorIdx);
  const t = currentTheme();

  // Rotate tips and placeholders
  useEffect(() => {
    const timer = setInterval(() => {
      setPhIdx((prev) => (prev + 1) % PLACEHOLDERS.length);
      setTipIdx((prev) => (prev + 1) % TIPS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  useInput((char, key) => {
    // Ctrl+C to exit
    if (key.ctrl && char === "c") {
      onExit();
      exit();
      return;
    }

    // Ctrl+P toggle command palette
    if (key.ctrl && char === "p") {
      setPaletteOpen((prev) => !prev);
      return;
    }

    // Escape
    if (key.escape) {
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      setInput("");
      setCursorPos(0);
      return;
    }

    // Tab cycles agent mode
    if (key.tab) {
      setAgentModeIdx((prev) => (prev + 1) % AGENT_MODES.length);
      return;
    }

    // Enter submits
    if (key.return) {
      const trimmed = input.trim();
      if (!trimmed) return;
      setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 50));
      setHistoryIdx(-1);
      setInput("");
      setCursorPos(0);
      onSubmit(trimmed);
      return;
    }

    // Up / Down history navigation
    if (key.upArrow) {
      if (history.length === 0) return;
      if (historyIdx === -1) setSavedInput(input);
      const nextIdx = Math.min(history.length - 1, historyIdx + 1);
      setHistoryIdx(nextIdx);
      const val = history[nextIdx];
      setInput(val);
      setCursorPos(val.length);
      return;
    }

    if (key.downArrow) {
      if (historyIdx === -1) return;
      const nextIdx = historyIdx - 1;
      setHistoryIdx(nextIdx);
      const val = nextIdx === -1 ? savedInput : history[nextIdx];
      setInput(val);
      setCursorPos(val.length);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const next = input.slice(0, cursorPos - 1) + input.slice(cursorPos);
        setInput(next);
        setCursorPos(cursorPos - 1);
      }
      return;
    }

    // Left / Right arrows
    if (key.leftArrow) {
      setCursorPos((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos((prev) => Math.min(input.length, prev + 1));
      return;
    }

    // Character input
    if (char && !key.ctrl && !key.meta) {
      const next = input.slice(0, cursorPos) + char + input.slice(cursorPos);
      setInput(next);
      setCursorPos(cursorPos + char.length);
    }
  });

  const boxW = Math.max(48, Math.min(74, width - 6));
  const innerW = boxW - 2;

  // Render logo lines
  const logo = logoRows(width, height, 5);
  const logoW = Math.max(
    ...logo.map((r) => r.spans.reduce((acc, s) => acc + s.text.replace(/\u001b\[[0-9;]*m/g, "").length, 0))
  );
  const leftPad = Math.max(0, Math.floor((width - logoW) / 2));

  // Prompt Box Line 1: text or placeholder with glowing brand cursor
  const placeholderText = `sk anything ... "${PLACEHOLDERS[phIdx]}"`;
  const renderedText = input
    ? input.slice(0, cursorPos) + chalk.bgHex(modeColor).black(input[cursorPos] || " ") + input.slice(cursorPos + 1)
    : chalk.bgHex(modeColor).black("A") + chalk.hex(t.textMuted)(placeholderText);

  // Line 2: Build · Model Provider · max
  const provShort = provider ? provider.split(" ")[0] : "";
  const dot = chalk.hex(t.textMuted)(" · ");
  const line2 =
    chalk.hex(modeColor).bold(currentMode.name) +
    dot +
    chalk.hex(t.text)(model || "default") +
    (provShort ? " " + chalk.hex(t.textMuted)(provShort) : "") +
    dot +
    chalk.hex("#C6F135").bold("max");

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Centered Mascot Logo */}
      <Box flexDirection="column" marginTop={1} marginBottom={1} paddingLeft={leftPad}>
        {logo.map((row, idx) => (
          <Text key={idx}>{row.spans.map((s) => s.text).join("")}</Text>
        ))}
      </Box>

      {/* Command Palette if open */}
      {paletteOpen && (
        <Box
          alignSelf="center"
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginBottom={1}
          width={Math.min(50, width - 4)}
        >
          <Text bold color="cyan">
            Commands (Esc to close)
          </Text>
          <Text>
            {chalk.cyan("/help".padEnd(12))} Show available commands
          </Text>
          <Text>
            {chalk.cyan("/model".padEnd(12))} Switch active AI model
          </Text>
          <Text>
            {chalk.cyan("/provider".padEnd(12))} Reconfigure API provider
          </Text>
          <Text>
            {chalk.cyan("/cost".padEnd(12))} View token usage & cost
          </Text>
          <Text>
            {chalk.cyan("/status".padEnd(12))} Session status & tools
          </Text>
          <Text>
            {chalk.cyan("/exit".padEnd(12))} Exit XYRO
          </Text>
        </Box>
      )}

      {/* Input Box: rounded border, wider width 74, downward margin */}
      <Box
        alignSelf="center"
        flexDirection="column"
        width={boxW}
        marginTop={3}
        borderStyle="round"
        borderColor={modeColor}
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Text>{renderedText}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>{line2}</Text>
        </Box>
      </Box>

      {/* Key Hints */}
      <Box alignSelf="center" width={boxW} justifyContent="flex-end" marginTop={1}>
        <Text color="gray">
          {chalk.bold("tab")} agents {chalk.bold("ctrl+p")} commands
        </Text>
      </Box>

      {/* Rotating Tip */}
      <Box alignSelf="center" marginTop={2}>
        <Text>
          {chalk.hex(t.warning)("● Tip ")}
          {chalk.hex(t.textMuted)(TIPS[tipIdx])}
        </Text>
      </Box>

      {/* Sticky Footer */}
      <Box marginTop={1} justifyContent="space-between" paddingX={2}>
        <Text color="gray">
          {process.cwd().split("/").pop()}:{gitBranch} ⊙ {mcpCount} MCP /status
        </Text>
        <Text color="gray">{version}</Text>
      </Box>
    </Box>
  );
};
