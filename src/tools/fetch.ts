/**
 * Web fetch tool: fetches URL content, strips HTML markup into clean text,
 * and formats JSON or markdown cleanly for LLM consumption.
 */

const DEFAULT_MAX_LENGTH = 6000;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * SSRF guard: refuse requests to localhost, loopback, link-local, and private
 * address ranges. This prevents an agent (or a prompt-injection via fetched
 * content) from probing internal services, cloud metadata endpoints, or the
 * user's own network.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Hostnames
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local")
  ) {
    return true;
  }

  // IP literal
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a >= 255) return false;
    // 0.x.x.x, 10.x.x.x, 127.x.x.x, 169.254.x.x, 172.16-31.x.x, 192.168.x.x, 198.18-19.x.x
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  // IPv6 loopback/link-local/unique-local
  if (h.startsWith("::") || h.startsWith("fd") || h.startsWith("fc") || h.startsWith("fe80")) {
    return true;
  }

  return false;
}

/**
 * Strip HTML tags and convert common structures into readable plain text.
 */
export function htmlToText(html: string): string {
  let text = html;

  // Remove scripts, styles, SVG, noscript
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert headings
  text = text.replace(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/gi, "\n\n# $1\n");
  text = text.replace(/<h[3-4][^>]*>(.*?)<\/h[3-4]>/gi, "\n\n## $1\n");
  text = text.replace(/<h[5-6][^>]*>(.*?)<\/h[5-6]>/gi, "\n\n### $1\n");

  // Convert list items
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, "\n- $1");

  // Convert paragraphs and line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<p[^>]*>/gi, "\n\n");
  text = text.replace(/<\/p>/gi, "");
  text = text.replace(/<div[^>]*>/gi, "\n");
  text = text.replace(/<\/div>/gi, "");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");

  // Collapse excess whitespace and empty lines
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();

  return text;
}

/**
 * Fetch and extract text content from a web URL.
 */
export async function fetchUrl(args: { url: string; maxLength?: number }): Promise<string> {
  const { url } = args;
  const maxLength = args.maxLength || DEFAULT_MAX_LENGTH;

  if (!url || typeof url !== "string") {
    return "❌ Error: A valid URL is required";
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return "❌ Error: Only HTTP and HTTPS URLs are supported";
    }
  } catch {
    return `❌ Error: Invalid URL format '${url}'`;
  }

  // SSRF guard: block internal/private targets before any connection attempt
  if (isPrivateHost(parsedUrl.hostname)) {
    return `❌ Error: URL host '${parsedUrl.hostname}' is blocked (private/internal address)`;
  }

  // GitHub repository special handling: if URL is https://github.com/:owner/:repo (with optional /)
  // Try fetching raw README directly first for maximum precision
  const ghMatch = parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (parsedUrl.hostname === "github.com" && ghMatch) {
    const owner = ghMatch[1];
    const repo = ghMatch[2].replace(/\.git$/, "");
    if (owner !== "orgs" && owner !== "settings") {
      for (const branch of ["main", "master"]) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
          const rawRes = await fetch(rawUrl, {
            headers: { "User-Agent": "XYRO-Agent/1.0" },
            signal: AbortSignal.timeout(5_000),
          });
          if (rawRes.ok) {
            const readme = await rawRes.text();
            const output = `[GitHub Repository: ${owner}/${repo} (README.md)]\n\n${readme}`;
            if (output.length > maxLength) {
              return `${output.slice(0, maxLength)}\n\n... (content truncated, showing first ${maxLength} characters)`;
            }
            return output;
          }
        } catch {
          // Fall back to fetching standard page
        }
      }
    }
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 XYRO-Agent/1.0",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!res.ok) {
      return `❌ Failed to fetch ${url} (HTTP ${res.status} ${res.statusText})`;
    }

    const contentType = res.headers.get("content-type") || "";
    const rawBody = await res.text();

    let cleanContent: string;
    if (contentType.includes("application/json")) {
      try {
        cleanContent = JSON.stringify(JSON.parse(rawBody), null, 2);
      } catch {
        cleanContent = rawBody;
      }
    } else if (contentType.includes("text/html")) {
      cleanContent = htmlToText(rawBody);
    } else {
      cleanContent = rawBody;
    }

    if (!cleanContent.trim()) {
      return `(Fetched ${url} successfully, but page had no readable text content)`;
    }

    if (cleanContent.length > maxLength) {
      return `${cleanContent.slice(0, maxLength)}\n\n... (content truncated, showing first ${maxLength} characters)`;
    }

    return cleanContent;
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === "TimeoutError" || err.message.includes("timeout")) {
        return `❌ Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`;
      }
      return `❌ Error fetching URL: ${err.message}`;
    }
    return "❌ Unknown error fetching URL";
  }
}
