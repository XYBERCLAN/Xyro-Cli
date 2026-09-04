import pc from "picocolors";

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function clean(value: unknown): unknown {
  if (typeof value === "string") return value.replace(ANSI_RE, "");
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = clean(val);
    }
    return out;
  }
  return value;
}

function json(obj: Record<string, unknown>): void {
  console.log(JSON.stringify(clean(obj)));
}

// ─── Freebuff-style Shimmer Animation Engine ───────────────────────────

interface ActiveShimmer {
  text: string;
  prefix: string;
  baseColor: "cyan" | "yellow" | "magenta" | "green";
  startTime: number;
  frame: number;
  timer: NodeJS.Timeout;
}

let activeShimmer: ActiveShimmer | null = null;

function renderShimmerFrame(shimmer: ActiveShimmer): string {
  const chars = shimmer.text.split("");
  const n = chars.length;
  const pulse = shimmer.frame % n;
  const elapsed = ((performance.now() - shimmer.startTime) / 1000).toFixed(1);

  const formatted = chars
    .map((c, i) => {
      // Calculate distance from wave peak
      const dist = (pulse - i + n) % n;
      if (dist === 0) {
        // Peak of shimmer wave: bold white highlight
        return pc.bold(pc.white(c));
      } else if (dist === 1 || dist === n - 1) {
        // Shoulder of shimmer wave: bright saturated color
        if (shimmer.baseColor === "yellow") return pc.bold(pc.yellow(c));
        if (shimmer.baseColor === "magenta") return pc.bold(pc.magenta(c));
        return pc.bold(pc.cyan(c));
      } else if (dist === 2 || dist === n - 2) {
        // Mid-wave: standard color
        if (shimmer.baseColor === "yellow") return pc.yellow(c);
        if (shimmer.baseColor === "magenta") return pc.magenta(c);
        return pc.cyan(c);
      } else {
        // Background: dim subtle tone
        return pc.dim(c);
      }
    })
    .join("");

  return `  ${shimmer.prefix} ${formatted} ${pc.dim(`(${elapsed}s)`)}`;
}

function startShimmer(options: {
  text: string;
  prefix?: string;
  baseColor?: "cyan" | "yellow" | "magenta" | "green";
  intervalMs?: number;
}): void {
  if (jsonMode || !process.stdout.isTTY) return;

  // Stop any existing shimmer first
  stopShimmer();

  const shimmer: ActiveShimmer = {
    text: options.text,
    prefix: options.prefix || pc.cyan("✨"),
    baseColor: options.baseColor || "cyan",
    startTime: performance.now(),
    frame: 0,
    timer: null as any,
  };

  const interval = options.intervalMs || 100;
  shimmer.timer = setInterval(() => {
    shimmer.frame++;
    const line = renderShimmerFrame(shimmer);
    process.stdout.write(`\r${line}\x1b[K`);
  }, interval);

  activeShimmer = shimmer;
  // Initial frame
  process.stdout.write(`\r${renderShimmerFrame(shimmer)}\x1b[K`);
}

function stopShimmer(): void {
  if (activeShimmer) {
    clearInterval(activeShimmer.timer);
    activeShimmer = null;
    if (process.stdout.isTTY) {
      const width = Math.max(process.stdout.columns || 80, 80);
      process.stdout.write(`\r${" ".repeat(width)}\r`);
    }
  }
}

/** Show thinking indicator with Freebuff-style shimmering pulse & live timer */
export function renderThinking(text = "thinking..."): void {
  if (jsonMode) return;
  startShimmer({
    text,
    prefix: pc.cyan("◆"),
    baseColor: "cyan",
    intervalMs: 110,
  });
}

/** Clear thinking indicator (only if active) */
export function renderThinkingDone(): void {
  if (jsonMode) return;
  stopShimmer();
}

/** Show tool running indicator with shimmering animation */
export function renderToolRunning(name: string): void {
  if (jsonMode) return;
  startShimmer({
    text: `working on ${name}...`,
    prefix: pc.yellow("◇"),
    baseColor: "yellow",
    intervalMs: 100,
  });
}

/** Clear tool running indicator (only if active) */
export function renderToolRunningDone(): void {
  if (jsonMode) return;
  stopShimmer();
}

/** Show capacity / rate-limit waiting indicator */
export function renderCapacityWait(secondsRemaining?: number): void {
  if (jsonMode) return;
  const text = secondsRemaining
    ? `high demand — retrying in ${secondsRemaining}s...`
    : "high demand — starting soon...";
  startShimmer({
    text,
    prefix: pc.yellow("◇"),
    baseColor: "yellow",
    intervalMs: 120,
  });
}

// ─── Freebuff-style UI Components ─────────────────────────────────────

function visibleLength(str: string): number {
  return str.replace(ANSI_RE, "").length;
}

function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + "..." + str.slice(str.length - (maxLen - 3 - half));
}

/** Modern Freebuff-style rounded card header with responsive terminal width */
export function renderConfigBanner(model: string, provider: string): void {
  if (jsonMode) return;
  const termCols = process.stdout.columns || 80;
  // Available width for inner content (excluding left "  │  " and right "  │" = 8 chars)
  const maxInner = Math.max(36, termCols - 8);

  const rawCwd = process.cwd();
  const fitCwd = truncateMiddle(rawCwd, Math.max(20, maxInner - 6));

  const line1 = `${pc.bold(pc.yellow("◆ XYRO"))} ${pc.dim("•")} ${pc.bold(model)} ${pc.dim("•")} ${pc.cyan(provider)}`;
  const line2 = `${pc.dim("dir:")}  ${pc.dim(fitCwd)}`;
  const line3 = `${pc.dim("help:")} ${pc.dim("/help  /status  /model  /cost  /exit")}`;

  const lines = [line1, line2, line3];
  const maxContentLen = Math.max(...lines.map(visibleLength));
  const innerWidth = Math.min(maxInner, Math.max(maxContentLen, 44));

  const border = "─".repeat(innerWidth + 4);

  console.log(`  ${pc.cyan("╭" + border + "╮")}`);
  for (const line of lines) {
    const vLen = visibleLength(line);
    const pad = " ".repeat(Math.max(0, innerWidth - vLen));
    console.log(`  ${pc.cyan("│")}  ${line}${pad}  ${pc.cyan("│")}`);
  }
  console.log(`  ${pc.cyan("╰" + border + "╯")}`);
  console.log();
}

/** User message prompt styled with Freebuff badge */
export function renderUserMessage(content: string): void {
  if (jsonMode) {
    json({ type: "user", content });
    return;
  }
  console.log(`  ${pc.cyan("◆")} ${pc.bold(pc.white(content))}`);
  console.log();
}

/** Tool call displayed as a modern structured card */
export function renderToolCall(name: string, args: Record<string, unknown>, count: number): void {
  if (jsonMode) {
    json({ type: "tool_call", name, args, count });
    return;
  }
  renderThinkingDone();

  const argEntries = Object.entries(args);
  let summary = "";
  if (name === "run_terminal_command" && typeof args.command === "string") {
    summary = `$ ${args.command}`;
  } else if (argEntries.length === 1 && typeof argEntries[0][1] === "string") {
    summary = argEntries[0][1];
  } else if (argEntries.length > 0) {
    summary = JSON.stringify(args);
  }
  const preview = summary.length > 60 ? summary.slice(0, 60) + "..." : summary;

  console.log(`  ${pc.dim("╭─")} ${pc.cyan(name)} ${preview ? pc.dim(`(${preview})`) : ""}`);
}

/** Tool result displayed with execution outcome and elapsed time */
export function renderToolResult(result: string, elapsed?: string): void {
  if (jsonMode) {
    json({ type: "tool_result", content: result, elapsed });
    return;
  }
  renderThinkingDone();

  const isError = result.startsWith("❌") || result.includes("Error:") || result.includes("failed");
  const icon = isError ? pc.red("✗") : pc.green("✓");
  const first = result.split("\n")[0].replace(/^([\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[❌✅📄📝💻🌿🔍🌐📋⚡🛠️ℹ️⚠️])\s*/u, "");
  const truncated = first.length > 80 ? first.slice(0, 80) + "..." : first;
  const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";

  console.log(`  ${pc.dim("╰─")} ${icon} ${pc.dim(truncated)}${timer}`);
  console.log();
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) return [line];

  const words = line.split(" ");
  const wrapped: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      wrapped.push(current);
      current = word;
    }
  }

  if (current) {
    wrapped.push(current);
  }

  return wrapped.length > 0 ? wrapped : [line];
}

/** Assistant response formatted with vertical margin guideline and responsive word-wrap */
export function renderAssistant(content: string, elapsed?: string): void {
  if (jsonMode) {
    json({ type: "assistant", content });
    return;
  }
  stopShimmer();

  const cols = process.stdout.columns || 80;
  const maxContentWidth = Math.max(30, cols - 6);
  const stripped = stripMarkdown(content);
  const rawLines = stripped.split("\n");

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) {
      console.log(`  ${pc.dim("│")}`);
      continue;
    }
    const wrapped = wrapLine(rawLine, maxContentWidth);
    for (const line of wrapped) {
      console.log(`  ${pc.dim("│")} ${line}`);
    }
  }
  const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";
  console.log(`  ${pc.dim("╰─")}${timer}`);
  console.log();
}

export function renderError(msg: string): void {
  if (jsonMode) {
    json({ type: "error", message: msg });
    return;
  }
  stopShimmer();
  console.log(`  ${pc.red("✖")} ${pc.red(msg)}`);
}

export function renderInfo(msg: string): void {
  if (jsonMode) {
    json({ type: "info", message: msg });
    return;
  }
  console.log(`  ${pc.dim("ℹ")} ${pc.dim(msg)}`);
}

// ─── Streaming support ───────────────────────────────────────────

let streamBuffer = "";
let streamStarted = false;
let streamLineCol = 0;
let streamWordBuffer = "";

/** Begin a new streaming assistant response */
export function renderStreamStart(): void {
  stopShimmer();
  streamBuffer = "";
  streamStarted = true;
  streamLineCol = 0;
  streamWordBuffer = "";
}

/** Strip markdown formatting for terminal display */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")        // **bold** → bold
    .replace(/\*(.+?)\*/g, "$1")             // *italic* → italic
    .replace(/__(.+?)__/g, "$1")              // __bold__ → bold
    .replace(/_(.+?)_/g, "$1")               // _italic_ → italic
    .replace(/~~(.+?)~~/g, "$1")              // ~~strike~~ → strike
    .replace(/`(.+?)`/g, "$1")               // `code` → code
    .replace(/^#{1,6}\s+/gm, "")             // ### headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [text](url) → text
}

/** Append a streamed chunk to the current response with responsive word-wrapping */
export function renderStreamChunk(chunk: string): void {
  if (!streamStarted) {
    stopShimmer();
    streamBuffer = "";
    streamStarted = true;
    streamLineCol = 0;
    streamWordBuffer = "";
    process.stdout.write(`  ${pc.dim("│")} `);
  }
  streamBuffer += chunk;

  const cols = process.stdout.columns || 80;
  const maxContentWidth = Math.max(30, cols - 6);
  const text = stripMarkdown(chunk);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      // Flush current word before breaking line
      if (streamWordBuffer) {
        if (streamLineCol + streamWordBuffer.length > maxContentWidth && streamLineCol > 0) {
          process.stdout.write(`\n  ${pc.dim("│")} `);
          streamLineCol = 0;
        }
        process.stdout.write(streamWordBuffer);
        streamWordBuffer = "";
      }
      process.stdout.write(`\n  ${pc.dim("│")} `);
      streamLineCol = 0;
    } else if (ch === " " || ch === "\t") {
      // Word ended, flush it
      if (streamWordBuffer) {
        if (streamLineCol + streamWordBuffer.length > maxContentWidth && streamLineCol > 0) {
          process.stdout.write(`\n  ${pc.dim("│")} `);
          streamLineCol = 0;
        }
        process.stdout.write(streamWordBuffer);
        streamLineCol += streamWordBuffer.length;
        streamWordBuffer = "";
      }
      // Print the space (or wrap if at edge)
      if (streamLineCol + 1 > maxContentWidth) {
        process.stdout.write(`\n  ${pc.dim("│")} `);
        streamLineCol = 0;
      } else {
        process.stdout.write(ch);
        streamLineCol++;
      }
    } else {
      streamWordBuffer += ch;
      if (streamLineCol + streamWordBuffer.length > maxContentWidth) {
        if (streamLineCol > 0) {
          // Word doesn't fit on this line, push entire word to next line
          process.stdout.write(`\n  ${pc.dim("│")} `);
          streamLineCol = 0;
        } else if (streamWordBuffer.length >= maxContentWidth) {
          // Word alone is longer than maxContentWidth (e.g. huge URL), flush chunk
          process.stdout.write(streamWordBuffer);
          process.stdout.write(`\n  ${pc.dim("│")} `);
          streamWordBuffer = "";
          streamLineCol = 0;
        }
      }
    }
  }
}

/** Finalize the streaming response (add newline and elapsed time) */
export function renderStreamEnd(elapsed?: string): void {
  stopShimmer();
  if (streamWordBuffer) {
    const cols = process.stdout.columns || 80;
    const maxContentWidth = Math.max(30, cols - 6);
    if (streamLineCol + streamWordBuffer.length > maxContentWidth && streamLineCol > 0) {
      process.stdout.write(`\n  ${pc.dim("│")} `);
    }
    process.stdout.write(streamWordBuffer);
    streamWordBuffer = "";
  }
  if (streamStarted && streamBuffer) {
    const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";
    process.stdout.write(`\n  ${pc.dim("╰─")}${timer}\n\n`);
  }
  streamBuffer = "";
  streamStarted = false;
  streamLineCol = 0;
}