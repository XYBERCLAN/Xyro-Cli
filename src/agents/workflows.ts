// Workflows — saved team plays. Each stage runs one or more experts (in
// parallel); later stages receive the earlier reports. Steps go through
// delegate, so writers are verified and failures escalate as usual.
//
//   .xyro/workflows/<name>.md  ·  ~/.config/xyro/workflows/<name>.md
//
//   ---
//   name: api-feature
//   description: Design, build, test and document an API endpoint
//   ---
//   1. api: Design the endpoint for: {{goal}}
//   2. builder: Implement it following the design.
//   3. tester: Write tests for {{goal}} || security: Audit the new endpoint
//   4. docs: Document the endpoint.
//
// `||` runs steps of a stage in parallel. {{goal}} is the user's goal.

import { projectFileTrust, trustProjectFile } from "../agent/hooks.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { parseFrontmatter } from "./skills-catalog.js";

export interface WorkflowStep {
  expert: string;
  task: string;
}

export interface Workflow {
  name: string;
  description: string;
  stages: WorkflowStep[][];
  source: "builtin" | "user" | "project";
}

/** Parse "1. expert: task || expert: task" lines into stages. */
export function parseStages(body: string): WorkflowStep[][] {
  const stages: WorkflowStep[][] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim();
    if (!line || !/^[a-z][\w-]*\s*:/i.test(line)) continue;
    const steps = line
      .split("||")
      .map((part) => part.trim().match(/^([a-z][\w-]*)\s*:\s*(.+)$/i))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ expert: m[1].toLowerCase(), task: m[2].trim() }));
    if (steps.length) stages.push(steps);
  }
  return stages;
}

const wf = (name: string, description: string, body: string): Workflow => ({ name, description, stages: parseStages(body), source: "builtin" });

export const BUILTIN_WORKFLOWS: Workflow[] = [
  wf(
    "feature",
    "Plan, build, test, review and document a feature",
    `1. architect: Design how to implement this, with concrete steps: {{goal}}
     2. builder: Implement this following the architect's design: {{goal}}
     3. tester: Write and run tests for: {{goal}} || reviewer: Review the new changes for: {{goal}}
     4. docs: Update the documentation for: {{goal}}`
  ),
  wf(
    "bugfix",
    "Reproduce, fix and lock in a bug fix with a regression test",
    `1. debugger: Reproduce, find the root cause and fix: {{goal}}
     2. tester: Add a regression test proving this stays fixed: {{goal}}`
  ),
  wf(
    "review",
    "Review the current changes from three angles at once",
    `1. reviewer: Review the current changes (git diff) for bugs and risks. Focus: {{goal}} || security: Audit the current changes for security issues. Focus: {{goal}} || performance: Check the current changes for performance problems. Focus: {{goal}}`
  ),
  wf(
    "release-check",
    "Pre-release health check: tests, security, dependencies",
    `1. tester: Run the full test suite and report failures. Context: {{goal}} || security: Audit the codebase for vulnerabilities before release. Context: {{goal}} || dependencies: Check dependencies for known vulnerabilities and risky outdated packages. Context: {{goal}}`
  ),
  wf(
    "refactor",
    "Plan, refactor safely, then review",
    `1. architect: Plan a safe, incremental refactor for: {{goal}}
     2. refactorer: Carry out the planned refactor without changing behaviour: {{goal}}
     3. reviewer: Review the refactor for behaviour changes and risks: {{goal}}`
  ),
  wf(
    "onboard",
    "Map and explain a codebase (or part of it) for a newcomer",
    `1. scout: Map the parts of the codebase relevant to: {{goal}}
     2. explainer: Explain how it works, using the scout's map: {{goal}}`
  ),
];

function loadDir(dir: string, source: "user" | "project"): Workflow[] {
  if (!existsSync(dir)) return [];
  const out: Workflow[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    try {
      // Same rule as project experts: a cloned repo's workflows load only once trusted
      if (source === "project" && projectFileTrust(join(dir, f)) !== "trusted") continue;
      const { fields, body } = parseFrontmatter(readFileSync(join(dir, f), "utf-8"));
      const stages = parseStages(body);
      if (!stages.length) continue;
      const name = (fields.name || f.replace(/\.md$/, "")).toLowerCase();
      if (source === "project" && BUILTIN_WORKFLOWS.some((b) => b.name === name)) continue;
      out.push({ name, description: fields.description || "", stages, source });
    } catch {
      // skip unreadable workflow files
    }
  }
  return out;
}

function projectWorkflowFiles(root: string): string[] {
  const dir = join(root, ".xyro", "workflows");
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function untrustedProjectWorkflows(root = process.cwd()): string[] {
  return projectWorkflowFiles(root).filter((p) => projectFileTrust(p) !== "trusted");
}

export function trustProjectWorkflows(root = process.cwd()): number {
  return projectWorkflowFiles(root).filter((p) => trustProjectFile(p)).length;
}

export function getWorkflows(root = process.cwd()): Workflow[] {
  const byName = new Map<string, Workflow>();
  for (const w of [...BUILTIN_WORKFLOWS, ...loadDir(join(getConfigDir(), "workflows"), "user"), ...loadDir(join(root, ".xyro", "workflows"), "project")]) {
    byName.set(w.name, w);
  }
  return [...byName.values()];
}

export function getWorkflow(name: string): Workflow | undefined {
  return getWorkflows().find((w) => w.name === name.trim().toLowerCase());
}

export function describeWorkflow(w: Workflow): string {
  return w.stages.map((s, i) => `${i + 1}. ${s.map((st) => st.expert).join(" + ")}`).join(" → ");
}
