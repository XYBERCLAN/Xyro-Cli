// Live Provider Model Discovery Engine for XYRO
// Curls/fetches live models directly from provider endpoints (OpenAI-compatible /models),
// detects Free vs Pro/Paid tiers, tags coding specialists, and prioritizes Free & Coding models.

export interface DiscoveredModel {
  id: string;
  name: string;
  isFree: boolean;
  isCoding: boolean;
  badge: "FREE" | "PAID" | "LOCAL";
  desc: string;
}

const CODING_REGEX = /(code|coder|codestral|r1|reasoner|sonnet|opus|gpt-4o|qwen2\.5-coder|qwen-2\.5-coder|deepseek|instruct|starcoder|dev)/i;

export function classifyModel(
  modelId: string,
  modelName = "",
  providerId = "",
  pricing?: { prompt?: string | number; completion?: string | number }
): DiscoveredModel {
  const lowerId = modelId.toLowerCase();
  const lowerName = modelName.toLowerCase();
  const isLocal = providerId.toLowerCase() === "local" || lowerId.includes("local");

  // 1. Detect Free status
  let isFree = false;
  if (isLocal) {
    isFree = true;
  } else if (
    lowerId.includes(":free") ||
    lowerId.includes("-free") ||
    lowerId.includes("/free") ||
    lowerId.includes("kimi-k3-free") ||
    lowerId.includes("free")
  ) {
    isFree = true;
  } else if (pricing && (pricing.prompt === 0 || pricing.prompt === "0")) {
    isFree = true;
  } else if (
    providerId === "google" &&
    (lowerId.includes("flash") || lowerId.includes("gemini-2.5") || lowerId.includes("gemini-3.5"))
  ) {
    isFree = true;
  } else if (
    providerId === "groq" &&
    (lowerId.includes("qwen3.8") || lowerId.includes("qwen3.6") || lowerId.includes("compound"))
  ) {
    isFree = true;
  } else if (providerId === "github" && (lowerId.includes("gpt-4o-mini") || lowerId.includes("o3-mini"))) {
    isFree = true;
  }

  // 2. Detect Coding / Professional specialist
  const isCoding = CODING_REGEX.test(lowerId) || CODING_REGEX.test(lowerName);

  // 3. Determine badge
  let badge: "FREE" | "PAID" | "LOCAL" = "PAID";
  if (isLocal) {
    badge = "LOCAL";
  } else if (isFree) {
    badge = "FREE";
  }

  // 4. Determine concise description
  let desc = "General language model";
  if (isLocal && isCoding) {
    desc = "Local offline coding model";
  } else if (isLocal) {
    desc = "Local offline private model";
  } else if (isFree && isCoding) {
    desc = "Free professional coding agent";
  } else if (isFree) {
    desc = "Free tier community model";
  } else if (isCoding) {
    desc = "Pro coding & reasoning agent";
  }

  const cleanName = modelName && modelName !== modelId ? modelName : modelId;

  return {
    id: modelId,
    name: cleanName,
    isFree,
    isCoding,
    badge,
    desc,
  };
}

export function sortDiscoveredModels(models: DiscoveredModel[]): DiscoveredModel[] {
  return models.slice().sort((a, b) => {
    // 1. Free models always at the top
    if (a.isFree && !b.isFree) return -1;
    if (!a.isFree && b.isFree) return 1;

    // 2. Coding specialists first within their tier
    if (a.isCoding && !b.isCoding) return -1;
    if (!a.isCoding && b.isCoding) return 1;

    // 3. Alphabetical tie-breaker
    return a.id.localeCompare(b.id);
  });
}

export async function fetchLiveProviderModels(
  baseURL: string,
  apiKey?: string,
  providerId = "",
  fallbackIds: string[] = []
): Promise<DiscoveredModel[]> {
  const modelsMap = new Map<string, DiscoveredModel>();

  let cleanBase = baseURL.trim();
  if (cleanBase.endsWith("/")) cleanBase = cleanBase.slice(0, -1);
  const endpoint = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "XYRO-CLI/0.3.0",
  };
  if (apiKey && providerId !== "local") {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }
  if (providerId === "openrouter" || cleanBase.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/XYBERCLAN/Xyro-Cli";
    headers["X-Title"] = "XYRO CLI";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(endpoint, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const body = (await res.json()) as any;
      const rawList: any[] = Array.isArray(body)
        ? body
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.models)
            ? body.models
            : [];

      for (const item of rawList) {
        const id = typeof item === "string" ? item : item.id || item.name;
        if (!id || typeof id !== "string") continue;
        const name = item.name || id;
        const pricing = item.pricing;
        const model = classifyModel(id, name, providerId, pricing);
        modelsMap.set(id, model);
      }
    }
  } catch {
    // Network timeout or error — fallback smoothly
  }

  for (const fid of fallbackIds) {
    if (!modelsMap.has(fid)) {
      modelsMap.set(fid, classifyModel(fid, fid, providerId));
    }
  }

  const result = Array.from(modelsMap.values());
  return sortDiscoveredModels(result);
}
