import OpenAI from "openai";
import { Tool } from "../agent/types.js";
import { readFile } from "./read.js";
import { writeFile, editFile } from "./write.js";
import { runCommand } from "./shell.js";
import { listFiles } from "./fs.js";
import { searchCode } from "./search.js";
import { fetchUrl } from "./fetch.js";
import { writeTodos } from "./todos.js";
import { glob } from "./glob.js";
import { proposeWriteFile } from "./propose.js";
import { spawnAgent } from "./subagent.js";
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
} from "./git.js";
import { loadPlugins } from "../config/plugins.js";

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: properties as Record<string, unknown>,
        required,
      },
    },
  };
}

// Built-in tools
const builtinTools: Tool[] = [
  {
    definition: def(
      "read_file",
      "Read file contents with line numbers (supports windowed/paginated reads)",
      {
        path: { type: "string", description: "File path to read" },
        start_line: { type: "number", description: "First line to read (1-indexed, optional)" },
        end_line: { type: "number", description: "Last line to read (1-indexed, optional)" },
      },
      ["path"]
    ),
    execute: (args) =>
      readFile(args as { path: string; start_line?: number; end_line?: number }),
  },
  {
    definition: def(
      "propose_write_file",
      "Propose changes to a file with diff preview and interactive user approval before saving",
      {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "Proposed complete file content" },
        reason: { type: "string", description: "Reason or description of the changes" },
      },
      ["path", "content"]
    ),
    execute: (args) =>
      proposeWriteFile(args as { path: string; content: string; reason?: string }),
  },
  {
    definition: def(
      "glob",
      "Find files matching a glob pattern across the project tree (e.g. **/*.ts, src/**/*.json)",
      {
        pattern: { type: "string", description: "Glob pattern to match" },
        path: { type: "string", description: "Directory root to search from (defaults to cwd)" },
      },
      ["pattern"]
    ),
    execute: (args) => glob(args as { pattern: string; path?: string }),
  },
  {
    definition: def(
      "write_todos",
      "Track and update in-session task checklist to organize multi-step work and avoid losing context",
      {
        todos: {
          type: "array",
          items: { type: "string" },
          description: "New todo tasks to add to the checklist",
        },
        mark_done: {
          type: "array",
          items: { type: "number" },
          description: "IDs of todo items to mark as completed",
        },
        clear: {
          type: "boolean",
          description: "Clear all existing todos",
        },
      },
      []
    ),
    execute: (args) =>
      writeTodos(args as { todos?: string[]; mark_done?: number[]; clear?: boolean }),
  },
  {
    definition: def(
      "spawn_agent",
      "Spawn a focused sub-agent with isolated context to solve a dedicated sub-task",
      {
        prompt: { type: "string", description: "Sub-task instructions and goal for the agent" },
        type: {
          type: "string",
          enum: ["file_finder", "code_reviewer", "task_planner", "summarizer", "generic"],
          description: "Specialized sub-agent role (defaults to generic)",
        },
        context_files: {
          type: "array",
          items: { type: "string" },
          description: "List of file paths to highlight for the sub-agent",
        },
      },
      ["prompt"]
    ),
    execute: (args) =>
      spawnAgent(args as { prompt: string; type?: any; context_files?: string[] }),
  },
  {
    definition: def("write_file", "Write content to a file (creates directories)", {
      path: { type: "string", description: "File path" },
      content: { type: "string", description: "Complete file content" },
    }, ["path", "content"]),
    execute: (args) => writeFile(args as { path: string; content: string }),
  },
  {
    definition: def("edit_file", "Replace text in a file (first occurrence)", {
      path: { type: "string", description: "File path" },
      old_text: { type: "string", description: "Text to find" },
      new_text: { type: "string", description: "Replacement text" },
    }, ["path", "old_text", "new_text"]),
    execute: (args) => editFile(args as { path: string; old_text: string; new_text: string }),
  },
  {
    definition: def("run_command", "Execute a shell command (30s timeout)", {
      command: { type: "string", description: "Shell command to execute" },
    }, ["command"]),
    execute: (args) => runCommand(args as { command: string }),
  },
  {
    definition: def("list_files", "List directory structure (recursive, 3 levels)", {
      path: { type: "string", description: "Directory path" },
    }, []),
    execute: (args) => listFiles(args as { path?: string }),
  },
  {
    definition: def("search_code", "Search for a pattern across files", {
      pattern: { type: "string", description: "Search pattern" },
      path: { type: "string", description: "Search directory" },
    }, ["pattern"]),
    execute: (args) => searchCode(args as { pattern: string; path?: string }),
  },
  {
    definition: def("fetch_url", "Fetch and extract text content from a web URL or GitHub repository", {
      url: { type: "string", description: "The web URL to fetch (http or https)" },
    }, ["url"]),
    execute: (args) => fetchUrl(args as { url: string }),
  },
  // ─── Git tools ───────────────────────────────────────────────
  {
    definition: def("git_status", "Show git working tree status and current branch", {}, []),
    execute: () => gitStatus(),
  },
  {
    definition: def("git_diff", "Show unstaged changes in the working tree", {}, []),
    execute: () => gitDiff(),
  },
  {
    definition: def("git_log", "Show recent git commits", {
      count: { type: "number", description: "Number of commits to show (default: 10)" },
    }, []),
    execute: (args) => gitLog(args as { count?: number }),
  },
  {
    definition: def("git_commit", "Stage all changes and create a commit", {
      message: { type: "string", description: "Commit message" },
    }, ["message"]),
    execute: (args) => gitCommit(args as { message: string }),
  },
  {
    definition: def("git_branch", "List branches or create a new branch", {
      name: { type: "string", description: "Branch name to create (omit to list)" },
    }, []),
    execute: (args) => gitBranch(args as { name?: string }),
  },
  {
    definition: def("git_checkout", "Switch to a different branch", {
      branch: { type: "string", description: "Branch name to switch to" },
    }, ["branch"]),
    execute: (args) => gitCheckout(args as { branch: string }),
  },
  {
    definition: def("git_init", "Initialize a new git repository in the current directory", {}, []),
    execute: () => gitInit(),
  },
  {
    definition: def("git_stash", "Stash working tree changes", {}, []),
    execute: () => gitStash(),
  },
  {
    definition: def("git_stash_pop", "Apply the most recent stash and remove it from the stash list", {}, []),
    execute: () => gitStashPop(),
  },
  {
    definition: def("git_push", "Push committed changes to the remote repository", {
      remote: { type: "string", description: "Remote name (default: origin)" },
      branch: { type: "string", description: "Branch to push (default: current branch)" },
      force: { type: "boolean", description: "Force push with lease (safer than --force)" },
    }, []),
    execute: (args) => gitPush(args as { remote?: string; branch?: string; force?: boolean }),
  },
  {
    definition: def("git_create_pr", "Open a pull request on GitHub or view existing PR for current branch", {
      title: { type: "string", description: "Pull request title (defaults to latest commit message)" },
      body: { type: "string", description: "Pull request description in markdown" },
      repo: { type: "string", description: "Target repository (e.g. owner/repo, defaults to upstream or origin)" },
      base: { type: "string", description: "Base branch to merge into (default: main)" },
      head: { type: "string", description: "Head branch containing changes (default: current branch or fork:branch)" },
      draft: { type: "boolean", description: "Create as draft pull request" },
    }, []),
    execute: (args) => gitCreatePr(args as { title?: string; body?: string; repo?: string; base?: string; head?: string; draft?: boolean }),
  },
  {
    definition: def("git_pr_view", "View pull request details and status on GitHub", {
      pr: { type: "string", description: "Pull request number, branch, or URL (defaults to current branch)" },
      repo: { type: "string", description: "Repository (defaults to upstream or origin)" },
    }, []),
    execute: (args) => gitPrView(args as { pr?: string; repo?: string }),
  },
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
