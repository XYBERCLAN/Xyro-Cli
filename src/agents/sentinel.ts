// Sentinel — the always-on patrol. After every turn it scans the files that
// turn changed for things that must never ship: leaked credentials, private
// keys, conflict markers, and .env files git would commit. Pure pattern
// matching — instant, free, no model call.

import { readFileSync, existsSync, statSync } from "node:fs";
import { relative, basename } from "node:path";
import { GitIgnoreMatcher } from "../tools/gitignore.js";

export interface SentinelFinding {
  file: string;
  line: number;
  kind: string;
  severity: "high" | "medium";
  excerpt: string;
}

const SECRET_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "OpenAI-style API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "Stripe secret key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { kind: "hard-coded secret", re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

const CONFLICT_RE = /^(?:<{7}|>{7}) |^={7}$/;

/** Hide the middle of a secret so the warning itself never leaks it. */
function mask(line: string): string {
  return line
    .trim()
    .slice(0, 120)
    .replace(/([A-Za-z0-9_\-]{6})[A-Za-z0-9_\-]{8,}([A-Za-z0-9_\-]{2})/g, "$1…$2");
}

export function scanText(file: string, text: string): SentinelFinding[] {
  const findings: SentinelFinding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(l) && !/example|placeholder|your[_-]?key|xxxx|<.*>|\$\{|process\.env|getenv/i.test(l)) {
        findings.push({ file, line: i + 1, kind: p.kind, severity: "high", excerpt: mask(l) });
        break;
      }
    }
    if (CONFLICT_RE.test(l)) findings.push({ file, line: i + 1, kind: "merge conflict marker", severity: "high", excerpt: l.slice(0, 40) });
  });
  return findings;
}

/** Scan the given absolute paths (skips binaries, huge and deleted files). */
export function scanFiles(paths: string[], root = process.cwd()): SentinelFinding[] {
  const findings: SentinelFinding[] = [];
  const matcher = new GitIgnoreMatcher(root);
  for (const abs of paths) {
    if (!existsSync(abs)) continue;
    const rel = relative(root, abs) || abs;
    try {
      if (statSync(abs).size > 1_000_000) continue;
      const text = readFileSync(abs, "utf-8");
      if (text.includes("\u0000")) continue; // binary
      findings.push(...scanText(rel, text));
      if (/^\.env(\.|$)/.test(basename(abs)) && !/\.(example|sample|template)$/.test(abs) && !matcher.isIgnored(rel)) {
        findings.push({ file: rel, line: 1, kind: ".env file not ignored by git", severity: "medium", excerpt: "add it to .gitignore before committing" });
      }
    } catch {
      // unreadable — skip
    }
  }
  return findings;
}
