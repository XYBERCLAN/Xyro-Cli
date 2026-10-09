// Skills from the web — find a skill online and install it in one step.
//
//   skill_find_online { query: "pdf forms" }      → candidate GitHub skills
//   skill_install     { source: "anthropics/skills/skills/pdf" }
//                     { source: "https://github.com/o/r/tree/main/skills/pdf" }
//
// A skill is text that steers the model, so installing one always asks for
// approval and shows what it says. Files are only downloaded from GitHub;
// scripts that come with a skill are saved, never run.

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";
import { workspaceRoot } from "../agent/workspace.js";
import { parseFrontmatter, discoverSkills, invalidateSkillCache } from "./skills-catalog.js";
import { webSearch } from "../tools/websearch.js";

const MAX_FILES = 15;
const MAX_FILE_BYTES = 100_000;
const TEXT_FILE = /\.(md|txt|py|js|mjs|ts|json|sh|ya?ml|toml|csv|html|css)$/i;
const TIMEOUT_MS = 15_000;

export interface GithubSource {
  owner: string;
  repo: string;
  ref?: string;
  path: string;
}

/** github.com URLs (tree/blob) or owner/repo[/path] → parts. */
export function parseGithubSource(source: string): GithubSource | null {
  const s = source.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const url = s.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?$/);
  if (url) return { owner: url[1], repo: url[2], ref: url[3], path: (url[4] ?? "").replace(/\/?SKILL\.md$/i, "") };
  const short = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(.+))?$/);
  if (short && !s.includes("://")) return { owner: short[1], repo: short[2], path: (short[3] ?? "").replace(/\/?SKILL\.md$/i, "") };
  return null;
}

function apiBase(): string {
  return (process.env.XYRO_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
}

async function get(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "User-Agent": "xyro-cli", Accept: "application/vnd.github+json" } });
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads only from GitHub (or the configured API host, for GitHub Enterprise / tests). */
function allowedDownload(u: string): boolean {
  try {
    const host = new URL(u).host;
    return host === "raw.githubusercontent.com" || host === new URL(apiBase()).host;
  } catch {
    return false;
  }
}

interface ContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  download_url: string | null;
}

export async function installSkill(args: { source: string; scope?: "user" | "project"; replace?: boolean }): Promise<string> {
  const src = parseGithubSource(args.source ?? "");
  if (!src) return "❌ skill_install: give a GitHub URL or owner/repo/path to a folder with a SKILL.md.";
  const q = src.ref ? `?ref=${encodeURIComponent(src.ref)}` : "";
  const res = await get(`${apiBase()}/repos/${src.owner}/${src.repo}/contents/${src.path.split("/").map(encodeURIComponent).join("/")}${q}`);
  if (!res.ok) return `❌ skill_install: GitHub answered ${res.status} for ${src.owner}/${src.repo}/${src.path}.`;
  const listing = (await res.json()) as ContentItem | ContentItem[];
  const items = (Array.isArray(listing) ? listing : [listing]).filter((i) => i.type === "file" && i.download_url && TEXT_FILE.test(i.name) && i.size <= MAX_FILE_BYTES);
  const skillFile = items.find((i) => i.name.toLowerCase() === "skill.md");
  if (!skillFile) return `❌ skill_install: no SKILL.md in ${src.owner}/${src.repo}/${src.path || "(root)"}.`;

  const files: { name: string; text: string }[] = [];
  for (const item of [skillFile, ...items.filter((i) => i !== skillFile)].slice(0, MAX_FILES)) {
    if (!allowedDownload(item.download_url!)) return `❌ skill_install: refused to download from ${item.download_url}.`;
    const r = await get(item.download_url!);
    if (r.ok) files.push({ name: item.name, text: await r.text() });
  }
  const skillText = files[0]?.text ?? "";
  const { fields, body } = parseFrontmatter(skillText);
  const name = (fields.name || src.path.split("/").pop() || src.repo).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (!fields.description) return "❌ skill_install: the SKILL.md has no description in its frontmatter, so XYRO could not match it to tasks.";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return `❌ skill_install: unusable skill name "${name}".`;
  if (!args.replace && discoverSkills().some((s) => s.name === name)) return `❌ A skill named "${name}" is already installed. Pass replace: true to overwrite it.`;

  const base = args.scope === "project" ? join(workspaceRoot(), ".xyro", "skills") : join(getConfigDir(), "skills");
  const dir = join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(join(dir, f.name === files[0].name ? "SKILL.md" : f.name.replace(/[^\w.-]/g, "_")), f.text);
  invalidateSkillCache();

  const preview = body.trim().split("\n").slice(0, 12).join("\n");
  return `✅ Installed skill "${name}" (${args.scope === "project" ? "this project" : "all your projects"}) from ${src.owner}/${src.repo}${src.path ? `/${src.path}` : ""}\n${fields.description}\nFiles: ${files.map((f) => f.name).join(", ")}\n\nIt says:\n${preview}${body.split("\n").length > 12 ? "\n…" : ""}`;
}

/** Find candidate skills on the web (GitHub repositories with a SKILL.md). */
export async function findSkillsOnline(args: { query: string }): Promise<string> {
  const q = (args.query ?? "").trim();
  if (!q) return "❌ skill_find_online: `query` is required.";
  const out = await webSearch({ query: `${q} SKILL.md agent skill site:github.com`, max_results: 8 });
  return out.startsWith("❌") || out.startsWith("No results") ? out : `${out}\n\nInstall one with skill_install { source: "<github url of the skill folder>" }.`;
}
