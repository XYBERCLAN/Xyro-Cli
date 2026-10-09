// Expert roster — XYRO's "immune cells". Each expert is a specialist with its
// own persona, toolset, skills and plugins. Built-ins cover everyday work;
// projects and users add their own as Markdown files:
//
//   .xyro/agents/<name>.md            (project)
//   ~/.config/xyro/agents/<name>.md   (user, all projects)
//
//   ---
//   name: db-expert
//   description: Designs schemas and writes safe SQL migrations
//   tools: read, write, shell          # groups or exact tool names
//   skills: supabase-postgres-best-practices
//   plugins: my-db-plugin
//   mcp: postgres                      # MCP servers from mcp.json
//   triggers: sql, migration, schema, postgres
//   max_steps: 14
//   model: optional-model-id
//   ---
//   You are a database specialist… (persona / instructions)

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { parseFrontmatter } from "./skills-catalog.js";

export interface Expert {
  name: string;
  title: string;
  description: string;
  persona: string;
  tools: string[];
  skills: string[];
  plugins: string[];
  /** MCP servers whose tools this expert gets (even experts-only servers) */
  mcp: string[];
  triggers: string[];
  maxSteps: number;
  model?: string;
  source: "builtin" | "project" | "user";
}

// ── tool groups ──────────────────────────────────────────────────────────────
export const TOOL_GROUPS: Record<string, string[]> = {
  read: ["read_file", "list_files", "search_code", "glob", "find_files", "ast_inspect_file", "ast_find_symbol", "repo_map"],
  write: ["write_file", "edit_file", "multi_edit", "revert_file"],
  verify: ["run_tests", "diagnostics"],
  shell: ["run_command", "bg_start", "bg_output", "bg_stop", "bg_list"],
  git: ["git_status", "git_diff", "git_log", "git_show", "git_branch", "git_diff_staged", "git_diff_unstaged", "git_pr_view", "git_pr_list", "git_pr_status"],
  "git-write": [
    "git_add", "git_commit", "git_push", "git_create_pr", "git_checkout", "git_create_branch",
    "git_stash", "git_stash_pop", "git_reset", "git_pull", "git_fetch", "git_rebase", "git_init", "git_remote",
  ],
  web: ["web_search", "fetch_url"],
  plan: ["write_todos"],
};

/** Expand "read, write, run_command" into concrete tool names. */
export function expandTools(spec: string[]): string[] {
  const out = new Set<string>();
  for (const raw of spec) {
    const s = raw.trim();
    if (!s) continue;
    if (s === "all") Object.values(TOOL_GROUPS).flat().forEach((t) => out.add(t));
    else if (TOOL_GROUPS[s]) TOOL_GROUPS[s].forEach((t) => out.add(t));
    else out.add(s);
  }
  return [...out];
}

const ex = (e: Omit<Expert, "source" | "plugins" | "maxSteps" | "mcp"> & Partial<Pick<Expert, "plugins" | "maxSteps" | "mcp">>): Expert => ({
  plugins: [],
  mcp: [],
  maxSteps: 12,
  ...e,
  tools: expandTools(e.tools),
  source: "builtin",
});

const REPORT = `When you finish, reply with a short report: what you did, what you found, files touched, and anything the coordinator must still do. Do not ask the user questions — you report to XYRO, the coordinator.`;

export const BUILTIN_EXPERTS: Expert[] = [
  ex({
    name: "scout",
    title: "Scout",
    description: "Explores and maps the codebase: finds the files, symbols and conventions relevant to a task. Read-only.",
    persona: `You are XYRO's scout. Map the territory fast: locate the files, functions and conventions that matter for the task, and note how things connect. Never modify anything.\n${REPORT}`,
    tools: ["read"],
    skills: [],
    triggers: ["find", "where", "locate", "explore", "map", "structure", "codebase", "which file", "how does", "overview", "understand"],
    maxSteps: 10,
  }),
  ex({
    name: "architect",
    title: "Architect",
    description: "Designs the approach before code changes: options, trade-offs and a concrete step-by-step plan. Read-only.",
    persona: `You are XYRO's architect. Study the relevant code, then propose the simplest design that fits the existing architecture. Give trade-offs briefly and end with numbered, concrete steps. Never modify files.\n${REPORT}`,
    tools: ["read", "git"],
    skills: [],
    triggers: ["design", "architecture", "plan", "approach", "strategy", "structure", "spec", "migrate", "scale", "refactor plan"],
  }),
  ex({
    name: "builder",
    title: "Builder",
    description: "Implements features and changes in code, matching the project's conventions, and verifies they compile.",
    persona: `You are XYRO's builder. Read before you edit, make focused changes that match the surrounding style, and verify (typecheck / build / quick test) before reporting.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: [],
    triggers: ["implement", "add", "build", "create", "feature", "change", "update", "write code", "refactor", "rename", "support"],
    maxSteps: 16,
  }),
  ex({
    name: "debugger",
    title: "Debugger",
    description: "Diagnoses and fixes bugs: reproduces the failure, finds the root cause, applies the minimal fix and proves it.",
    persona: `You are XYRO's debugger. Reproduce first, then form a hypothesis, confirm it with evidence, and apply the smallest fix that addresses the root cause. Re-run the failing case to prove the fix.\n${REPORT}`,
    tools: ["read", "write", "shell", "git", "verify"],
    skills: [],
    triggers: ["bug", "error", "fix", "crash", "broken", "failing", "fails", "exception", "stack trace", "regression", "not working", "freeze", "hang"],
    maxSteps: 16,
  }),
  ex({
    name: "tester",
    title: "Tester",
    description: "Writes and runs tests, checks behaviour at public interfaces, and reports coverage gaps.",
    persona: `You are XYRO's tester. Test behaviour through public interfaces, not internals. Write focused tests, run them, and report what passes, what fails and what is still untested.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: ["tdd", "javascript-testing-patterns"],
    triggers: ["test", "tests", "testing", "coverage", "spec", "assert", "tdd", "unit test", "integration test", "e2e"],
    maxSteps: 14,
  }),
  ex({
    name: "reviewer",
    title: "Reviewer",
    description: "Reviews code and diffs for bugs, risks, readability and convention breaks. Read-only.",
    persona: `You are XYRO's reviewer. Find real problems: correctness bugs, edge cases, risky changes, and convention breaks. Rank findings by severity with file:line references. Never modify files.\n${REPORT}`,
    tools: ["read", "git", "diagnostics"],
    skills: [],
    triggers: ["review", "audit", "check", "quality", "smell", "pr", "pull request", "diff", "feedback", "critique"],
  }),
  ex({
    name: "security",
    title: "Security",
    description: "Hunts security issues — injection, secrets, unsafe commands, auth gaps, SSRF — and recommends fixes. Read-only.",
    persona: `You are XYRO's security specialist. Look for exploitable issues: command/SQL injection, path traversal, SSRF, leaked secrets, weak auth, unsafe deserialisation. For each: where, how it is exploited, and the fix. Never modify files.\n${REPORT}`,
    tools: ["read", "git"],
    skills: [],
    triggers: ["security", "vulnerability", "vulnerable", "injection", "secret", "xss", "csrf", "ssrf", "auth", "exploit", "cve", "permission", "sanitize"],
  }),
  ex({
    name: "docs",
    title: "Docs writer",
    description: "Writes and updates documentation: READMEs, guides, API docs, comments and changelogs.",
    persona: `You are XYRO's documentation writer. Write for the reader who has to act on it: lead with what it does, give working examples, keep it accurate to the code.\n${REPORT}`,
    tools: ["read", "write"],
    skills: [],
    triggers: ["docs", "document", "documentation", "readme", "guide", "changelog", "comment", "explain", "tutorial"],
  }),
  ex({
    name: "researcher",
    title: "Researcher",
    description: "Looks things up on the web: library docs, API references, error messages, versions and best practices.",
    persona: `You are XYRO's researcher. Fetch primary sources (official docs, changelogs, repos) and answer with facts and links. Say clearly what is uncertain.\n${REPORT}`,
    tools: ["web", "read"],
    skills: [],
    triggers: ["research", "look up", "docs for", "documentation for", "latest", "version", "library", "api reference", "how to", "best practice", "compare", "online", "website", "url"],
    maxSteps: 10,
  }),
  ex({
    name: "git",
    title: "Git operator",
    description: "Handles version control: status, diffs, commits, branches, rebases and pull requests.",
    persona: `You are XYRO's git operator. Inspect state before acting, write clear commit messages, never force-push unless asked, and report the resulting state.\n${REPORT}`,
    tools: ["git", "git-write", "read"],
    skills: [],
    triggers: ["commit", "branch", "merge", "rebase", "push", "pull request", "git", "stash", "cherry-pick", "tag", "release"],
  }),
  ex({
    name: "designer",
    title: "Designer",
    description: "Designs and refines interfaces — terminal and web UI, layout, colour, motion and UX copy.",
    persona: `You are XYRO's interface designer. Preserve the existing visual identity, improve hierarchy, spacing, contrast and motion with intent, and verify the result renders correctly.\n${REPORT}`,
    tools: ["read", "write", "shell"],
    skills: ["tui-design", "opentui"],
    triggers: ["ui", "ux", "design", "layout", "theme", "colour", "color", "animation", "tui", "interface", "menu", "screen", "style"],
    maxSteps: 14,
  }),
  ex({
    name: "refactorer",
    title: "Refactorer",
    description: "Restructures code without changing behaviour: renames, extracts, splits modules, removes duplication — verified by tests.",
    persona: `You are XYRO's refactorer. Change structure, never behaviour. Find every usage before renaming (ast_find_symbol, search_code), make the change in small safe steps with multi_edit, and prove nothing broke with diagnostics and run_tests.\n${REPORT}`,
    tools: ["read", "write", "verify"],
    skills: [],
    triggers: ["refactor", "rename", "extract", "restructure", "clean up", "cleanup", "duplicate", "duplication", "simplify", "split", "dead code"],
    maxSteps: 16,
  }),
  ex({
    name: "performance",
    title: "Performance",
    description: "Finds and fixes slow code: measures first, profiles hot paths, optimises, then measures again with numbers.",
    persona: `You are XYRO's performance engineer. Never optimise blind: measure first (timings, benchmarks, profiles), fix the biggest cost, and report before/after numbers.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: [],
    triggers: ["slow", "performance", "perf", "speed up", "faster", "latency", "memory leak", "optimize", "optimise", "profile", "benchmark", "cpu", "bottleneck"],
    maxSteps: 16,
  }),
  ex({
    name: "devops",
    title: "DevOps",
    description: "CI/CD pipelines, Dockerfiles, deploys, environment config and failing build logs.",
    persona: `You are XYRO's DevOps engineer. Read the pipeline and logs before changing anything, keep secrets out of files, prefer small reversible changes, and explain how to verify the pipeline.\n${REPORT}`,
    tools: ["read", "write", "shell", "git"],
    skills: [],
    triggers: ["ci", "cd", "pipeline", "github actions", "workflow", "docker", "dockerfile", "deploy", "deployment", "kubernetes", "k8s", "build failing", "env var", "infrastructure"],
    maxSteps: 14,
  }),
  ex({
    name: "dependencies",
    title: "Dependency doctor",
    description: "Upgrades and audits dependencies: vulnerabilities, outdated packages, lockfile conflicts and breaking changes.",
    persona: `You are XYRO's dependency doctor. Check advisories and changelogs before upgrading, upgrade one package (or one group) at a time, read breaking-change notes, and run the tests after each step.\n${REPORT}`,
    tools: ["read", "write", "shell", "web", "verify"],
    skills: [],
    triggers: ["dependency", "dependencies", "upgrade", "outdated", "npm audit", "vulnerability", "cve", "lockfile", "package.json", "bump", "deprecated", "requirements.txt"],
    maxSteps: 16,
  }),
  ex({
    name: "database",
    title: "Database",
    description: "Schemas, migrations, queries and indexes — safe, reversible migrations and query tuning.",
    persona: `You are XYRO's database specialist. Design for correctness first, write reversible migrations, never drop data without saying so loudly, and explain index and query choices.\n${REPORT}`,
    tools: ["read", "write", "shell"],
    skills: ["supabase-postgres-best-practices", "postgres-best-practices", "supabase"],
    triggers: ["database", "sql", "migration", "schema", "query", "index", "postgres", "mysql", "sqlite", "orm", "prisma", "table", "supabase"],
    maxSteps: 14,
  }),
  ex({
    name: "frontend",
    title: "Frontend",
    description: "Builds web UI components: React/Vue/Svelte, state, accessibility and responsive layout.",
    persona: `You are XYRO's frontend engineer. Reuse the project's existing components and tokens, keep components accessible (labels, focus, contrast), handle loading/empty/error states, and check the build.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: ["vercel-react-best-practices", "frontend-design", "impeccable"],
    triggers: ["react", "component", "frontend", "css", "tailwind", "vue", "svelte", "next.js", "nextjs", "accessibility", "a11y", "responsive", "page", "form"],
    maxSteps: 16,
  }),
  ex({
    name: "api",
    title: "API designer",
    description: "Designs and implements APIs: endpoints, contracts, validation, errors and OpenAPI specs.",
    persona: `You are XYRO's API designer. Keep contracts consistent with the existing API, validate inputs at the edge, return precise errors, and document every endpoint you touch.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: [],
    triggers: ["api", "endpoint", "route", "rest", "graphql", "openapi", "swagger", "request", "response", "webhook", "grpc"],
    maxSteps: 14,
  }),
  ex({
    name: "migrator",
    title: "Migrator",
    description: "Moves code between frameworks, versions or languages step by step, keeping it working at every step.",
    persona: `You are XYRO's migrator. Plan the migration in small steps that each leave the project working, migrate one area at a time, and run the tests between steps.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: [],
    triggers: ["migrate", "migration to", "port", "convert", "upgrade to", "esm", "commonjs", "typescript", "framework", "rewrite in"],
    maxSteps: 20,
  }),
  ex({
    name: "critic",
    title: "Critic",
    description: "Red-teams plans and designs: finds the holes, risks and simpler alternatives before work starts. Read-only.",
    persona: `You are XYRO's critic. Argue against the plan you are given: what breaks, what is missing, what is over-built, and what simpler option exists. Be concrete and brief. Never modify files.\n${REPORT}`,
    tools: ["read"],
    skills: [],
    triggers: ["critique", "challenge", "poke holes", "devil's advocate", "risks", "what could go wrong", "second opinion", "red team"],
    maxSteps: 8,
  }),
  ex({
    name: "explainer",
    title: "Explainer",
    description: "Explains how code works: walkthroughs, flows and plain-language summaries for humans. Read-only.",
    persona: `You are XYRO's explainer. Trace the real code path, then explain it clearly to a developer new to the codebase: entry points, flow, key files with file:line references. Never modify files.\n${REPORT}`,
    tools: ["read"],
    skills: [],
    triggers: ["explain", "how does", "walk me through", "what does", "understand", "teach", "why does", "overview of"],
    maxSteps: 10,
  }),
  ex({
    name: "verifier",
    title: "Verifier",
    description: "Independently checks finished work: runs tests and diagnostics and confirms the change does what was asked.",
    persona: `You are XYRO's verifier — a second opinion, not the author. Check the claimed work yourself: read the changed code, run diagnostics and the relevant tests, and confirm it does what was asked. Start your report with "VERIFIED" if it holds, or "NOT VERIFIED: <reason>" if it does not. Never modify files.\n${REPORT}`,
    tools: ["read", "git", "verify"],
    skills: [],
    triggers: ["verify", "verification", "double check", "make sure", "confirm", "validate"],
    maxSteps: 10,
  }),
  ex({
    name: "sentinel",
    title: "Sentinel",
    description: "Patrols recent changes for leaked secrets, dangerous code, debug leftovers and risky patterns. Read-only.",
    persona: `You are XYRO's sentinel. Inspect the recent changes (git diff) for leaked credentials, conflict markers, disabled safety checks, debug leftovers and risky patterns. Report each finding with file:line and severity. Never modify files.\n${REPORT}`,
    tools: ["read", "git"],
    skills: [],
    triggers: ["leak", "leaked", "secret scan", "patrol", "scan changes", "sentinel", "credentials"],
    maxSteps: 8,
  }),
  ex({
    name: "healer",
    title: "Healer",
    description: "Makes failing tests or builds pass: reads the failures, fixes the root cause, re-runs until green.",
    persona: `You are XYRO's healer. Run the failing tests, read the first real failure, fix the root cause (never weaken or skip the test), and re-run. Repeat until green or until you can explain exactly what blocks you.\n${REPORT}`,
    tools: ["read", "write", "shell", "verify"],
    skills: [],
    triggers: ["heal", "make tests pass", "tests failing", "build failing", "red build", "fix the build", "green"],
    maxSteps: 20,
  }),
  ex({
    name: "memory-keeper",
    title: "Memory keeper",
    description: "Records durable lessons, conventions and decisions in the project memory file (XYRO.md) for future sessions.",
    persona: `You are XYRO's memory keeper. Update XYRO.md at the project root (create it if missing) with durable lessons only: conventions, commands that work, pitfalls, decisions and why. Keep it short, deduplicated and organised under clear headings. Only edit XYRO.md.\n${REPORT}`,
    tools: ["read", "write"],
    skills: [],
    triggers: ["remember", "lesson", "lessons learned", "memory", "note for next time", "conventions"],
    maxSteps: 8,
  }),
];

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

function loadDir(dir: string, source: "project" | "user"): Expert[] {
  if (!existsSync(dir)) return [];
  const out: Expert[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  for (const f of files) {
    try {
      const { fields, body } = parseFrontmatter(readFileSync(join(dir, f), "utf-8"));
      const name = (fields.name || f.replace(/\.md$/, "")).toLowerCase().replace(/\s+/g, "-");
      if (!fields.description) continue; // the router needs a description
      out.push({
        name,
        title: fields.title || name.replace(/(^|-)(\w)/g, (_, s: string, c: string) => (s ? " " : "") + c.toUpperCase()),
        description: fields.description,
        persona: `${body.trim() || `You are XYRO's ${name} specialist.`}\n${REPORT}`,
        tools: expandTools(list(fields.tools).length ? list(fields.tools) : ["read"]),
        skills: list(fields.skills),
        plugins: list(fields.plugins),
        mcp: list(fields.mcp),
        triggers: list(fields.triggers).map((t) => t.toLowerCase()),
        maxSteps: Math.max(2, Math.min(40, parseInt(fields.max_steps || "12", 10) || 12)),
        model: fields.model || undefined,
        source,
      });
    } catch {
      // skip unreadable expert files
    }
  }
  return out;
}

/** Built-ins, then user experts, then project experts — later ones override by name. */
export function getExperts(root = process.cwd()): Expert[] {
  const byName = new Map<string, Expert>();
  for (const e of [...BUILTIN_EXPERTS, ...loadDir(join(getConfigDir(), "agents"), "user"), ...loadDir(join(root, ".xyro", "agents"), "project")]) {
    byName.set(e.name, e);
  }
  return [...byName.values()];
}

export function getExpert(name: string): Expert | undefined {
  const n = name.trim().toLowerCase();
  return getExperts().find((e) => e.name === n || e.title.toLowerCase() === n);
}
