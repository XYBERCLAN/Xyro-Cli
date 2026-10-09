// Update checks and in-agent updates.
//
// checkForUpdate(): asks the npm registry for the latest published version.
// Never blocks start-up: 3s timeout, result cached for 12h, silent on errors,
// skipped in CI or with XYRO_NO_UPDATE_CHECK=1.
//
// performUpdate(): installs the latest version the same way XYRO was
// installed (npm global). From a git checkout it explains how to pull instead.

import * as fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { getConfigDir } from "../config/platform.js";
import { xyroVersion, compareVersions } from "../version.js";

export const PACKAGE_NAME = "xyro-cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface CheckCache {
  checkedAt: number;
  latest: string;
}

function cachePath(): string {
  return join(getConfigDir(), "update-check.json");
}

function readCache(): CheckCache | null {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(), "utf-8")) as CheckCache;
    return typeof c.latest === "string" && typeof c.checkedAt === "number" ? c : null;
  } catch {
    return null;
  }
}

function writeCache(c: CheckCache): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(c), "utf-8");
  } catch {
    // best effort
  }
}

export function updateChecksDisabled(): boolean {
  return Boolean(process.env.XYRO_NO_UPDATE_CHECK || process.env.CI);
}

/** Latest published version from npm (null when offline or unknown). */
export async function fetchLatestVersion(timeoutMs = 3000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(REGISTRY_URL, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Compare the running version with npm, using a 12h cache unless `force`. */
export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!opts.force && updateChecksDisabled()) return null;
  const current = xyroVersion();
  const cached = readCache();
  let latest = !opts.force && cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS ? cached.latest : null;
  if (!latest) {
    latest = await fetchLatestVersion();
    if (!latest) return null;
    writeCache({ checkedAt: Date.now(), latest });
  }
  return { current, latest, updateAvailable: compareVersions(current, latest) < 0 };
}

export type InstallMethod = "npm-global" | "source" | "npx";

/** How this copy of XYRO was installed, judged from where it runs. */
export function installMethod(): InstallMethod {
  const here = fileURLToPath(import.meta.url);
  if (here.includes("/_npx/") || here.includes("/.npm/_npx/")) return "npx";
  if (here.includes(`node_modules/${PACKAGE_NAME}/`) || here.includes(`node_modules\\${PACKAGE_NAME}\\`)) return "npm-global";
  return "source";
}

export interface UpdateResult {
  ok: boolean;
  message: string;
}

/** Install `version` (default: latest) and report what happened. */
export async function performUpdate(version?: string): Promise<UpdateResult> {
  const method = installMethod();
  if (method === "source") {
    return {
      ok: false,
      message: "This XYRO runs from a source checkout. Update it with: git pull && npm install && npm run build",
    };
  }
  if (method === "npx") {
    return { ok: true, message: `npx always runs the newest version — just start it again with: npx ${PACKAGE_NAME}@latest` };
  }
  const target = `${PACKAGE_NAME}@${version || "latest"}`;
  try {
    const res = await execa("npm", ["install", "-g", target], { timeout: 5 * 60_000, reject: false, all: true });
    if (res.exitCode === 0) {
      return { ok: true, message: `Installed ${target}. Restart XYRO to start using it.` };
    }
    const out = String(res.all || res.stderr || "");
    if (/EACCES|permission denied/i.test(out)) {
      return {
        ok: false,
        message: `npm could not write to its global folder (permission denied). Run: sudo npm install -g ${target}  — or set an npm prefix you own.`,
      };
    }
    const last = out.trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300);
    return { ok: false, message: `npm install failed (exit ${res.exitCode}). ${last}` };
  } catch (err) {
    return { ok: false, message: `Could not run npm: ${err instanceof Error ? err.message : String(err)}` };
  }
}
