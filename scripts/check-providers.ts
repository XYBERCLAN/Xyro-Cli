// Provider health check: does every built-in provider still answer at its
// address, and do the default models still exist where the list is public?
// Run weekly by .github/workflows/provider-health.yml (also: npx tsx scripts/check-providers.ts).
// Exit code 1 and a report on stdout when something needs updating in src/ui/prompts.ts.

import { FREE_PROVIDERS } from "../src/ui/prompts.js";

// Providers that publish their model list without a key
const PUBLIC_LISTS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/models",
  nvidia: "https://integrate.api.nvidia.com/v1/models",
  sambanova: "https://api.sambanova.ai/v1/models",
  huggingface: "https://router.huggingface.co/v1/models",
};
// Answers from far away can be slow or geo-blocked; these are reported but never fail the check
const BEST_EFFORT = new Set(["siliconflow", "baidu", "volcengine", "zhipu", "qwen", "hunyuan"]);

async function get(url: string, auth = false): Promise<{ status: number; body: string } | { error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: auth ? { Authorization: "Bearer xyro-health-check" } : {} });
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    return { error: cause ?? (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

const problems: string[] = [];
const notes: string[] = [];

for (const p of FREE_PROVIDERS) {
  if (!p.baseURL || p.baseURL.includes("{") || p.id === "local") continue;
  const r = await get(`${p.baseURL.replace(/\/+$/, "")}/models`, true);
  const bad =
    "error" in r ? `unreachable (${r.error})` : r.status === 404 ? "endpoint not found (404)" : /^\s*</.test(r.body) ? `answers with a web page, not an API (HTTP ${r.status})` : "";
  if (bad) (BEST_EFFORT.has(p.id) ? notes : problems).push(`${p.name} — ${p.baseURL}: ${bad}`);
}

for (const [id, url] of Object.entries(PUBLIC_LISTS)) {
  const p = FREE_PROVIDERS.find((x) => x.id === id);
  if (!p) continue;
  const r = await get(url);
  if ("error" in r || r.status !== 200) {
    notes.push(`${p.name}: could not read its public model list`);
    continue;
  }
  const full = await (await fetch(url)).json();
  const live = new Set(((Array.isArray(full) ? full : full.data) as { id: string }[]).map((m) => m.id));
  const missing = [p.defaultModel, ...(p.models ?? [])].filter((m, i, a) => a.indexOf(m) === i && !live.has(m));
  if (missing.includes(p.defaultModel)) problems.push(`${p.name}: default model ${p.defaultModel} no longer exists`);
  const listed = missing.filter((m) => m !== p.defaultModel);
  if (listed.length) problems.push(`${p.name}: listed models no longer exist: ${listed.join(", ")}`);
}

if (problems.length) {
  console.log(`## Providers that need updating (src/ui/prompts.ts)\n\n${problems.map((x) => `- ${x}`).join("\n")}`);
  if (notes.length) console.log(`\n### Also noticed (not blocking)\n\n${notes.map((x) => `- ${x}`).join("\n")}`);
  process.exit(1);
}
console.log(`All ${FREE_PROVIDERS.length} providers OK.${notes.length ? `\nNot blocking:\n${notes.map((x) => `- ${x}`).join("\n")}` : ""}`);
