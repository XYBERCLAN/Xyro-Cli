import pc from "picocolors";

export function renderConfigBanner(model: string, provider: string): void {
  console.log(`  ${pc.dim("─").repeat(55)}`);
  console.log(`  ${pc.dim("┃")} ${pc.bold(pc.yellow("XYBERCLAN"))} ${pc.dim("·")} ${model} ${pc.dim("·")} ${provider}`);
  console.log(`  ${pc.dim("┃")} ${pc.dim(process.cwd())}`);
  console.log(`  ${pc.dim("┃")} ${pc.italic("commands:")} ${pc.dim("exit · clear · resume")}`);
  console.log(`  ${pc.dim("─").repeat(55)}`);
  console.log();
}

export function renderAssistant(content: string): void {
  const lines = content.split("\n");
  for (const line of lines) {
    console.log(`  ${pc.dim("┃")} ${line}`);
  }
  console.log();
}

export function renderUserMessage(content: string): void {
  console.log(`  ${pc.cyan(">")} ${content}`);
  console.log();
}

export function renderToolCall(name: string, args: Record<string, unknown>, count: number): void {
  const info = JSON.stringify(args);
  const preview = info.length > 80 ? info.slice(0, 80) + "…" : info;
  console.log(`  ${pc.yellow("●")} ${pc.bold(name)} ${pc.dim(preview)}`);
}

export function renderToolResult(result: string, elapsed?: string): void {
  const first = result.split("\n")[0];
  const truncated = first.length > 100 ? first.slice(0, 100) + "…" : first;
  const timer = elapsed ? ` ${pc.dim(`(${elapsed}s)`)}` : "";
  console.log(`  ${pc.green("┃")} ${pc.dim(truncated)}${timer}`);
}

export function renderError(msg: string): void {
  console.log(`  ${pc.red("┃")} ${msg}`);
}

export function renderInfo(msg: string): void {
  console.log(`  ${pc.dim("┃")} ${msg}`);
}
