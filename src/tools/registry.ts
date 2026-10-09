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
import { loadPlugins } from "../config/plugins.js";

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

export function getToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return allTools.map((t) => t.definition);
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = allTools.find((t) => t.definition.function.name === name);
  if (!tool) return `❌ Unknown tool: ${name}`;
  try {
    return await tool.execute(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ ${name} error: ${msg}`;
  }
}

/** Get count of loaded tools (for status display) */
export function getToolCount(): { builtin: number; plugins: number; total: number } {
  return {
    builtin: builtinTools.length,
    plugins: allTools.length - builtinTools.length,
    total: allTools.length,
  };
}
