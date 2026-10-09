// Power tools for XYRO and its experts:
//   repo_map    — ranked map of the codebase's key symbols within a token budget
//   multi_edit  — many edits across many files, validated first, all-or-nothing
//   run_tests   — detect the runner, run it, return structured pass/fail results
//   diagnostics — typecheck / lint errors as a structured list

import { runShell } from "./proc.js";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import fg from "fast-glob";
import { execa } from "execa";
import { IGNORED_DIRS } from "../config/constants.js";
import { resolveProjectPath } from "./safety.js";
import { backupFile } from "./undo.js";
import { isDangerousCommand } from "./shell.js";
import { GitIgnoreMatcher } from "./gitignore.js";
import { workspaceRoot } from "../agent/workspace.js";

// ─── repo_map ────────────────────────────────────────────────────────────────

interface FileSymbols {
  file: string;
  defs: { name: string; line: string }[];
}

/** Definition patterns per language family (regex over trimmed source lines). */
const DEF_PATTERNS: { exts: string[]; re: RegExp }[] = [
  {
    exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    re: /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let)\s+([A-Za-z_$][\w$]*)/,
  },
  { exts: [".py"], re: /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/ },
  { exts: [".go"], re: /^(?:func(?:\s+\([^)]*\))?|type)\s+([A-Za-z_]\w*)/ },
  { exts: [".rs"], re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|type|mod)\s+([A-Za-z_]\w*)/ },
  { exts: [".java", ".kt", ".cs", ".swift"], re: /^(?:(?:public|private|protected|internal|static|final|abstract|open|override|data|sealed)\s+)*(?:class|interface|enum|record|struct|object|fun|func)\s+([A-Za-z_]\w*)/ },
  { exts: [".rb"], re: /^(?:def|class|module)\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/ },
  { exts: [".php"], re: /^(?:(?:public|private|protected|static|abstract|final)\s+)*(?:function|class|interface|trait)\s+([A-Za-z_]\w*)/ },
];

const MAP_EXTS = new Set(DEF_PATTERNS.flatMap((p) => p.exts));

function extractDefs(file: string, text: string): FileSymbols {
  const pat = DEF_PATTERNS.find((p) => p.exts.includes(extname(file).toLowerCase()));
  const defs: { name: string; line: string }[] = [];
  if (!pat) return { file, defs };
  for (const raw of text.split(/\r?\n/)) {
    // Top-level-ish only: ignore deeply indented lines (locals, nested helpers)
    if (/^\s{5,}/.test(raw)) continue;
    const l = raw.trim();
    const m = l.match(pat.re);
    if (m && m[1].length > 1) defs.push({ name: m[1], line: l.replace(/\s*\{\s*$/, "").slice(0, 140) });
  }
  return { file, defs: defs.slice(0, 40) };
}

export async function repoMap(args: { path?: string; focus?: string; budget_tokens?: number }): Promise<string> {
  const base = resolveProjectPath(args.path || ".");
  if (!base.ok) return base.message;
  const budgetChars = Math.max(400, Math.min(args.budget_tokens ?? 1500, 8000)) * 4;
  const matcher = new GitIgnoreMatcher(base.path);
  const ignore = [...IGNORED_DIRS].flatMap((d) => [`**/${d}/**`]);
  const files = (await fg("**/*", { cwd: base.path, ignore, onlyFiles: true, dot: false, followSymbolicLinks: false }))
    .filter((f) => MAP_EXTS.has(extname(f).toLowerCase()) && !matcher.isIgnored(f) && !/\.(d\.ts|min\.js)$/.test(f))
    .slice(0, 3000);

  const texts = new Map<string, string>();
  const symbols: FileSymbols[] = [];
  for (const f of files) {
    try {
      const abs = join(base.path, f);
      if (statSync(abs).size > 300_000) continue;
      const text = readFileSync(abs, "utf-8");
      texts.set(f, text);
      const s = extractDefs(f, text);
      if (s.defs.length) symbols.push(s);
    } catch {
      // unreadable
    }
  }
  if (!symbols.length) return "No source definitions found to map.";

  // Rank: how often a file's symbols are referenced from OTHER files (+ focus boost)
  const owner = new Map<string, string>();
  for (const s of symbols) for (const d of s.defs) if (!owner.has(d.name)) owner.set(d.name, s.file);
  const refs = new Map<string, number>();
  const wordRe = /[A-Za-z_$][\w$]{2,}/g;
  for (const [f, text] of texts) {
    const seen = new Set<string>();
    for (const w of text.match(wordRe) ?? []) {
      const o = owner.get(w);
      if (o && o !== f && !seen.has(w)) {
        seen.add(w);
        refs.set(o, (refs.get(o) ?? 0) + 1);
      }
    }
  }
  const focus = (args.focus || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const score = (s: FileSymbols) => {
    let sc = refs.get(s.file) ?? 0;
    const hay = `${s.file} ${s.defs.map((d) => d.name).join(" ")}`.toLowerCase();
    for (const w of focus) if (hay.includes(w)) sc += 25;
    return sc + s.defs.length * 0.1;
  };
  symbols.sort((a, b) => score(b) - score(a));

  const out: string[] = [`Repo map (${symbols.length} files with definitions, most-referenced first${focus.length ? `, focus: ${args.focus}` : ""}):`];
  let used = out[0].length;
  let shown = 0;
  for (const s of symbols) {
    const block = `\n${relative(workspaceRoot(), join(base.path, s.file)) || s.file}:\n${s.defs.map((d) => `  ${d.line}`).join("\n")}`;
    if (used + block.length > budgetChars) {
      if (shown === 0) out.push(block.slice(0, budgetChars - used));
      break;
    }
    out.push(block);
    used += block.length;
    shown++;
  }
  if (shown < symbols.length) out.push(`\n… ${symbols.length - shown} more files (raise budget_tokens or pass focus to see others)`);
  return out.join("");
}

// ─── multi_edit ──────────────────────────────────────────────────────────────

export interface EditSpec {
  path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}

export async function multiEdit(args: { edits: EditSpec[] }): Promise<string> {
  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (!edits.length) return "❌ multi_edit: `edits` must contain at least one edit.";

  // 1. Validate everything in memory first — nothing is written unless all edits apply
  const pending = new Map<string, { display: string; before: string; after: string; count: number }>();
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const r = resolveProjectPath(e.path);
    if (!r.ok) return `❌ Edit ${i + 1}: ${r.message}`;
    if (!e.old_text) return `❌ Edit ${i + 1} (${e.path}): old_text is empty.`;
    let entry = pending.get(r.path);
    if (!entry) {
      if (!existsSync(r.path)) return `❌ Edit ${i + 1}: file not found: ${e.path}`;
      const text = readFileSync(r.path, "utf-8");
      entry = { display: e.path, before: text, after: text, count: 0 };
      pending.set(r.path, entry);
    }
    const occurrences = entry.after.split(e.old_text).length - 1;
    if (occurrences === 0) return `❌ Edit ${i + 1} (${e.path}): old_text not found (after applying the earlier edits to this file). No files were changed.`;
    if (occurrences > 1 && !e.replace_all) {
      return `❌ Edit ${i + 1} (${e.path}): old_text matches ${occurrences} places — add more surrounding context or set replace_all. No files were changed.`;
    }
    entry.after = e.replace_all ? entry.after.split(e.old_text).join(e.new_text) : entry.after.replace(e.old_text, () => e.new_text);
    entry.count += e.replace_all ? occurrences : 1;
  }

  // 2. Apply
  const lines: string[] = [];
  for (const [abs, p] of pending) {
    if (p.before === p.after) continue;
    backupFile(abs);
    writeFileSync(abs, p.after, "utf-8");
    lines.push(`  ${p.display}: ${p.count} change${p.count === 1 ? "" : "s"}`);
  }
  return `✅ Applied ${edits.length} edit${edits.length === 1 ? "" : "s"} across ${lines.length} file${lines.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

// ─── run_tests ───────────────────────────────────────────────────────────────

export interface TestSummary {
  runner: string;
  passed: number | null;
  failed: number | null;
  failures: string[];
}

/** Pick a test command for the current project. */
export function detectTestCommand(root = workspaceRoot()): { runner: string; command: string } | null {
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const t = pkg.scripts?.test;
      if (t && !/no test specified/.test(t)) {
        const pm = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "bun.lockb")) ? "bun" : "npm";
        return { runner: /vitest/.test(t) ? "vitest" : /jest/.test(t) ? "jest" : /--test/.test(t) ? "node:test" : pm, command: `${pm} test` };
      }
    } catch {
      // fall through
    }
  }
  if (existsSync(join(root, "pytest.ini")) || existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "setup.py"))) return { runner: "pytest", command: "python -m pytest -q" };
  if (existsSync(join(root, "go.mod"))) return { runner: "go", command: "go test ./..." };
  if (existsSync(join(root, "Cargo.toml"))) return { runner: "cargo", command: "cargo test" };
  return null;
}

/** Pull pass/fail counts and failing test names out of common runner outputs. */
export function parseTestOutput(out: string, runner = ""): TestSummary {
  const num = (re: RegExp) => {
    const m = out.match(re);
    return m ? parseInt(m[1], 10) : null;
  };
  const failures: string[] = [];
  let passed: number | null = null;
  let failed: number | null = null;

  // TAP / node:test
  if (/^# (pass|fail) \d+/m.test(out)) {
    passed = num(/^# pass (\d+)/m);
    failed = num(/^# fail (\d+)/m);
    for (const m of out.matchAll(/^\s*not ok \d+ - (.+)$/gm)) failures.push(m[1].trim());
  }
  // Jest / Vitest: "Tests:  2 failed, 10 passed" / "Tests  2 failed | 10 passed"
  const jest = out.match(/Tests?:?\s+(?:(\d+) failed[,|\s]+)?(?:\d+ skipped[,|\s]+)?(\d+) passed/);
  if (jest) {
    failed = jest[1] ? parseInt(jest[1], 10) : 0;
    passed = parseInt(jest[2], 10);
    for (const m of out.matchAll(/^\s*(?:●|×|✕|FAIL)\s+(.+)$/gm)) failures.push(m[1].trim());
  }
  // pytest: "3 passed, 1 failed in 0.12s"
  const py = out.match(/(?:(\d+) failed, )?(\d+) passed(?:, (\d+) failed)?.*in [\d.]+s/);
  if (py && (runner === "pytest" || /pytest|passed in/.test(out))) {
    passed = parseInt(py[2], 10);
    failed = parseInt(py[1] ?? py[3] ?? "0", 10);
    for (const m of out.matchAll(/^FAILED (\S+)/gm)) failures.push(m[1]);
  }
  // go test
  if (runner === "go" || /^(ok|FAIL)\s+\S+/m.test(out)) {
    for (const m of out.matchAll(/^--- FAIL: (\S+)/gm)) failures.push(m[1]);
    if (failures.length || /^ok\s/m.test(out)) {
      failed = failures.length;
      passed = (out.match(/^--- PASS: /gm) ?? []).length || passed;
    }
  }
  // cargo test: "test result: FAILED. 3 passed; 1 failed;"
  const cargo = out.match(/test result: \w+\. (\d+) passed; (\d+) failed/);
  if (cargo) {
    passed = parseInt(cargo[1], 10);
    failed = parseInt(cargo[2], 10);
    for (const m of out.matchAll(/^test (\S+) \.\.\. FAILED/gm)) failures.push(m[1]);
  }
  return { runner, passed, failed, failures: [...new Set(failures)].slice(0, 25) };
}

export async function runTests(args: { command?: string; filter?: string }): Promise<string> {
  const detected = detectTestCommand(workspaceRoot());
  let command = args.command?.trim() || detected?.command;
  if (!command) return "❌ No test command found (no package.json test script, pytest, go.mod or Cargo.toml). Pass `command`.";
  if (args.filter) {
    // Never let the filter reach the shell as code: safe characters only, single-quoted
    if (!/^[\w .:/@*\-[\]]{1,200}$/.test(args.filter)) return "❌ run_tests: filter may only contain letters, digits, spaces and . : / @ * - [ ]";
    command += ` ${/^(npm|pnpm|yarn|bun) test$/.test(command) ? "-- " : ""}'${args.filter.replace(/'/g, "'\\''")}'`;
  }
  if (isDangerousCommand(command)) return "❌ Refused to run a dangerous command";

  const started = Date.now();
  const res = await runShell(command, { cwd: workspaceRoot(), timeoutMs: 10 * 60_000, env: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" } });
  if (res.stopped) return `⛔ Tests stopped by the user (${command})`;
  const out = String(res.all ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  const s = parseTestOutput(out, detected?.runner ?? "");
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = res.exitCode === 0 && !res.timedOut;

  const head = res.timedOut
    ? `⏱ Tests timed out after 10 minutes (${command})`
    : `${ok ? "✅ Tests passed" : "❌ Tests failed"} — ${command} (${secs}s)`;
  const counts = s.passed !== null || s.failed !== null ? `\npassed: ${s.passed ?? "?"} · failed: ${s.failed ?? "?"}` : "";
  const fails = s.failures.length ? `\nFailing:\n${s.failures.map((f) => `  - ${f}`).join("\n")}` : "";
  const tail = ok ? "" : `\n\nLast output:\n${out.split("\n").slice(-60).join("\n").slice(-6000)}`;
  return head + counts + fails + tail;
}

// ─── diagnostics ─────────────────────────────────────────────────────────────

export async function diagnostics(args: { path?: string }): Promise<string> {
  const root = workspaceRoot();
  // The path is only ever a file/folder inside the project — never a CLI option
  let target = ".";
  if (args.path) {
    if (args.path.startsWith("-")) return "❌ diagnostics: path must be a file or folder, not an option";
    const r = resolveProjectPath(args.path);
    if (!r.ok) return r.message;
    target = relative(root, r.path) || ".";
  }
  const bin = (name: string) => {
    const p = join(root, "node_modules", ".bin", name);
    return existsSync(p) ? p : null;
  };
  const sections: string[] = [];
  let total = 0;

  const tsc = bin("tsc");
  if (tsc && existsSync(join(root, "tsconfig.json"))) {
    const res = await execa(tsc, ["--noEmit", "--pretty", "false"], { cwd: root, reject: false, timeout: 5 * 60_000, all: true });
    const errs = [...String(res.all ?? "").matchAll(/^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/gm)]
      .filter((m) => !args.path || m[1].includes(args.path))
      .map((m) => `  ${m[1]}:${m[2]}:${m[3]}  ${m[5]}  ${m[6]}`);
    total += errs.length;
    sections.push(errs.length ? `TypeScript — ${errs.length} problem${errs.length === 1 ? "" : "s"}:\n${errs.slice(0, 60).join("\n")}` : "TypeScript — no errors");
  }

  const eslint = bin("eslint");
  const hasEslintConfig = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs"].some((f) => existsSync(join(root, f)));
  if (eslint && hasEslintConfig) {
    const res = await execa(eslint, ["-f", "unix", "--", target], { cwd: root, reject: false, timeout: 5 * 60_000, all: true });
    const errs = String(res.all ?? "").split("\n").filter((l) => /^.+:\d+:\d+: /.test(l));
    total += errs.length;
    sections.push(errs.length ? `ESLint — ${errs.length} problem${errs.length === 1 ? "" : "s"}:\n${errs.slice(0, 60).map((l) => "  " + l).join("\n")}` : "ESLint — no problems");
  }

  if (!sections.length) return "No local typechecker or linter found (looked for node_modules/.bin/tsc with tsconfig.json, and eslint with a config).";
  return `${total ? `❌ ${total} problem${total === 1 ? "" : "s"}` : "✅ Clean"}\n\n${sections.join("\n\n")}`;
}
