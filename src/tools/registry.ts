import { isOutsideProject, approveOutsideRead } from "./safety.js";
import { getToolApprover } from "../agent/ui-bridge.js";
import { canPromptUser, requestPermission } from "./permissions.js";
import { workspaceRoot } from "../agent/workspace.js";
import { resolve as resolvePath, dirname } from "node:path";
import { council } from "../agents/council.js";
import { forgeSkill } from "../agents/skill-forge.js";
import { trackRecord } from "../agents/skill-stats.js";
import { searchSkills, findSkill, loadSkillBody } from "../agents/skills-catalog.js";
import { installSkill, findSkillsOnline } from "../agents/skill-market.js";
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

/**
 * Models often send `null` for an option they don't use, or a number as "2000":
 * read those the way they were meant instead of failing the call.
 */
export function lenientArgs(schema: z.ZodTypeAny, args: Record<string, unknown>): Record<string, unknown> {
  const shape = schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodTypeAny>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === null) continue;
    let field = shape[k];
    while (field instanceof z.ZodOptional || field instanceof z.ZodDefault || field instanceof z.ZodNullable) field = field._def.innerType;
    if (field instanceof z.ZodNumber && typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) out[k] = Number(v);
    else if (field instanceof z.ZodBoolean && (v === "true" || v === "false")) out[k] = v === "true";
    else out[k] = v;
  }
  return out;
}

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
      const parsed = schema.safeParse(lenientArgs(schema, rawArgs || {}));
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
    "load_tools",
    "Load extra tool groups for the rest of the session: git, team, files, background, intents, skills.",
    z.object({ groups: z.array(z.string()).describe("Group names, e.g. [\"git\"]") }),
    async (args) => loadToolGroups(args.groups ?? [])
  ),
  defineTool(
    "skill_search",
    "Search every installed skill (project, XYRO, ~/.claude/skills, Claude Code plugins) by topic. Returns names to pass to delegate's `skills`, with paths you can read_file.",
    z.object({ query: z.string().describe("Topic, e.g. 'react testing' or 'pdf'") }),
    async (args) => {
      const found = searchSkills(args.query);
      if (!found.length) return `No skills match "${args.query}".`;
      return found.map((s) => `- ${s.name} (${[s.source, trackRecord(s.name)].filter(Boolean).join(", ")}): ${s.description.slice(0, 200)}\n  ${s.path}`).join("\n");
    }
  ),
  defineTool(
    "skill_load",
    "Load the full text of an installed skill by name (from skill_search or the skills index) and follow it for the current task.",
    z.object({ name: z.string().describe("Skill name") }),
    async (args) => {
      const s = findSkill(args.name);
      const body = s ? loadSkillBody(s.name) : null;
      if (!s || !body) return `❌ No installed skill named "${args.name}". Try skill_search.`;
      const record = trackRecord(s.name);
      return `# Skill: ${s.name} (${s.source}${record ? `, ${record}` : ""})\n${s.description}\n\n${body}`;
    }
  ),
  defineTool(
    "skill_find_online",
    "Search the web (GitHub) for agent skills on a topic when no installed skill fits. Install a result with skill_install.",
    z.object({ query: z.string().describe("Topic, e.g. 'pdf forms' or 'react native testing'") }),
    (args) => findSkillsOnline(args)
  ),
  defineTool(
    "skill_install",
    "Install a skill from GitHub (a folder with SKILL.md): URL or owner/repo/path. Default scope: all your projects; scope 'project' keeps it in .xyro/skills.",
    z.object({
      source: z.string().describe("GitHub URL or owner/repo/path of the skill folder"),
      scope: z.enum(["user", "project"]).optional(),
      replace: z.boolean().optional().describe("Overwrite an installed skill with the same name"),
    }),
    (args) => installSkill(args)
  ),
  defineTool(
    "council",
    "Convene a council of 2-5 experts for a decision that is expensive to get wrong (architecture, risky refactor, security-sensitive change): each investigates and proposes, they discuss each other's proposals and vote, the winner writes the final decision with assignments. With execute: true the team then carries it out.",
    z.object({
      goal: z.string().describe("What the team must decide or achieve"),
      experts: z.array(z.string()).optional().describe("Members (default: the best-suited experts)"),
      execute: z.boolean().optional().describe("Carry out the decided assignments afterwards"),
    }),
    (args) => council(args)
  ),
  defineTool(
    "assign_workers",
    "(Experts only) As the lead, hand 1-3 sub-tasks to workers who run in parallel, obey your rules, use only your tools (or fewer) and report back to you.",
    z.object({
      tasks: z.array(z.object({ task: z.string(), rules: z.string().optional(), tools: z.array(z.string()).optional() })).describe("Sub-tasks for workers"),
      rules: z.string().optional().describe("Rules every worker must follow"),
    }),
    async () => "❌ assign_workers is for experts leading a team. As the coordinator, use delegate or delegate_team."
  ),
  defineTool(
    "skill_forge",
    "After a non-obvious task was solved AND verified, save the reusable procedure as a project skill (.xyro/skills/<name>/SKILL.md) for every expert. XYRO runs `check` first and saves only if it passes now; the evidence is recorded in the skill.",
    z.object({
      name: z.string().describe("kebab-case name, e.g. add-api-endpoint"),
      description: z.string().describe("When to use this skill (one sentence)"),
      body: z.string().describe("Markdown: when to use, steps, pitfalls, a short example"),
      check: z.string().describe("Command that proves the procedure works in this project (exits 0)"),
    }),
    (args) => forgeSkill(args)
  ),
  defineTool(
    "tournament",
    "Hard task with an objective check? Have 2-4 free models from different providers solve it in parallel, each in its own git worktree; every result is judged locally (check command or tests, saved intents, type checker) and only a winner that passes is merged. Use when correctness matters and a first attempt may fail. Note: judging runs the contestants' code (the tests) on this machine without per-edit review; attempts that touch build/test configuration are never run.",
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
    "Publish the plan / task list shown live to the user. Pass `items` with the FULL list every time (each item's text and status: pending | in_progress | done, and the expert who owns it); keep exactly one item in_progress.",
    z.object({
      items: z
        .array(z.object({ text: z.string(), status: z.enum(["pending", "in_progress", "done"]), expert: z.string().optional().describe("Expert who owns this step, e.g. builder, tester, docs") }))
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

/** /plugins reload: pick up added, changed or removed plugins without restarting XYRO. */
export async function reloadPlugins(): Promise<number> {
  const pluginTools = await loadPlugins({ fresh: true });
  allTools = [...builtinTools, ...pluginTools];
  pluginsLoaded = true;
  return pluginTools.length;
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
/** Tools only experts use: never sent to the coordinator (it can't call them). */
const EXPERT_ONLY = new Set(["assign_workers"]);

const TOOL_DESC_MAX = 180;
const PARAM_DESC_MAX = 70;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  // Keep whole sentences when possible
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.trimEnd() + "…";
}

function compactSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(compactSchema);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "description" && typeof v === "string") out[k] = clip(v, PARAM_DESC_MAX);
    else if (k === "$schema" || k === "additionalProperties") continue; // noise for the model
    else out[k] = compactSchema(v);
  }
  return out;
}

/**
 * The same tools, written compactly: tool definitions travel with EVERY
 * request, and on free tiers every token and every request counts.
 */
export function compactTool(t: OpenAI.ChatCompletionTool): OpenAI.ChatCompletionTool {
  return {
    ...t,
    function: {
      ...t.function,
      description: clip(t.function.description ?? "", TOOL_DESC_MAX),
      parameters: compactSchema(t.function.parameters) as OpenAI.FunctionParameters,
    },
  };
}

/**
 * Tools on demand. Every tool definition travels with every request, so the
 * coordinator gets an everyday core and loads a group (load_tools) only when
 * the work needs it. Loaded groups stay for the rest of the session.
 */
export const CORE_TOOLS = new Set([
  "read_file", "list_files", "glob", "search_code", "repo_map",
  "edit_file", "multi_edit", "write_file", "run_command", "run_tests", "diagnostics",
  "write_todos", "delegate", "delegate_team", "end_turn",
  "git_status", "git_diff", "git_commit", "web_search", "fetch_url", "skill_load", "load_tools",
]);

export const TOOL_GROUPS: Record<string, { about: string; tools: string[] }> = {
  git: { about: "branches, log, push, pull requests, stash, rebase", tools: ["git_log", "git_branch", "git_checkout", "git_init", "git_stash", "git_stash_pop", "git_push", "git_create_pr", "git_pr_view", "git_add", "git_diff_staged", "git_diff_unstaged", "git_reset", "git_show", "git_create_branch", "git_pull", "git_fetch", "git_remote", "git_rebase", "git_pr_list", "git_pr_status"] },
  team: { about: "council, workflows, tournament, plans to approve, healing tests, team board", tools: ["council", "run_workflow", "tournament", "propose_plan", "heal", "team_note", "team_notes", "spawn_agent", "spawn_agents"] },
  files: { about: "symbols (AST), ranked file search, review-then-write, undo", tools: ["ast_inspect_file", "ast_find_symbol", "find_files", "propose_write_file", "revert_file"] },
  background: { about: "dev servers and watchers", tools: ["bg_start", "bg_output", "bg_stop", "bg_list"] },
  intents: { about: "saved requirements that are re-checked after changes", tools: ["intent_save", "intent_check", "intent_remove"] },
  skills: { about: "find, install and create skills", tools: ["skill_search", "skill_find_online", "skill_install", "skill_forge"] },
};

const loadedGroups = new Set<string>();

export function loadToolGroups(groups: string[]): string {
  const known = groups.map((g) => g.trim().toLowerCase()).filter((g) => TOOL_GROUPS[g]);
  if (!known.length) return `❌ Unknown group. Available: ${Object.keys(TOOL_GROUPS).join(", ")}`;
  for (const g of known) loadedGroups.add(g);
  return `Loaded ${known.map((g) => `${g} (${TOOL_GROUPS[g].tools.join(", ")})`).join("; ")}. They are available from your next step.`;
}

/** One line for the system prompt: what can be loaded. */
export function toolGroupsPrompt(): string {
  const rest = Object.entries(TOOL_GROUPS).filter(([g]) => !loadedGroups.has(g));
  if (!rest.length) return "";
  return `## More tools on demand\nCall load_tools with a group when you need it: ${rest.map(([g, v]) => `${g} (${v.about})`).join("; ")}.`;
}

export function _resetToolGroups(): void {
  loadedGroups.clear();
}

export function getToolDefinitions(): OpenAI.ChatCompletionTool[] {
  const grouped = new Set(Object.values(TOOL_GROUPS).flatMap((g) => g.tools));
  const active = new Set([...CORE_TOOLS, ...[...loadedGroups].flatMap((g) => TOOL_GROUPS[g].tools)]);
  const ext = [...externalTools.values()].filter((e) => e.mainVisible).map((e) => e.tool.definition);
  const builtin = allTools
    .map((t) => t.definition)
    .filter((d) => !EXPERT_ONLY.has(d.function.name))
    // Core and loaded groups; anything not sorted into a group stays visible (never hide a tool by accident)
    .filter((d) => active.has(d.function.name) || !grouped.has(d.function.name));
  return [...builtin, ...ext].map(compactTool);
}

/** Read-only tools: what XYRO may use in plan mode (no writes, no commands, no network). */
const PLAN_MODE_TOOLS = new Set([
  "read_file", "list_files", "glob", "search_code", "find_files", "repo_map", "ast_inspect_file", "ast_find_symbol",
  "write_todos", "propose_plan", "end_turn", "task_completed", "team_notes", "intent_check", "skill_search", "skill_load",
  "git_status", "git_diff", "git_log", "git_branch", "git_show", "git_diff_staged", "git_diff_unstaged", "git_pr_view",
]);

export function getPlanModeToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return allTools.filter((t) => PLAN_MODE_TOOLS.has(t.definition.function.name)).map((t) => t.definition);
}

/** Every tool, including experts-only MCP tools (experts filter this by their own list). */
export function getAllToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return [...allTools.map((t) => t.definition), ...[...externalTools.values()].map((e) => e.tool.definition)].map(compactTool);
}

/** Tools that look through many files: never outside the project. */
const SEARCH_TOOLS = new Set(["list_files", "glob", "search_code", "find_files", "repo_map", "ast_find_symbol"]);
/** Tools that read one named file: outside the project they ask first. */
const READ_PATH_TOOLS = new Set(["read_file", "ast_inspect_file"]);

async function askOutsideRead(folder: string): Promise<boolean> {
  const label = `Read outside the project: ${folder}`;
  const ui = getToolApprover();
  if (ui) return ui(label);
  if (process.env.XYRO_ALLOW_OUTSIDE === "1") return true;
  if (!canPromptUser()) return false; // scripts / CI: never wander off
  return (await requestPermission("read_outside_project", { path: folder })) === "allow";
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = findTool(name);
  if (!tool) return `❌ Unknown tool: ${name}`;

  // Reflexes first: a PreToolUse hook may veto the call
  const pre = await runHooks("PreToolUse", { tool: name, args });
  if (pre.blocked) return `⛔ Blocked by a hook: ${pre.reason}`;

  // Stay in the project. Searching or listing elsewhere is never done; reading one
  // file elsewhere needs the user's OK (only when they asked for that file)
  if (SEARCH_TOOLS.has(name) && typeof args.path === "string" && args.path.trim() && isOutsideProject(args.path)) {
    return `⛔ Not searched: ${args.path} is outside the project (${workspaceRoot()}). XYRO only searches inside the project it runs in.`;
  }
  if (READ_PATH_TOOLS.has(name) && typeof args.path === "string" && args.path.trim() && isOutsideProject(args.path)) {
    const target = resolvePath(workspaceRoot(), args.path);
    const folder = name === "read_file" || name === "ast_inspect_file" ? dirname(target) : target;
    if (!(await askOutsideRead(folder))) {
      return `⛔ Not read: ${args.path} is outside the project (${workspaceRoot()}) and the user did not allow it. Stay inside the project unless the user asks otherwise.`;
    }
    approveOutsideRead(folder);
  }

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
