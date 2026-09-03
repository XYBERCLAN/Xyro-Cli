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

export function renderConfigBanner(model: string, provider: string): void {
  if (jsonMode) return;
  console.log(`  ${pc.dim("─").repeat(55)}`);
  console.log(`  ${pc.dim("┃")} ${pc.bold(pc.yellow("XYRO"))} ${pc.dim("·")} ${model} ${pc.dim("·")} ${provider}`);
  console.log(`  ${pc.dim("┃")} ${pc.dim(process.cwd())}`);
  console.log(`  ${pc.dim("┃")} ${pc.italic("commands:")} ${pc.dim("/help · /status · /model · /cost · /compact · /exit")}`);
  console.log(`  ${pc.dim("─").repeat(55)}`);
  console.log();
}

export function renderAssistant(content: string, elapsed?: string): void {
  if (jsonMode) {
    json({ type: "assistant", content });
    return;
  }
  const stripped = stripMarkdown(content);
  const lines = stripped.split("\n");
  for (const line of lines) {
    console.log(`  ${pc.dim("┃")} ${line}`);
  }
  const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";
  console.log(`  ${pc.dim("┃")}${timer}`);
  console.log();
}

export function renderUserMessage(content: string): void {
  if (jsonMode) {
    json({ type: "user", content });
    return;
  }
  console.log(`  ${pc.cyan(">")} ${content}`);
  console.log();
}

export function renderToolCall(name: string, args: Record<string, unknown>, count: number): void {
  if (jsonMode) {
    json({ type: "tool_call", name, args, count });
    return;
  }
  const info = JSON.stringify(args);
  const preview = info.length > 80 ? info.slice(0, 80) + "…" : info;
  console.log(`  ${pc.yellow("●")} ${pc.bold(name)} ${pc.dim(preview)}`);
}

export function renderToolResult(result: string, elapsed?: string): void {
  if (jsonMode) {
    json({ type: "tool_result", content: result, elapsed });
    return;
  }
  const first = result.split("\n")[0];
  const truncated = first.length > 100 ? first.slice(0, 100) + "…" : first;
  const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";
  console.log(`  ${pc.green("┃")} ${pc.dim(truncated)}${timer}`);
}

export function renderError(msg: string): void {
  if (jsonMode) {
    json({ type: "error", message: msg });
    return;
  }
  console.log(`  ${pc.red("┃")} ${msg}`);
}

export function renderInfo(msg: string): void {
  if (jsonMode) {
    json({ type: "info", message: msg });
    return;
  }
  console.log(`  ${pc.dim("┃")} ${msg}`);
}

// ─── Streaming support ───────────────────────────────────────────

let streamBuffer = "";
let streamStarted = false;

/** Begin a new streaming assistant response */
export function renderStreamStart(): void {
  streamBuffer = "";
  streamStarted = true;
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

/** Append a streamed chunk to the current response */
export function renderStreamChunk(chunk: string): void {
  if (!streamStarted) {
    renderStreamStart();
    // Print a clean prefix before the first chunk
    process.stdout.write(`  ${pc.dim("┃")} `);
  }
  streamBuffer += chunk;
  // Strip markdown for clean terminal display
  process.stdout.write(stripMarkdown(chunk));
}

/** Finalize the streaming response (add newline and elapsed time) */
export function renderStreamEnd(elapsed?: string): void {
  if (streamStarted && streamBuffer) {
    const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";
    process.stdout.write(`\n  ${pc.dim("┃")}${timer}\n`);
  }
  streamBuffer = "";
  streamStarted = false;
}