// web_search — find pages, not just fetch a known URL. Works with no setup
// (DuckDuckGo HTML) and upgrades automatically when a search key is present:
//   TAVILY_API_KEY · BRAVE_SEARCH_API_KEY · SEARXNG_URL (your own instance)

import { redactText } from "../providers/privacy.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (XYRO CLI)", ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Parse DuckDuckGo's HTML results page. */
export function parseDuckDuckGo(html: string, max: number): SearchResult[] {
  const out: SearchResult[] = [];
  const blocks = html.split(/class="result(?:\s|__body|")/).slice(1);
  for (const b of blocks) {
    const link = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url = link[1].replace(/&amp;/g, "&");
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (/duckduckgo\.com\/y\.js|ad_domain/.test(url)) continue; // ads
    const snip = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: decode(link[2]), url, snippet: snip ? decode(snip[1]) : "" });
    if (out.length >= max) break;
  }
  return out;
}

async function search(query: string, max: number): Promise<{ engine: string; results: SearchResult[] }> {
  if (process.env.TAVILY_API_KEY) {
    const res = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: max }),
    });
    const j = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return { engine: "Tavily", results: (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 300) ?? "" })) };
  }
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const res = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?count=${max}&q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY },
    });
    const j = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
    return { engine: "Brave", results: (j.web?.results ?? []).slice(0, max).map((r) => ({ title: decode(r.title), url: r.url, snippet: decode(r.description ?? "") })) };
  }
  if (process.env.SEARXNG_URL) {
    const res = await fetchWithTimeout(`${process.env.SEARXNG_URL.replace(/\/$/, "")}/search?format=json&q=${encodeURIComponent(query)}`);
    const j = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return { engine: "SearXNG", results: (j.results ?? []).slice(0, max).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" })) };
  }
  const res = await fetchWithTimeout("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `q=${encodeURIComponent(query)}`,
  });
  return { engine: "DuckDuckGo", results: parseDuckDuckGo(await res.text(), max) };
}

export async function webSearch(args: { query: string; max_results?: number }): Promise<string> {
  // Search engines are third parties: never send secrets or personal data in a query
  const query = redactText((args.query || "").trim()).replace(/\[\[XYRO_[A-Z]+_\d+\]\]/g, "").replace(/\s+/g, " ").trim();
  if (!query) return "❌ web_search: `query` is required.";
  const max = Math.max(1, Math.min(args.max_results ?? 6, 12));
  try {
    const { engine, results } = await search(query, max);
    if (!results.length) return `No results for "${query}" (${engine}). Try different words, or fetch_url a known page.`;
    return `${engine} results for "${query}":\n\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 280)}` : ""}`).join("\n\n")}\n\nUse fetch_url on the most relevant link to read it.`;
  } catch (e) {
    return `❌ web_search failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
