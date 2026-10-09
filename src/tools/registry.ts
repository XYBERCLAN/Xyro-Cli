import { searchSkills } from "../agents/skills-catalog.js";
import { tournament } from "../agents/tournament.js";
import { saveIntent, runIntents, removeIntent, formatIntentResults } from "../agent/intents.js";
import OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Tool } from "../agent/types.js";
import { readFile } from "./read.js";
import { writeFile, editFile } from "./write.js";
import { runCommand } from "./shell.js";
import { listFiles } from "./fs.js";
import { searchCode } from "./search.js";
import { astInspectFile, astFindSymbol } from "./ast.js";
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitCommit,
  gitBranch,
  gitCheckout,
  gitInit,
  gitStash,
  gitStashPop,
  gitPush,
  gitCreatePr,
  gitPrView,
  gitAdd,
  gitDiffStaged,
  gitDiffUnstaged,
  gitReset,
  gitShow,
  gitCreateBranch,
  gitPull,
  gitFetch,
  gitRemote,
  gitRebase,
  gitPrList,
  gitPrStatus,
} from "./git.js";
import { writeTodos } from "./todos.js";
import { delegate, delegateTeam, heal, runWorkflow } from "./delegate.js";
import { spawnAgent, spawnAgents } from "./subagent.js";
import { fetchUrl } from "./fetch.js";
import { glob } from "./glob.js";
import { findFiles } from "./find_files.js";
import { revertFile } from "./undo.js";
import { proposeWriteFile } from "./propose.js";
import { endTurn } from "./end_turn.js";
import { repoMap, multiEdit, runTests, diagnostics } from "./power.js";
import { postNote, formatNotes } from "../agents/team-board.js";
import { bgStart, bgOutput, bgStop, bgList } from "./background.js";
import { webSearch } from "./websearch.js";
import { proposePlan } from "./plan.js";
import { loadPlugins } from "../config/plugins.js";
import { runHooks } from "../agent/hooks.js";
import { pathsTouchedBy, recordBeforeChange } from "../agent/checkpoints.js";

function defineTool<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  execute: (args: z.infer<T>) => Promise<string>
): Tool {
  const jsonSchema = zodToJsonSchema(schema, { target: "openAi" }) as Record<string, unknown>;
  delete jsonSchema["$schema"];

  return {
    definition: {
      type: "function",
      function: {
        name,
        description,
        parameters: jsonSchema,
      },
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      const parsed = schema.safeParse(rawArgs || {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; ");
        return `❌ Invalid arguments for tool '${name}': ${issues}`;
      }
      return execute(parsed.data);
    },
  };
}

// Built-in tools with runtime validation and schema generation
const builtinTools: Tool[] = [
  defineTool(
    "read_file",
    "Read file contents with line numbers",
    z.object({
      path: z.string().describe("File path to read"),
    }),
    (args) => readFile(args)
  ),
  defineTool(
    "write_file",
    "Write content to a file (creates directories)",
    z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("Complete file content"),
    }),
    (args) => writeFile(args)
  ),
  defineTool(
    "edit_file",
    "Replace text in a file (first occurrence)",
    z.object({
      path: z.string().describe("File path"),
      old_text: z.string().describe("Text to find"),
      new_text: z.string().describe("Replacement text"),
    }),
    (args) => editFile(args)
  ),
  defineTool(
    "run_command",
    "Execute a shell command (30s timeout)",
    z.object({
      command: z.string().describe("Shell command to execute"),
    }),
    (args) => runCommand(args)
  ),
  defineTool(
    "list_files",
    "List directory structure (recursive, 3 levels)",
    z.object({
      path: z.string().optional().describe("Directory path"),
    }),
    (args) => listFiles(args)
  ),
  defineTool(
    "search_code",
    "Search for a pattern across files",
    z.object({
      pattern: z.string().describe("Search pattern"),
      path: z.string().optional().describe("Search directory"),
    }),
    (args) => searchCode(args)
  ),
  defineTool(
    "ast_inspect_file",
    "Inspect structure of a TypeScript/JavaScript file: classes, methods, functions, interfaces, types, exports without reading raw lines",
    z.object({
      path: z.string().describe("Path to TypeScript/JavaScript file to inspect"),
    }),
    (args) => astInspectFile(args)
  ),
  defineTool(
    "ast_find_symbol",
    "Find where a class, function, interface, or variable is declared across the codebase using AST analysis",
    z.object({
      symbol: z.string().describe("Name of the symbol to search for"),
      path: z.string().optional().describe("Search directory"),
    }),
    (args) => astFindSymbol(args)
  ),
  // ─── Git tools ───────────────────────────────────────────────
  defineTool(
    "git_status",
    "Show git working tree status and current branch",
    z.object({}),
    () => gitStatus()
  ),
  defineTool(
    "git_diff",
    "Show unstaged changes in the working tree",
    z.object({}),
    () => gitDiff()
  ),
  defineTool(
    "git_log",
    "Show recent git commits",
    z.object({
      count: z.number().optional().describe("Number of commits to show (default: 10)"),
    }),
    (args) => gitLog(args)
  ),
  defineTool(
    "git_commit",
    "Stage all changes and create a commit",
    z.object({
      message: z.string().describe("Commit message"),
    }),
    (args) => gitCommit(args)
  ),
  defineTool(
    "git_branch",
    "List branches or create a new branch",
    z.object({
      name: z.string().optional().describe("Branch name to create (omit to list)"),
    }),
    (args) => gitBranch(args)
  ),
  defineTool(
    "git_checkout",
    "Switch to a different branch",
    z.object({
      branch: z.string().describe("Branch name to switch to"),
    }),
    (args) => gitCheckout(args)
  ),
  defineTool(
    "git_init",
    "Initialize a new git repository in the current directory",
    z.object({}),
    () => gitInit()
  ),
  defineTool(
    "git_stash",
    "Stash working tree changes",
    z.object({}),
    () => gitStash()
  ),
  defineTool(
    "git_stash_pop",
    "Apply the most recent stash and remove it from the stash list",
    z.object({}),
    () => gitStashPop()
  ),
  defineTool(
    "git_push",
    "Push committed changes to the remote repository",
    z.object({
      remote: z.string().optional().describe("Remote name (default: origin)"),
      branch: z.string().optional().describe("Branch to push (default: current branch)"),
      force: z.boolean().optional().describe("Force push with lease (safer than --force)"),
    }),
    (args) => gitPush(args)
  ),
  defineTool(
    "git_create_pr",
    "Open a pull request on GitHub or view existing PR for current branch",
    z.object({
      title: z.string().optional().describe("Pull request title (defaults to latest commit message)"),
      body: z.string().optional().describe("Pull request description in markdown"),
      repo: z.string().optional().describe("Target repository (e.g. owner/repo, defaults to upstream or origin)"),
      base: z.string().optional().describe("Base branch to merge into (default: main)"),
      head: z.string().optional().describe("Head branch containing changes (default: current branch or fork:branch)"),
      draft: z.boolean().optional().describe("Create as draft pull request"),
    }),
    (args) => gitCreatePr(args)
  ),
  defineTool(
    "git_pr_view",
    "View pull request details and status on GitHub",
    z.object({
      pr: z.string().optional().describe("Pull request number, branch, or URL (defaults to current branch)"),
      repo: z.string().optional().describe("Repository (defaults to upstream or origin)"),
    }),
    (args) => gitPrView(args)
  ),
  defineTool(
    "glob",
    "List files matching a glob pattern (e.g. src/**/*.ts), respecting .gitignore",
    z.object({
      pattern: z.string().describe("Glob pattern"),
      path: z.string().optional().describe("Directory to search from (default: project root)"),
    }),
    (args) => glob(args)
  ),
  defineTool(
    "find_files",
    "Fuzzy-find files by name",
    z.object({
      query: z.string().describe("Part of the file name"),
      path: z.string().optional().describe("Directory to search from"),
      max_results: z.number().optional().describe("Maximum results (default 20)"),
    }),
    (args) => findFiles(args)
  ),
  defineTool(
    "fetch_url",
    "Fetch a web page or API URL and return it as text (public hosts only)",
    z.object({
      url: z.string().describe("http(s) URL"),
      maxLength: z.number().optional().describe("Maximum characters to return"),
    }),
    (args) => fetchUrl(args)
  ),
  defineTool(
    "revert_file",
    "Restore a file to its state before XYRO's last edit",
    z.object({ path: z.string().describe("File to restore") }),
    (args) => revertFile(args)
  ),
  defineTool(
    "propose_write_file",
    "Write a whole file after the user approves; the diff is shown and returned. Prefer edit_file / multi_edit for small changes.",
    z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("Complete new file content"),
      reason: z.string().optional().describe("Why this change is needed"),
    }),
    (args) => proposeWriteFile(args)
  ),
  defineTool(
    "end_turn",
    "Finish your turn when the task is done or you need the user — stops further tool rounds.",
    z.object({
      summary: z.string().optional().describe("One-line summary of what was done"),
      reason: z.string().optional().describe("Why you are stopping"),
    }),
    (args) => endTurn(args)
  ),
  defineTool(
    "task_completed",
    "Alias of end_turn: the task is complete.",
    z.object({ summary: z.string().optional(), reason: z.string().optional() }),
    (args) => endTurn(args)
  ),
  defineTool(
    "repo_map",
    "Ranked map of the codebase's key definitions (functions, classes, types) across languages, most-referenced files first, within a token budget. Use it to orient before reading files.",
    z.object({
      path: z.string().optional().describe("Sub-directory to map (default: project root)"),
      focus: z.string().optional().describe("Words to prioritise, e.g. 'auth token refresh'"),
      budget_tokens: z.number().optional().describe("Size budget (default 1500, max 8000)"),
    }),
    (args) => repoMap(args)
  ),
  defineTool(
    "multi_edit",
    "Apply several exact-text edits across one or more files in one step. All edits are validated first; if any fails nothing is written. Each old_text must match exactly once unless replace_all is true.",
    z.object({
      edits: z
        .array(
          z.object({
            path: z.string(),
            old_text: z.string().describe("Exact text to replace (include enough context to be unique)"),
            new_text: z.string(),
            replace_all: z.boolean().optional(),
          })
        )
        .describe("Edits, applied in order"),
    }),
    (args) => multiEdit(args)
  ),
  defineTool(
    "run_tests",
    "Run the project's tests (auto-detects npm/vitest/jest/node, pytest, go, cargo) and return structured results: pass/fail counts and failing tests.",
    z.object({
      command: z.string().optional().describe("Override the detected test command"),
      filter: z.string().optional().describe("Only run tests matching this name/pattern"),
    }),
    (args) => runTests(args)
  ),
  defineTool(
    "diagnostics",
    "Typecheck and lint problems as a structured list (uses the project's own tsc / eslint).",
    z.object({ path: z.string().optional().describe("Only report problems in this file or folder") }),
    (args) => diagnostics(args)
  ),
  defineTool(
    "delegate",
    "Hand one task to a specialist expert (scout, architect, builder, debugger, tester, reviewer, security, docs, researcher, git, designer, or a custom one). Omit `expert` to let XYRO route it automatically. The expert works in its own context with its own tools and skills and returns a report.",
    z.object({
      task: z.string().describe("Self-contained task: what to do and what to report back"),
      expert: z.string().optional().describe("Expert name; omit for automatic routing"),
      context: z.string().optional().describe("Facts the expert needs (files, decisions, constraints)"),
      skills: z.array(z.string()).optional().describe("Extra skills the expert should load"),
      verify: z.boolean().optional().describe("Independently verify work that changes code (default true)"),
      escalate: z.boolean().optional().describe("Escalate to the next specialist on failure (default true)"),
    }),
    (args) => delegate(args)
  ),
  defineTool(
    "web_search",
    "Search the web and get a list of pages (title, link, snippet). Then use fetch_url to read the best result.",
    z.object({
      query: z.string().describe("What to search for"),
      max_results: z.number().optional().describe("How many results (default 6, max 12)"),
    }),
    (args) => webSearch(args)
  ),
  defineTool(
    "bg_start",
    "Start a long-running command in the background (dev server, watcher, long build) and keep working; returns a job id and the first output.",
    z.object({
      command: z.string().describe("Shell command"),
      name: z.string().optional().describe("Short label for the job"),
    }),
    (args) => bgStart(args)
  ),
  defineTool(
    "bg_output",
    "Read the latest output of a background job.",
    z.object({ id: z.number(), tail_lines: z.number().optional().describe("Lines from the end (default 50)") }),
    (args) => bgOutput(args)
  ),
  defineTool("bg_stop", "Stop a background job.", z.object({ id: z.number() }), (args) => bgStop(args)),
  defineTool("bg_list", "List background jobs and their status.", z.object({}), () => bgList()),
  defineTool(
    "team_note",
    "Post a short note to the shared team board so other experts on this request see it (a decision, a changed interface, where things live, a warning).",
    z.object({
      note: z.string().describe("The note — one or two sentences"),
      author: z.string().optional().describe("Set automatically"),
    }),
    async (args) => {
      const n = postNote(args.author ?? "XYRO", args.note);
      return `Posted note #${n.id} to the team board.`;
    }
  ),
  defineTool(
    "team_notes",
    "Read the shared team board: notes other experts left while working on this request.",
    z.object({}),
    async () => formatNotes()
  ),
  defineTool(
    "skill_search",
    "Search every installed skill (project, XYRO, ~/.claude/skills, Claude Code plugins) by topic. Returns names to pass to delegate's `skills`, with paths you can read_file.",
    z.object({ query: z.string().describe("Topic, e.g. 'react testing' or 'pdf'") }),
    async (args) => {
      const found = searchSkills(args.query);
      if (!found.length) return `No skills match "${args.query}".`;
      return found.map((s) => `- ${s.name} (${s.source}): ${s.description.slice(0, 200)}\n  ${s.path}`).join("\n");
    }
  ),
  defineTool(
    "tournament",
    "Hard task with an objective check? Have 2-4 free models from different providers solve it in parallel, each in its own git worktree; every result is judged locally (check command or tests, saved intents, type checker) and only a winner that passes is merged. Use when correctness matters and a first attempt may fail.",
    z.object({
      task: z.string().describe("The task, fully specified"),
      check: z.string().optional().describe("Command that exits 0 when the task is done (default: the project's tests)"),
      contestants: z.number().optional().describe("2-4 models (default 3)"),
      expert: z.string().optional().describe("Expert persona for the contestants (default: routed)"),
    }),
    (args) => tournament(args)
  ),
  defineTool(
    "intent_save",
    "Save a lasting user requirement as an executable check that re-runs after every change (the intent guard). Give either a precise test `command` (passes on exit 0), or `file` + regex `pattern` (set absent: true for things that must never appear).",
    z.object({
      said: z.string().describe("The requirement, in the user's words"),
      command: z.string().optional().describe("Shell check that exits 0 while the requirement holds"),
      file: z.string().optional().describe("Project file for a pattern check"),
      pattern: z.string().optional().describe("Regex that must match (or must not, with absent)"),
      absent: z.boolean().optional().describe("Pattern must NOT appear"),
    }),
    async (args) => saveIntent(args)
  ),
  defineTool(
    "intent_check",
    "Run every saved intent check now and report which user requirements still hold.",
    z.object({}),
    async () => formatIntentResults(await runIntents())
  ),
  defineTool(
    "intent_remove",
    "Delete a saved intent, only when the user explicitly dropped that requirement.",
    z.object({ id: z.string().describe("Intent id, e.g. i3") }),
    async (args) => removeIntent(args.id)
  ),
  defineTool(
    "run_workflow",
    "Run a saved team workflow (feature, bugfix, review, release-check, refactor, onboard, or a custom one) toward a goal. Stages run in order, steps within a stage in parallel. Use name 'list' to see workflows.",
    z.object({
      name: z.string().describe("Workflow name, or 'list'"),
      goal: z.string().optional().describe("What the workflow should achieve"),
    }),
    (args) => runWorkflow(args)
  ),
  defineTool(
    "heal",
    "Run the tests and, while they fail, have the healer expert fix the root cause and re-run (up to max_rounds). Use after changes break tests.",
    z.object({
      command: z.string().optional().describe("Test command (default: auto-detected)"),
      max_rounds: z.number().optional().describe("Fix-and-retest rounds (default 3, max 5)"),
    }),
    (args) => heal(args)
  ),
  defineTool(
    "delegate_team",
    "Run several independent tasks in parallel, each with its own expert (auto-routed when `expert` is omitted). Use for work that splits cleanly, e.g. review + tests + docs.",
    z.object({
      tasks: z
        .array(
          z.object({
            task: z.string(),
            expert: z.string().optional(),
            context: z.string().optional(),
            skills: z.array(z.string()).optional(),
          })
        )
        .describe("Independent tasks"),
      isolate: z.boolean().optional().describe("Give parallel writers separate git worktrees (default true when 2+ can write)"),
    }),
    (args) => delegateTeam(args)
  ),
  defineTool(
    "spawn_agent",
    "Legacy alias of delegate (types: file_finder, code_reviewer, task_planner, summarizer, generic)",
    z.object({
      type: z.enum(["file_finder", "code_reviewer", "task_planner", "summarizer", "generic"]).optional(),
      prompt: z.string(),
      context_files: z.array(z.string()).optional(),
    }),
    (args) => spawnAgent(args)
  ),
  defineTool(
    "spawn_agents",
    "Legacy alias of delegate_team",
    z.object({
      agents: z.array(
        z.object({
          type: z.enum(["file_finder", "code_reviewer", "task_planner", "summarizer", "generic"]).optional(),
          prompt: z.string(),
          context_files: z.array(z.string()).optional(),
        })
      ),
    }),
    (args) => spawnAgents(args)
  ),
  defineTool(
    "write_todos",
    "Publish the task list shown live to the user. Pass `items` with the FULL list every time (each item's text and status: pending | in_progress | done); keep exactly one item in_progress.",
    z.object({
      items: z
        .array(z.object({ text: z.string(), status: z.enum(["pending", "in_progress", "done"]) }))
        .optional()
        .describe("The complete task list, in order"),
      clear: z.boolean().optional().describe("Clear the list"),
    }),
    (args) => writeTodos(args)
  ),
  defineTool(
    "propose_plan",
    "Show the user a step-by-step plan and wait for approval before doing large or risky work. Returns whether the user approved or rejected it.",
    z.object({
      title: z.string().optional().describe("Short plan title"),
      summary: z.string().optional().describe("One or two sentences on the approach"),
      steps: z.array(z.string()).describe("Ordered, concrete steps"),
    }),
    (args) => proposePlan(args)
  ),
  defineTool(
    "git_add",
    "Stage files for commit",
    z.object({
      files: z.array(z.string()).optional().describe("Files to stage (omit to stage all)"),
    }),
    (args) => gitAdd(args)
  ),
  defineTool("git_diff_staged", "Show changes staged for commit", z.object({}), () => gitDiffStaged()),
  defineTool("git_diff_unstaged", "Show unstaged changes", z.object({}), () => gitDiffUnstaged()),
  defineTool("git_reset", "Unstage all staged changes (git reset)", z.object({}), () => gitReset()),
  defineTool(
    "git_show",
    "Show the contents of a commit",
    z.object({
      revision: z.string().describe("Commit SHA, branch, or tag"),
    }),
    (args) => gitShow(args)
  ),
  defineTool(
    "git_create_branch",
    "Create and switch to a new branch",
    z.object({
      branch: z.string().describe("Branch name"),
      base: z.string().optional().describe("Base branch to create from (default: current)"),
    }),
    (args) => gitCreateBranch(args)
  ),
  defineTool(
    "git_pull",
    "Pull changes from remote",
    z.object({
      remote: z.string().optional().describe("Remote name (default: origin)"),
      branch: z.string().optional().describe("Branch name (default: current)"),
    }),
    (args) => gitPull(args)
  ),
  defineTool(
    "git_fetch",
    "Fetch changes from remote",
    z.object({
      remote: z.string().optional().describe("Remote name (default: origin)"),
      prune: z.boolean().optional().describe("Prune remote-tracking branches"),
    }),
    (args) => gitFetch(args)
  ),
  defineTool("git_remote", "List remotes", z.object({}), () => gitRemote()),
  defineTool(
    "git_rebase",
    "Rebase onto another branch",
    z.object({
      branch: z.string().describe("Branch to rebase onto"),
    }),
    (args) => gitRebase(args)
  ),
  defineTool(
    "git_pr_list",
    "List pull requests on GitHub",
    z.object({
      repo: z.string().optional().describe("Repository (owner/repo)"),
      state: z.string().optional().describe("State: open, closed, merged, all (default: open)"),
    }),
    (args) => gitPrList(args)
  ),
  defineTool(
    "git_pr_status",
    "Show GitHub PR status for current branch/context",
    z.object({
      repo: z.string().optional().describe("Repository (owner/repo)"),
    }),
    (args) => gitPrStatus(args)
  ),
];


// All tools (built-in + plugins)
let allTools: Tool[] = [...builtinTools];
let pluginsLoaded = false;

/** Initialize plugin tools (call once at startup) */
export async function initializeTools(): Promise<void> {
  if (pluginsLoaded) return;
  try {
    const pluginTools = await loadPlugins();
    if (pluginTools.length > 0) {
      allTools = [...builtinTools, ...pluginTools];
    }
  } catch {
    // Plugin loading failed — use built-in tools only
  }
  pluginsLoaded = true;
}

/** Tools added at runtime (MCP servers). `mainVisible: false` = experts only. */
const externalTools = new Map<string, { tool: Tool; mainVisible: boolean }>();

export function registerExternalTools(tools: Tool[], opts: { mainVisible: boolean }): void {
  for (const tool of tools) externalTools.set(tool.definition.function.name, { tool, mainVisible: opts.mainVisible });
}

/** Remove runtime tools whose names start with `prefix` (e.g. "mcp__github__"). */
export function unregisterExternalTools(prefix: string): void {
  for (const name of [...externalTools.keys()]) if (name.startsWith(prefix)) externalTools.delete(name);
}

function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.definition.function.name === name) ?? externalTools.get(name)?.tool;
}

/** Tools the main agent sees: built-ins, plugins, and MCP servers not marked experts-only. */
export function getToolDefinitions(): OpenAI.ChatCompletionTool[] {
  const ext = [...externalTools.values()].filter((e) => e.mainVisible).map((e) => e.tool.definition);
  return [...allTools.map((t) => t.definition), ...ext];
}

/** Read-only tools: what XYRO may use in plan mode (no writes, no commands, no network). */
const PLAN_MODE_TOOLS = new Set([
  "read_file", "list_files", "glob", "search_code", "find_files", "repo_map", "ast_inspect_file", "ast_find_symbol",
  "write_todos", "propose_plan", "end_turn", "task_completed", "team_notes", "intent_check", "skill_search",
  "git_status", "git_diff", "git_log", "git_branch", "git_show", "git_diff_staged", "git_diff_unstaged", "git_pr_view",
]);

export function getPlanModeToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return allTools.filter((t) => PLAN_MODE_TOOLS.has(t.definition.function.name)).map((t) => t.definition);
}

/** Every tool, including experts-only MCP tools (experts filter this by their own list). */
export function getAllToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return [...allTools.map((t) => t.definition), ...[...externalTools.values()].map((e) => e.tool.definition)];
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = findTool(name);
  if (!tool) return `❌ Unknown tool: ${name}`;

  // Reflexes first: a PreToolUse hook may veto the call
  const pre = await runHooks("PreToolUse", { tool: name, args });
  if (pre.blocked) return `⛔ Blocked by a hook: ${pre.reason}`;

  // Checkpoint: remember files as they were before this turn changed them
  for (const p of pathsTouchedBy(name, args)) recordBeforeChange(p);

  let result: string;
  try {
    result = await tool.execute(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result = `❌ ${name} error: ${msg}`;
  }

  const post = await runHooks("PostToolUse", { tool: name, args, result });
  if (post.output) result += `\n\n[hook output]\n${post.output}`;
  return result;
}

/** Get count of loaded tools (for status display) */
export function getToolCount(): { builtin: number; plugins: number; total: number } {
  return {
    builtin: builtinTools.length,
    plugins: allTools.length - builtinTools.length,
    total: allTools.length,
  };
}
