// Model catalog for XYRO: detailed model registry with provider info and Free/Paid status

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  isFree: boolean;
  badge: "FREE" | "PAID" | "LOCAL";
  desc: string;
  baseURL?: string;
}

export const DEFAULT_MODELS: ModelEntry[] = [
  // ─── Google AI Studio (Free Tier) ──────────────────────────────────────────
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google AI Studio",
    providerId: "google",
    isFree: true,
    badge: "FREE",
    desc: "1M ctx · 1,500 req/day free quota",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google AI Studio",
    providerId: "google",
    isFree: true,
    badge: "FREE",
    desc: "2M ctx · Advanced reasoning & coding",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "Google AI Studio",
    providerId: "google",
    isFree: true,
    badge: "FREE",
    desc: "Next-gen high speed experimental",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  },

  // ─── OpenRouter (Free Community Models) ────────────────────────────────────
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B (Free)",
    provider: "OpenRouter",
    providerId: "openrouter",
    isFree: true,
    badge: "FREE",
    desc: "Meta 70B open weights via OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1 (Free)",
    provider: "OpenRouter",
    providerId: "openrouter",
    isFree: true,
    badge: "FREE",
    desc: "DeepSeek R1 reasoning specialist",
    baseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek/deepseek-chat:free",
    name: "DeepSeek V3 (Free)",
    provider: "OpenRouter",
    providerId: "openrouter",
    isFree: true,
    badge: "FREE",
    desc: "DeepSeek V3 671B MoE architecture",
    baseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct:free",
    name: "Qwen 2.5 Coder 32B",
    provider: "OpenRouter",
    providerId: "openrouter",
    isFree: true,
    badge: "FREE",
    desc: "High-accuracy open code model",
    baseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "mistralai/mistral-small-24b-instruct-2501:free",
    name: "Mistral Small 24B",
    provider: "OpenRouter",
    providerId: "openrouter",
    isFree: true,
    badge: "FREE",
    desc: "Lightweight European coding model",
    baseURL: "https://openrouter.ai/api/v1",
  },

  // ─── TokenRouter (Multi-Model AI Router) ──────────────────────────────────
  {
    id: "moonshotai/kimi-k3-free",
    name: "Kimi K3 (Free)",
    provider: "TokenRouter",
    providerId: "tokenrouter",
    isFree: true,
    badge: "FREE",
    desc: "Long-context reasoning & coding via TokenRouter",
    baseURL: "https://api.tokenrouter.com/v1",
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1 (Free)",
    provider: "TokenRouter",
    providerId: "tokenrouter",
    isFree: true,
    badge: "FREE",
    desc: "DeepSeek R1 reasoning specialist via TokenRouter",
    baseURL: "https://api.tokenrouter.com/v1",
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B",
    provider: "TokenRouter",
    providerId: "tokenrouter",
    isFree: false,
    badge: "PAID",
    desc: "Top-tier open coding model routed via TokenRouter",
    baseURL: "https://api.tokenrouter.com/v1",
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "TokenRouter",
    providerId: "tokenrouter",
    isFree: false,
    badge: "PAID",
    desc: "State-of-the-art coding agent via TokenRouter",
    baseURL: "https://api.tokenrouter.com/v1",
  },

  // ─── Groq (Ultra-fast LPU Inference) ───────────────────────────────────────
  {
    id: "qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B",
    provider: "Groq",
    providerId: "groq",
    isFree: true,
    badge: "FREE",
    desc: "500+ tok/s ultra-fast LPU inference",
    baseURL: "https://api.groq.com/openai/v1",
  },
  {
    id: "groq/compound",
    name: "Groq Compound",
    provider: "Groq",
    providerId: "groq",
    isFree: true,
    badge: "FREE",
    desc: "Compound fast model routing",
    baseURL: "https://api.groq.com/openai/v1",
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    provider: "Groq",
    providerId: "groq",
    isFree: true,
    badge: "FREE",
    desc: "Llama 3.3 at ultra-high throughput",
    baseURL: "https://api.groq.com/openai/v1",
  },

  // ─── GitHub Models (Free with GitHub PAT) ──────────────────────────────────
  {
    id: "gpt-4o",
    name: "GPT-4o (GitHub)",
    provider: "GitHub Models",
    providerId: "github",
    isFree: true,
    badge: "FREE",
    desc: "Free GPT-4o with any GitHub PAT",
    baseURL: "https://models.inference.ai.azure.com",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini (GitHub)",
    provider: "GitHub Models",
    providerId: "github",
    isFree: true,
    badge: "FREE",
    desc: "Fast multimodal with GitHub PAT",
    baseURL: "https://models.inference.ai.azure.com",
  },

  // ─── Cerebras (Speed Record) ───────────────────────────────────────────────
  {
    id: "llama3.3-70b",
    name: "Llama 3.3 70B (Cerebras)",
    provider: "Cerebras",
    providerId: "cerebras",
    isFree: true,
    badge: "FREE",
    desc: "World-record 2,100 tok/s speed",
    baseURL: "https://api.cerebras.ai/v1",
  },

  // ─── Mistral AI ────────────────────────────────────────────────────────────
  {
    id: "codestral-latest",
    name: "Codestral Latest",
    provider: "Mistral AI",
    providerId: "mistral",
    isFree: true,
    badge: "FREE",
    desc: "1B tok/month free tier for coding",
    baseURL: "https://api.mistral.ai/v1",
  },

  // ─── Anthropic Claude (Paid / Direct API) ──────────────────────────────────
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    providerId: "anthropic",
    isFree: false,
    badge: "PAID",
    desc: "Industry-leading agent intelligence",
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    providerId: "anthropic",
    isFree: false,
    badge: "PAID",
    desc: "Fast, highly intelligent & responsive",
  },
  {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
    provider: "Anthropic",
    providerId: "anthropic",
    isFree: false,
    badge: "PAID",
    desc: "Deep analysis & complex planning",
  },

  // ─── OpenAI (Paid / Direct API) ────────────────────────────────────────────
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    providerId: "openai",
    isFree: false,
    badge: "PAID",
    desc: "Flagship multimodal omni model",
    baseURL: "https://api.openai.com/v1",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    providerId: "openai",
    isFree: false,
    badge: "PAID",
    desc: "Fast, affordable intelligence",
    baseURL: "https://api.openai.com/v1",
  },
  {
    id: "o3-mini",
    name: "o3-mini",
    provider: "OpenAI",
    providerId: "openai",
    isFree: false,
    badge: "PAID",
    desc: "Advanced STEM & coding reasoning",
    baseURL: "https://api.openai.com/v1",
  },
  {
    id: "o1",
    name: "o1",
    provider: "OpenAI",
    providerId: "openai",
    isFree: false,
    badge: "PAID",
    desc: "Deep step-by-step reasoning",
    baseURL: "https://api.openai.com/v1",
  },

  // ─── DeepSeek Direct ───────────────────────────────────────────────────────
  {
    id: "deepseek-chat",
    name: "DeepSeek-V3",
    provider: "DeepSeek",
    providerId: "deepseek",
    isFree: false,
    badge: "PAID",
    desc: "Direct DeepSeek V3 API (ultra-low cost)",
    baseURL: "https://api.deepseek.com/v1",
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek-R1",
    provider: "DeepSeek",
    providerId: "deepseek",
    isFree: false,
    badge: "PAID",
    desc: "Direct DeepSeek R1 reasoning API",
    baseURL: "https://api.deepseek.com/v1",
  },

  // ─── Local Ollama ──────────────────────────────────────────────────────────
  {
    id: "qwen2.5-coder:latest",
    name: "Qwen 2.5 Coder (Local)",
    provider: "Ollama (Local)",
    providerId: "ollama",
    isFree: true,
    badge: "LOCAL",
    desc: "Offline private local inference",
    baseURL: "http://localhost:11434/v1",
  },
  {
    id: "llama3.3:latest",
    name: "Llama 3.3 (Local)",
    provider: "Ollama (Local)",
    providerId: "ollama",
    isFree: true,
    badge: "LOCAL",
    desc: "Offline private local inference",
    baseURL: "http://localhost:11434/v1",
  },
];

export const DISCOVERED_MODELS: ModelEntry[] = [];

export function registerDiscoveredModels(models: ModelEntry[]): void {
  for (const m of models) {
    // Key by (providerId + id) so the same model id can exist under multiple providers
    const idx = DISCOVERED_MODELS.findIndex(
      (existing) => existing.id === m.id && existing.providerId === m.providerId
    );
    if (idx >= 0) {
      DISCOVERED_MODELS[idx] = m;
    } else {
      DISCOVERED_MODELS.push(m);
    }
  }
}

export function getAllModels(): ModelEntry[] {
  // Key by (providerId + id) so identical model ids from different providers are both kept
  const keys = new Set<string>();
  const combined: ModelEntry[] = [];
  // Discovered models take precedence within the same provider
  for (const m of DISCOVERED_MODELS) {
    const k = `${m.providerId}::${m.id}`;
    keys.add(k);
    combined.push(m);
  }
  for (const m of DEFAULT_MODELS) {
    const k = `${m.providerId}::${m.id}`;
    if (!keys.has(k)) {
      keys.add(k);
      combined.push(m);
    }
  }
  return combined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sectioned catalog: models grouped by provider, FREE providers separated from
// PAID providers, with an optional RECENTLY USED section at the very top.
// ─────────────────────────────────────────────────────────────────────────────

export type SectionKind = "RECENT" | "FREE" | "PAID";

export interface ProviderGroup {
  provider: string;
  providerId: string;
  models: ModelEntry[];
}

export interface ModelSection {
  kind: SectionKind;
  title: string;
  groups: ProviderGroup[];
  total: number;
}

export function buildModelSections(
  models: ModelEntry[],
  recentIds: string[] = []
): ModelSection[] {
  const recents = new Set(recentIds);

  const recentModels: ModelEntry[] = [];
  const freeModels: ModelEntry[] = [];
  const paidModels: ModelEntry[] = [];

  for (const m of models) {
    if (recents.has(m.id)) {
      recentModels.push(m);
    } else if (m.badge === "LOCAL" || m.isFree) {
      freeModels.push(m);
    } else {
      paidModels.push(m);
    }
  }

  // Most-recently-used first (order of recentIds)
  recentModels.sort((a, b) => {
    const ai = recentIds.indexOf(a.id);
    const bi = recentIds.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });

  const groupBy = (list: ModelEntry[]): ProviderGroup[] => {
    const order: string[] = [];
    const map = new Map<string, ProviderGroup>();
    for (const m of list) {
      if (!map.has(m.providerId)) {
        map.set(m.providerId, { provider: m.provider, providerId: m.providerId, models: [] });
        order.push(m.providerId);
      }
      map.get(m.providerId)!.models.push(m);
    }
    return order.map((pid) => map.get(pid)!);
  };

  const sections: ModelSection[] = [];
  if (recentModels.length > 0) {
    sections.push({
      kind: "RECENT",
      title: "RECENTLY USED",
      groups: groupBy(recentModels),
      total: recentModels.length,
    });
  }
  if (freeModels.length > 0) {
    sections.push({
      kind: "FREE",
      title: "FREE PROVIDERS & MODELS",
      groups: groupBy(freeModels),
      total: freeModels.length,
    });
  }
  if (paidModels.length > 0) {
    sections.push({
      kind: "PAID",
      title: "PAID / PRO PROVIDERS & MODELS",
      groups: groupBy(paidModels),
      total: paidModels.length,
    });
  }

  return sections;
}

export function filterModelCatalog(query: string, models?: ModelEntry[]): ModelEntry[] {
  const source = models || getAllModels();
  // Every word must match; "free" / "paid" / "local" act as tier filters
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return source;
  return source.filter((m) => {
    const hay = `${m.id} ${m.name} ${m.provider} ${m.providerId} ${m.desc}`.toLowerCase();
    return words.every((w) => {
      if (w === "free") return m.isFree || m.badge === "LOCAL";
      if (w === "paid") return !m.isFree && m.badge !== "LOCAL";
      if (w === "local") return m.badge === "LOCAL";
      return hay.includes(w);
    });
  });
}
