import pc from "picocolors";

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

function json(obj: Record<string, unknown>): void {
  console.log(JSON.stringify(obj));
}

export function renderConfigBanner(model: string, provider: string): void {
  if (jsonMode) return;
  console.log(`  ${pc.dim("─").repeat(55)}`);
  console.log(`  ${pc.dim("┃")} ${pc.bold(pc.yellow("XYRO"))} ${pc.dim("·")} ${model} ${pc.dim("·")} ${provider}`);
  console.log(`  ${pc.dim("┃")} ${pc.dim(process.cwd())}`);
  console.log(`  ${pc.dim("┃")} ${pc.italic("commands:")} ${pc.dim("exit · clear · resume")}`);
  console.log(`  ${pc.dim("─").repeat(55)}`);
  console.log();
}

export function renderAssistant(content: string): void {
  if (jsonMode) {
    json({ type: "assistant", content });
    return;
  }
  const lines = content.split("\n");
  for (const line of lines) {
    console.log(`  ${pc.dim("┃")} ${line}`);
  }
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