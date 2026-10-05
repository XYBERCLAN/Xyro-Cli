/**
 * verify — Close the agent's verification loop.
 *
 * Until now the only way for the model to see type/lint/test failures was to
 * guess a shell command through `run_command`, which is slow, fragile (wrong
 * flags, wrong runner, output buried in noise) and easy to skip altogether —
 * which is how an agent ends up claiming a change works when it does not.
 *
 * Two tools close that loop by reading the project first:
 *
 *   diagnostics  — typecheck + lint, parsed into `file:line:col` findings
 *   run_tests    — the project's own test command, parsed into pass/fail counts
 *
 * Both detect the ecosystem (Node / Rust / Go / Python) and the package manager
 * from the files on disk, so no configuration is required. Commands come from
 * the project's own manifest, never from the model, which keeps the surface
 * small; both tools are still gated by the permission system.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Hard caps so a pathological project can't flood the context window. */
const MAX_FINDINGS = 25;
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 120_000;
const DEFAULT_TEST_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 900_000;
/** Only the tail of a noisy log is interesting. */
const MAX_RAW_CHARS = 20_000;

export type Ecosystem = "node" | "rust" | "go" | "python" | "unknown";

export interface ProjectProfile {
  root: string;
  ecosystem: Ecosystem;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
  scripts: Record<string, string>;
  typecheck: string | null;
  lint: string | null;
  test: string | null;
}

export interface Finding {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CommandOutcome {
  command: string;
  exitCode: number;
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  raw: string;
  skipped?: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function detectPackageManager(root: string): NonNullable<ProjectProfile["packageManager"]> {
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

/** Run a package.json script by name in a package-manager-agnostic way. */
function scriptCommand(pm: NonNullable<ProjectProfile["packageManager"]>, script: string): string {
  // `npm run lint` / `pnpm lint` / `yarn lint` / `bun lint` all accept the bare
  // form too, except npm where `npm lint` is an alias — keep `npm run` explicit.
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

/** Inspect the project and derive the commands worth running. */
export function detectProject(root: string = process.cwd()): ProjectProfile {
  const profile: ProjectProfile = {
    root,
    ecosystem: "unknown",
    packageManager: null,
    scripts: {},
    typecheck: null,
    lint: null,
    test: null,
  };

  const pkg = readJson(join(root, "package.json"));
  if (pkg) {
    profile.ecosystem = "node";
    const pm = detectPackageManager(root);
    profile.packageManager = pm;
    const scripts =
      pkg["scripts"] && typeof pkg["scripts"] === "object"
        ? (pkg["scripts"] as Record<string, string>)
        : {};
    profile.scripts = scripts;

    // Prefer the project's own scripts: they encode the right flags and config.
    const typecheckScript = ["typecheck", "check-types", "check:types", "tsc"].find((s) => scripts[s]);
    if (typecheckScript) {
      profile.typecheck = scriptCommand(pm, typecheckScript);
    } else if (existsSync(join(root, "tsconfig.json"))) {
      profile.typecheck = "npx --no-install tsc --noEmit";
    }

    const lintScript = ["lint", "eslint"].find((s) => scripts[s]);
    if (lintScript) {
      profile.lint = scriptCommand(pm, lintScript);
    } else if (
      existsSync(join(root, "eslint.config.js")) ||
      existsSync(join(root, "eslint.config.mjs")) ||
      existsSync(join(root, ".eslintrc.json")) ||
      existsSync(join(root, ".eslintrc.js")) ||
      existsSync(join(root, ".eslintrc.cjs"))
    ) {
      profile.lint = "npx --no-install eslint .";
    }

    const testScript = ["test", "test:unit", "test:ci"].find((s) => scripts[s]);
    if (testScript) profile.test = scriptCommand(pm, testScript);
  }

  if (profile.ecosystem === "unknown") {
    if (existsSync(join(root, "Cargo.toml"))) {
      profile.ecosystem = "rust";
      profile.typecheck = "cargo check --message-format short";
      profile.test = "cargo test";
    } else if (existsSync(join(root, "go.mod"))) {
      profile.ecosystem = "go";
      profile.typecheck = "go vet ./...";
      profile.test = "go test ./...";
    } else if (
      existsSync(join(root, "pyproject.toml")) ||
      existsSync(join(root, "pytest.ini")) ||
      existsSync(join(root, "setup.cfg")) ||
      existsSync(join(root, "requirements.txt"))
    ) {
      profile.ecosystem = "python";
      profile.typecheck = "python -m compileall -q .";
      profile.test = "python -m pytest -q";
    }
  }

  return profile;
}

function clampTimeout(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_TIMEOUT_MS);
}

/** Execute a command without throwing, capturing both streams. */
export function runRawCommand(command: string, timeoutMs: number): CommandOutcome {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    cwd: process.cwd(),
    // Keep tool output stable and parseable regardless of the user's locale.
    env: { ...process.env, NO_COLOR: "1", CI: "1", FORCE_COLOR: "0" },
  });

  const stdout = (result.stdout || "").toString();
  const stderr = (result.stderr || "").toString();
  const timedOut = Boolean(result.error && /ETIMEDOUT|timed out/i.test(String(result.error.message)));

  return {
    command,
    exitCode: typeof result.status === "number" ? result.status : timedOut ? 124 : 1,
    ok: result.status === 0,
    stdout,
    stderr,
    timedOut,
    raw: (stdout + (stderr ? `\n${stderr}` : "")).slice(-MAX_RAW_CHARS),
  };
}

const TS_ERROR_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;
const RUST_ERROR_RE = /^(error|warning)(?:\[(E\d+)\])?:\s+(.*)$/;
const RUST_LOCATION_RE = /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/;
const GO_ERROR_RE = /^(.+?\.go):(\d+):(?:(\d+):)?\s+(.*)$/;
const PY_ERROR_RE = /^(.+?\.py):(\d+):(?:\d+:)?\s+(?:in \S+)?\s*(.*)$/;
const ESLINT_PROBLEM_RE = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s\s+([\w@/-]+))?$/;
/** `> npm run build` style echo lines emitted by npm/pnpm/yarn. */
const COMMAND_ECHO_RE = /^\s*>\s+\S/;

/** Extract structured findings from a compiler/linter log. */
export function parseFindings(raw: string): Finding[] {
  const findings: Finding[] = [];
  // Package managers echo the command line they are about to run (`> npm run
  // build`). When that command text contains something shaped like a
  // diagnostic it would be double-counted, so drop those echoes up front.
  const lines = raw.split(/\r?\n/).filter((line) => !COMMAND_ECHO_RE.test(line));

  let pendingRust: { severity: "error" | "warning"; code: string; message: string } | null = null;

  for (const line of lines) {
    const ts = TS_ERROR_RE.exec(line);
    if (ts) {
      findings.push({
        file: ts[1],
        line: Number(ts[2]),
        column: Number(ts[3]),
        severity: ts[4] as "error" | "warning",
        code: ts[5],
        message: ts[6].trim(),
      });
      pendingRust = null;
      continue;
    }

    const rustLoc = RUST_LOCATION_RE.exec(line);
    if (rustLoc && pendingRust) {
      findings.push({
        file: rustLoc[1],
        line: Number(rustLoc[2]),
        column: Number(rustLoc[3]),
        severity: pendingRust.severity,
        code: pendingRust.code,
        message: pendingRust.message,
      });
      pendingRust = null;
      continue;
    }

    const rust = RUST_ERROR_RE.exec(line);
    if (rust && (rust[1] === "error" || rust[1] === "warning")) {
      pendingRust = {
        severity: rust[1],
        code: rust[2] || "cargo",
        message: rust[3].trim(),
      };
      continue;
    }

    const go = GO_ERROR_RE.exec(line);
    if (go && !/^(ok|FAIL|\?)/.test(line.trim())) {
      findings.push({
        file: go[1],
        line: Number(go[2]),
        column: go[3] ? Number(go[3]) : 0,
        severity: "error",
        code: "go",
        message: go[4].trim(),
      });
      continue;
    }

    const py = PY_ERROR_RE.exec(line);
    if (py) {
      findings.push({
        file: py[1],
        line: Number(py[2]),
        column: 0,
        severity: "error",
        code: "python",
        message: py[3].trim(),
      });
      continue;
    }

    const eslint = ESLINT_PROBLEM_RE.exec(line);
    if (eslint) {
      findings.push({
        file: "(eslint)",
        line: Number(eslint[1]),
        column: Number(eslint[2]),
        severity: eslint[3] as "error" | "warning",
        code: eslint[5] || "eslint",
        message: eslint[4].trim(),
      });
      continue;
    }
  }

  return findings;
}

export interface TestSummary {
  passed: number | null;
  failed: number | null;
  total: number | null;
  failures: string[];
}

/** Extract pass/fail counts and failing test names from a test log. */
export function parseTestSummary(raw: string): TestSummary {
  const summary: TestSummary = { passed: null, failed: null, total: null, failures: [] };
  const failures: string[] = [];

  const addFailure = (name: string): void => {
    const clean = name.trim().replace(/^#\s*/, "");
    if (clean && failures.length < MAX_FINDINGS && !failures.includes(clean)) {
      failures.push(clean);
    }
  };

  for (const line of raw.split(/\r?\n/).filter((l) => !COMMAND_ECHO_RE.test(l))) {
    // node:test
    let m = /^#\s*pass\s+(\d+)/m.exec(line);
    if (m) summary.passed = Number(m[1]);
    m = /^#\s*fail\s+(\d+)/m.exec(line);
    if (m) summary.failed = Number(m[1]);
    m = /^#\s*tests\s+(\d+)/m.exec(line);
    if (m) summary.total = Number(m[1]);

    // node:test failure header
    if (/^not ok\b/.test(line)) {
      addFailure(line.replace(/^not ok\s+\d+\s*-\s*/, ""));
    }
    // cargo
    m = /test result:\s*(\w+)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed/.exec(line);
    if (m) {
      summary.passed = Number(m[2]);
      summary.failed = Number(m[3]);
      summary.total = Number(m[2]) + Number(m[3]);
    }
    // go
    if (/^---\s*FAIL:\s*/.test(line)) addFailure(line.replace(/^---\s*FAIL:\s*/, ""));
    if (/^FAIL\s/.test(line)) addFailure(line.trim());
    // jest / vitest
    m = /Tests:\s+(?:(\d+)\s+failed)?,?\s*(?:(\d+)\s+passed)?/.exec(line);
    if (m && (m[1] || m[2])) {
      summary.failed = m[1] ? Number(m[1]) : 0;
      summary.passed = m[2] ? Number(m[2]) : 0;
      summary.total = (summary.failed || 0) + (summary.passed || 0);
    }
    // pytest
    m = /^(\d+)\s+failed,\s+(\d+)\s+passed/.exec(line);
    if (m) {
      summary.failed = Number(m[1]);
      summary.passed = Number(m[2]);
      summary.total = Number(m[1]) + Number(m[2]);
    }
    // pytest failure header
    if (/^FAILED\s+\S+::/.test(line)) addFailure(line.replace(/^FAILED\s+/, "").split(" - ")[0]);
    // tap
    m = /^#\s*(\d+)\s+tests?\s+(\d+)\s+(?:failed|failures)/.exec(line);
    if (m) summary.failed = Number(m[2]);
  }

  summary.failures = failures;
  if (summary.total === null && summary.passed !== null && summary.failed !== null) {
    summary.total = summary.passed + summary.failed;
  }
  return summary;
}

function formatFindings(title: string, outcome: CommandOutcome): string {
  const findings = parseFindings(outcome.raw);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.length - errors.length;

  if (outcome.ok && findings.length === 0) {
    return `✅ ${title}: clean (${outcome.command})`;
  }

  const head =
    outcome.ok && errors.length === 0
      ? `⚠️  ${title}: 0 errors, ${warnings} warning(s) (${outcome.command})`
      : `❌ ${title}: ${errors.length} error(s), ${warnings} warning(s) (${outcome.command})`;

  const shown = findings.slice(0, MAX_FINDINGS);
  const body = shown.map(
    (f) => `  ${f.file}:${f.line}${f.column ? `:${f.column}` : ""} ${f.severity} ${f.code}: ${f.message}`
  );
  const overflow =
    findings.length > shown.length ? [`  … and ${findings.length - shown.length} more`] : [];

  if (findings.length === 0) {
    // Parser found nothing structured — hand back the tail so the model can read it.
    const tail = outcome.raw.trim().split(/\r?\n/).slice(-20).join("\n");
    return `${head}\n(no structured findings; raw tail)\n${tail}`;
  }

  return [head, ...body, ...overflow].join("\n");
}

/** Tool: typecheck + lint with parsed, file:line:col findings. */
export async function runDiagnostics(
  args: { scope?: string; timeout_ms?: number } = {}
): Promise<string> {
  const profile = detectProject();
  const timeout = clampTimeout(args.timeout_ms, DEFAULT_DIAGNOSTICS_TIMEOUT_MS);
  const scope = (args.scope || "all").toLowerCase();

  if (profile.ecosystem === "unknown") {
    return [
      "ℹ️  No recognised project (no package.json / Cargo.toml / go.mod / pyproject.toml).",
      "Nothing to typecheck. Use run_command for ad-hoc checks.",
    ].join("\n");
  }

  const sections: string[] = [];
  const wantTypecheck = scope === "all" || scope === "typecheck" || scope === "types";
  const wantLint = scope === "all" || scope === "lint";

  if (wantTypecheck) {
    if (!profile.typecheck) {
      sections.push("ℹ️  typecheck: no typecheck command detected — skipped.");
    } else {
      sections.push(formatFindings("typecheck", runRawCommand(profile.typecheck, timeout)));
    }
  }

  if (wantLint) {
    if (!profile.lint) {
      sections.push("ℹ️  lint: no lint command detected — skipped.");
    } else {
      sections.push(formatFindings("lint", runRawCommand(profile.lint, timeout)));
    }
  }

  const combined = sections.join("\n\n");
  const hasErrors = /❌/.test(combined);
  return hasErrors
    ? `${combined}\n\nFix these findings before reporting the task as done.`
    : combined;
}

/** Tool: run the project's test suite and summarise the outcome. */
export async function runProjectTests(
  args: { filter?: string; timeout_ms?: number } = {}
): Promise<string> {
  const profile = detectProject();
  const timeout = clampTimeout(args.timeout_ms, DEFAULT_TEST_TIMEOUT_MS);

  if (!profile.test) {
    return [
      "ℹ️  No test command detected in this project (checked package.json scripts, Cargo.toml, go.mod, pyproject.toml).",
      "Use run_command if the suite is invoked differently.",
    ].join("\n");
  }

  const filter = typeof args.filter === "string" ? args.filter.trim() : "";
  const command = filter ? `${profile.test} ${filter}` : profile.test;
  const outcome = runRawCommand(command, timeout);

  if (outcome.timedOut) {
    return `❌ tests timed out after ${Math.round(timeout / 1000)}s (${command}). Re-run with a narrower filter.`;
  }

  const summary = parseTestSummary(outcome.raw);
  const counts = [
    summary.passed !== null ? `${summary.passed} passed` : null,
    summary.failed !== null ? `${summary.failed} failed` : null,
    summary.total !== null ? `${summary.total} total` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const head = outcome.ok
    ? `✅ tests passed${counts ? ` (${counts})` : ""} — ${command}`
    : `❌ tests failed${counts ? ` (${counts})` : ""} — ${command}`;

  const blocks: string[] = [head];

  if (summary.failures.length > 0) {
    blocks.push("Failing tests:");
    for (const f of summary.failures.slice(0, MAX_FINDINGS)) blocks.push(`  ✗ ${f}`);
  }

  // Always show a tail of the log: the assertion detail lives there.
  const tail = outcome.raw.trim().split(/\r?\n/).slice(-25);
  if (tail.length > 0 && summary.failures.length > 0) {
    blocks.push("Output tail:");
    for (const line of tail) blocks.push(`  ${line}`);
  } else if (!outcome.ok && summary.failures.length === 0) {
    blocks.push("Output tail:");
    for (const line of tail) blocks.push(`  ${line}`);
  }

  if (!outcome.ok) {
    blocks.push("Fix the failures before reporting the task as done.");
  }

  return blocks.join("\n");
}
