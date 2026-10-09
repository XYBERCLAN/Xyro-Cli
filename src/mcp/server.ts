// `xyro mcp` — XYRO as an MCP server.
//
// Why: Claude Code, Cursor, Codex and friends run on one paid model. Plug
// XYRO in as an MCP server and they can hand work to XYRO's team instead:
// a tournament of free models judged by your tests, a specialist expert, a
// second opinion from a different model family, a repo map — all spent from
// free quotas, not the host's bill.
//
//   claude mcp add xyro -- xyro mcp
//   { "mcpServers": { "xyro": { "command": "xyro", "args": ["mcp"] } } }
//
// The host asks you before each call (its own approval rules); XYRO's hard
// safety net — path confinement, dangerous-command filter, privacy shield —
// still applies to everything its experts do.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { xyroVersion } from "../version.js";
import { tournament } from "../agents/tournament.js";
import { delegate } from "../tools/delegate.js";
import { getExperts } from "../agents/experts.js";
import { repoMap } from "../tools/power.js";
import { runIntents, formatIntentResults } from "../agent/intents.js";
import { webSearch } from "../tools/websearch.js";
import { poolStatus } from "../providers/pool.js";
import { initializeTools } from "../tools/registry.js";

type Json = Record<string, unknown>;

export interface ServedTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, Json>; required?: string[] };
  run: (args: Json) => Promise<string>;
}

const str = (description: string): Json => ({ type: "string", description });

export function servedTools(): ServedTool[] {
  return [
    {
      name: "xyro_tournament",
      description:
        "Have 2-4 free models from different providers solve a coding task in parallel, each in its own git worktree. Each result is judged locally (check command or the project's tests, saved intents, type checker) and only a passing winner is merged into the working tree. Costs no paid tokens.",
      inputSchema: {
        type: "object",
        properties: {
          task: str("The task, fully specified"),
          check: str("Command that exits 0 when the task is done (default: the project's tests)"),
          contestants: { type: "number", description: "2-4 (default 3)" },
        },
        required: ["task"],
      },
      run: (a) => tournament({ task: String(a.task ?? ""), check: a.check as string | undefined, contestants: a.contestants as number | undefined }),
    },
    {
      name: "xyro_delegate",
      description: `Hand a task to one of XYRO's specialist experts running on a free model (it reads, edits and verifies on its own). Use expert "reviewer" for a second opinion from a different model family. Experts: ${getExperts().map((e) => e.name).join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: { task: str("What to do"), expert: str("Expert name (default: auto-routed)"), context: str("Anything the expert should know") },
        required: ["task"],
      },
      run: (a) => delegate({ task: String(a.task ?? ""), expert: a.expert as string | undefined, context: a.context as string | undefined }),
    },
    {
      name: "xyro_repo_map",
      description: "Compact map of the repository: files with their key symbols, ranked by relevance to an optional focus.",
      inputSchema: { type: "object", properties: { path: str("Sub-folder (default: project root)"), focus: str("Topic to rank by") } },
      run: (a) => repoMap({ path: a.path as string | undefined, focus: a.focus as string | undefined }),
    },
    {
      name: "xyro_intents_check",
      description: "Re-run the user's saved requirements (.xyro/intents.json) and report which still hold.",
      inputSchema: { type: "object", properties: {} },
      run: async () => formatIntentResults(await runIntents()),
    },
    {
      name: "xyro_web_search",
      description: "Search the web (DuckDuckGo, or Tavily / Brave / SearXNG when configured).",
      inputSchema: { type: "object", properties: { query: str("Search query"), max_results: { type: "number" } }, required: ["query"] },
      run: (a) => webSearch({ query: String(a.query ?? ""), max_results: a.max_results as number | undefined }),
    },
    {
      name: "xyro_quota",
      description: "Free-quota capacity XYRO can draw from right now, per provider.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const rows = poolStatus();
        if (!rows.length) return "No providers connected. Run `xyro` and add free keys with /provider.";
        return rows
          .map((r) => `${r.name}: ${r.connected ? (r.coolingForMs ? `resting ${Math.ceil(r.coolingForMs / 60_000)}m` : "ready") : "no key"} · ${r.requestsToday} requests today${r.learnedDailyRequests ? ` of ~${r.learnedDailyRequests}` : ""}`)
          .join("\n");
      },
    },
  ];
}

export function createXyroMcpServer(): Server {
  const tools = servedTools();
  const server = new Server({ name: "xyro", version: xyroVersion() }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool ${req.params.name}` }], isError: true };
    try {
      const text = await tool.run((req.params.arguments ?? {}) as Json);
      return { content: [{ type: "text", text }], isError: text.startsWith("❌") };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  });
  return server;
}

/** Serve over stdio until the host disconnects. */
export async function serveMcp(): Promise<void> {
  // stdout carries the protocol: anything else printed there would corrupt it
  console.log = console.error;
  console.info = console.error;
  await initializeTools();
  const server = createXyroMcpServer();
  // The host closing our stdin is the end of the session
  process.stdin.on("end", () => process.exit(0));
  server.onclose = () => process.exit(0);
  await server.connect(new StdioServerTransport());
}
