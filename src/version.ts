// Single source of truth for XYRO's version: package.json.
// Works from src/ (tsx) and dist/ (built) alike — both sit one level below it.

import { readFileSync } from "node:fs";

let cached: string | null = null;

export function xyroVersion(): string {
  if (cached) return cached;
  try {
    cached = String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version || "0.0.0");
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

/**
 * Compare two semver strings ("1.4.0", "1.5.0-beta.2").
 * Returns < 0 when a is older than b, 0 when equal, > 0 when newer.
 * A pre-release sorts before its release (1.5.0-beta < 1.5.0).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ""] = v.trim().replace(/^v/, "").split("-", 2);
    const nums = core.split(".").map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] - B.nums[i];
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre.localeCompare(B.pre, undefined, { numeric: true });
}
