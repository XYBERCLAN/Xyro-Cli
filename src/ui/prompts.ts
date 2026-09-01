import * as p from "@clack/prompts";
import pc from "picocolors";
import * as readline from "node:readline";


export interface ProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  baseURL: string;
  instructions: string;
}

export interface Provider {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
  baseURL: string;
  keyURL: string;
  steps: string[];
  limit: string;
  desc: string;
}

export const FREE_PROVIDERS: Provider[] = [
  // ===== AMERICAS =====
  {
    id: "google",
    name: "Google AI Studio (USA)",
    models: ["gemini-3.6-flash", "gemini-3.1-pro-preview"],
    defaultModel: "gemini-3.6-flash",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyURL: "https://aistudio.google.com/apikey",
    steps: [
      "Go to https://aistudio.google.com/apikey",
      "Click 'Get API Key' → 'Create API Key'",
      "Sign in with any Google account (no credit card)",
      "Copy the key and paste it below",
    ],
    limit: "1,500 req/day · 1M context",
    desc: "Best free tier — Gemini 2.5 Flash, 1M context",
  },
  {
    id: "groq",
    name: "Groq (USA)",
    models: ["llama-3.3-70b-versatile", "llama-4-scout-17b-16e-instruct", "mixtral-8x7b-32768"],
    defaultModel: "llama-3.3-70b-versatile",
    baseURL: "https://api.groq.com/openai/v1",
    keyURL: "https://console.groq.com/keys",
    steps: [
      "Go to https://console.groq.com/keys",
      "Sign up with email or GitHub (no credit card)",
      "Click 'Create API Key', give it a name",
      "Copy the key (starts with 'gsk_') and paste below",
    ],
    limit: "30 RPM · 14K req/day · 500+ tok/s",
    desc: "Blazing fast LPU chips — 500+ tok/s",
  },
  {
    id: "openrouter",
    name: "OpenRouter (USA)",
    models: ["openrouter/free", "deepseek/deepseek-v4-flash", "meta-llama/llama-3.3-70b-instruct:free"],
    defaultModel: "openrouter/free",
    baseURL: "https://openrouter.ai/api/v1",
    keyURL: "https://openrouter.ai/keys",
    steps: [
      "Go to https://openrouter.ai/keys",
      "Sign up with email or GitHub (no credit card)",
      "Click 'Create Key', set permissions",
      "Copy the key (starts with 'sk-or-') and paste below",
    ],
    limit: "200 req/day · 25+ free models",
    desc: "One key for 25+ free models",
  },
  {
    id: "github",
    name: "GitHub Models (USA)",
    models: ["gpt-4o", "o3-mini", "gpt-4.1"],
    defaultModel: "gpt-4o",
    baseURL: "https://models.inference.ai.azure.com",
    keyURL: "https://github.com/marketplace/models",
    steps: [
      "Go to https://github.com/marketplace/models",
      "Sign in with any GitHub account (free)",
      "Click 'Get API Key' in the playground",
      "Copy the GitHub PAT token and paste below",
    ],
    limit: "50-150 req/day · GPT-4o free!",
    desc: "GPT-4o, o3-mini for free with GitHub account",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM (USA)",
    models: ["deepseek-ai/deepseek-v4-flash", "meta/llama-4-scout", "nvidia/nemotron-3-ultra"],
    defaultModel: "deepseek-ai/deepseek-v4-flash",
    baseURL: "https://integrate.api.nvidia.com/v1",
    keyURL: "https://build.nvidia.com/",
    steps: [
      "Go to https://build.nvidia.com/",
      "Sign up with email (no credit card needed)",
      "Select a model → 'Get API Key'",
      "Copy the key and paste below",
    ],
    limit: "40 RPM · 100+ models",
    desc: "NVIDIA-hosted DeepSeek, Llama 4, Nemotron",
  },
  {
    id: "cerebras",
    name: "Cerebras (USA)",
    models: ["llama3.1-70b", "llama3.3-70b"],
    defaultModel: "llama3.3-70b",
    baseURL: "https://api.cerebras.ai/v1",
    keyURL: "https://cloud.cerebras.ai/",
    steps: [
      "Go to https://cloud.cerebras.ai/",
      "Sign up with email (no credit card)",
      "Go to API Keys section, create a key",
      "Copy the key and paste below",
    ],
    limit: "1M tok/day · ~2,100 tok/s",
    desc: "Ultra fast — 2100 tok/s, massive throughput",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI (USA)",
    models: ["@cf/meta/llama-3.3-70b-instruct", "@cf/qwen/qwen3-30b"],
    defaultModel: "@cf/meta/llama-3.3-70b-instruct",
    baseURL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    keyURL: "https://developers.cloudflare.com/workers-ai/",
    steps: [
      "Go to https://dash.cloudflare.com/",
      "Sign up with email, verify, add a site (free plan)",
      "Go to Workers & Pages → Workers AI → API Keys",
      "Copy your Account ID + API Token and paste below (format: ACCOUNT_ID:API_TOKEN)",
    ],
    limit: "100K neurons/day · edge-deployed",
    desc: "Global edge network — sub-100ms latency",
  },
  {
    id: "huggingface",
    name: "HuggingFace Inference (USA/France)",
    models: ["meta-llama/Llama-3.3-70B-Instruct", "microsoft/Phi-3-medium-128k-instruct"],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    baseURL: "https://api-inference.huggingface.co/v1",
    keyURL: "https://huggingface.co/settings/tokens",
    steps: [
      "Go to https://huggingface.co/settings/tokens",
      "Sign up with email (no credit card)",
      "Click 'New Token' → give it a name",
      "Copy the token (starts with 'hf_') and paste below",
    ],
    limit: "300+ models · varies by model",
    desc: "Largest model zoo — 300+ open models",
  },
  {
    id: "sambanova",
    name: "SambaNova Cloud (USA)",
    models: ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-405B-Instruct", "Qwen2.5-Coder-32B-Instruct"],
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    baseURL: "https://api.sambanova.ai/v1",
    keyURL: "https://cloud.sambanova.ai/",
    steps: [
      "Go to https://cloud.sambanova.ai/",
      "Sign up with email (no credit card needed)",
      "Get $5 free credits automatically",
      "Go to API Keys section, create a key, paste below",
    ],
    limit: "$5 free credits · fastest Llama 405B",
    desc: "World's fastest inference — Llama 405B free",
  },
  {
    id: "together",
    name: "Together AI (USA)",
    models: ["meta-llama/Llama-3.3-70B-Instruct", "mistralai/Mixtral-8x22B-Instruct"],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    baseURL: "https://api.together.xyz/v1",
    keyURL: "https://api.together.ai/",
    steps: [
      "Go to https://api.together.ai/",
      "Sign up with email or GitHub (no credit card)",
      "Go to Settings → API Keys → Create Key",
      "Copy the key (starts with 'together_') and paste below",
    ],
    limit: "$5 free credits · 100+ open models",
    desc: "100+ open models, $5 free on signup",
  },
  {
    id: "fireworks",
    name: "Fireworks AI (USA)",
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/qwen2p5-72b-instruct"],
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    baseURL: "https://api.fireworks.ai/inference/v1",
    keyURL: "https://fireworks.ai/",
    steps: [
      "Go to https://fireworks.ai/",
      "Sign up with email or GitHub",
      "Go to API Keys section → Create API Key",
      "Copy the key and paste below",
    ],
    limit: "Free tier · 600 RPM",
    desc: "Fast inference — powers Cursor, Vercel v0",
  },

  // ===== EUROPE =====
  {
    id: "mistral",
    name: "Mistral AI (France)",
    models: ["codestral-latest", "mistral-large-latest", "ministral-3b-latest"],
    defaultModel: "codestral-latest",
    baseURL: "https://api.mistral.ai/v1",
    keyURL: "https://console.mistral.ai/",
    steps: [
      "Go to https://console.mistral.ai/",
      "Sign up with email or GitHub",
      "Go to API Keys → 'Create new key'",
      "Copy the key (starts with 'c0de...') and paste below",
    ],
    limit: "1B tokens/month · Codestral",
    desc: "Best coding model — Codestral, Mistral Large",
  },
  {
    id: "ovhcloud",
    name: "OVHcloud AI Endpoints (France)",
    models: ["Qwen3.6-27B", "Mistral-7B-Instruct"],
    defaultModel: "Qwen3.6-27B",
    baseURL: "https://endpoints.ai.cloud.ovh.net/v1",
    keyURL: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/",
    steps: [
      "Go to https://www.ovhcloud.com/en/public-cloud/ai-endpoints/",
      "Sign up for OVHcloud account (email)",
      "Navigate to AI Endpoints → create credentials",
      "Copy the endpoint key and paste below",
    ],
    limit: "2 RPM anonymous · European servers",
    desc: "European cloud — Qwen, Mistral, GDPR-friendly",
  },
  {
    id: "cohere",
    name: "Cohere (Canada)",
    models: ["command-r-plus", "command-r"],
    defaultModel: "command-r-plus",
    baseURL: "https://api.cohere.com/v1",
    keyURL: "https://dashboard.cohere.com/",
    steps: [
      "Go to https://dashboard.cohere.com/",
      "Sign up with email (no credit card)",
      "API key auto-generated on signup",
      "Copy the trial key and paste below (1K calls/month free)",
    ],
    limit: "1K calls/month · RAG-focused",
    desc: "Best for RAG and embeddings",
  },
  {
    id: "nebius",
    name: "Nebius AI (Netherlands/Europe)",
    models: ["meta-llama/Meta-Llama-3.3-70B-Instruct", "Qwen/Qwen3-30B"],
    defaultModel: "meta-llama/Meta-Llama-3.3-70B-Instruct",
    baseURL: "https://api.studio.nebius.ai/v1",
    keyURL: "https://studio.nebius.ai/",
    steps: [
      "Go to https://studio.nebius.ai/",
      "Sign up with email or GitHub",
      "Get free credits on signup",
      "Go to API Keys section, create a key, paste below",
    ],
    limit: "Free credits on signup · European infra",
    desc: "European cloud AI — Llama, Qwen, EU-hosted",
  },

  // ===== ASIA / CHINA =====
  {
    id: "deepseek",
    name: "DeepSeek (China)",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    baseURL: "https://api.deepseek.com/v1",
    keyURL: "https://platform.deepseek.com/",
    steps: [
      "Go to https://platform.deepseek.com/",
      "Sign up with email (Chinese phone may be needed)",
      "Go to API Keys → Create API Key",
      "Copy the key and paste below",
    ],
    limit: "5M tokens free · strong coder",
    desc: "Chinese powerhouse — SWE-bench 80.6%",
  },
  {
    id: "zhipu",
    name: "Zhipu AI · BigModel (China)",
    models: ["glm-5.2", "glm-5.2[1m]", "glm-4.7-flash", "glm-4-flash"],
    defaultModel: "glm-5.2",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    keyURL: "https://open.bigmodel.cn/",
    steps: [
      "Go to https://open.bigmodel.cn/",
      "Register with Chinese phone number",
      "Go to API Keys → create a new key",
      "Copy the key and paste below (GLM-4.7-Flash is permanently free)",
    ],
    limit: "GLM-4.7-Flash永久免费 · 1M ctx (GLM-5.2)",
    desc: "清华系 — GLM-5.2旗舰 753B/1M ctx, 开源SOTA",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow · 硅基流动 (China)",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-30B", "Pro/deepseek-ai/DeepSeek-R1"],
    defaultModel: "deepseek-ai/DeepSeek-V3",
    baseURL: "https://api.siliconflow.cn/v1",
    keyURL: "https://cloud.siliconflow.cn/",
    steps: [
      "Go to https://cloud.siliconflow.cn/",
      "Register with Chinese phone number",
      "Go to API Keys → 'Create API Key'",
      "Copy the key and paste below (DeepSeek V3 is free)",
    ],
    limit: "20M tokens新用户 · 1000 RPM",
    desc: "DeepSeek V3, Qwen3, 200+模型, 低延迟",
  },
  {
    id: "qwen",
    name: "Alibaba Qwen · 百炼 (China)",
    models: ["qwen3.6-plus", "qwen-plus", "qwen-turbo"],
    defaultModel: "qwen3.6-plus",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyURL: "https://bailian.console.aliyun.com/",
    steps: [
      "Go to https://bailian.console.aliyun.com/",
      "Sign in with Alibaba Cloud account",
      "Open 'Model Studio' → create API Key",
      "Copy the key and paste below (70M free tokens)",
    ],
    limit: "70M tokens新用户 · Qwen3.6编程强",
    desc: "阿里系 — Qwen3.6接近Claude Sonnet, 1M上下文",
  },
  {
    id: "baidu",
    name: "Baidu Qianfan · 千帆 (China)",
    models: ["ernie-4.5-turbo-128k", "ernie-speed-128k", "ernie-4.0-8k"],
    defaultModel: "ernie-speed-128k",
    baseURL: "https://qianfan.baidubce.com/v2",
    keyURL: "https://console.bce.baidu.com/qianfan/",
    steps: [
      "Go to https://console.bce.baidu.com/qianfan/",
      "Sign in with Baidu account",
      "Access 'Model Inference' → create API Key",
      "Copy the key and paste below (ERNIE-Speed free)",
    ],
    limit: "ERNIE-Speed永久免费 · 中文理解顶尖",
    desc: "百度 — ERNIE-Speed永久免费",
  },
  {
    id: "hunyuan",
    name: "Tencent Hunyuan · 混元 (China)",
    models: ["hunyuan-lite", "hunyuan-standard", "hunyuan-turbo"],
    defaultModel: "hunyuan-lite",
    baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
    keyURL: "https://cloud.tencent.com/product/hunyuan",
    steps: [
      "Go to https://cloud.tencent.com/product/hunyuan",
      "Sign in with Tencent/WeChat account",
      "Click 'Activate' → go to API Keys",
      "Create key and paste below (Lite is free forever)",
    ],
    limit: "100M tokens共享 · Lite版永久免费",
    desc: "腾讯 — Lite永久免费, 1年100M tokens",
  },
  {
    id: "volcengine",
    name: "Volcengine Doubao · 豆包 (China)",
    models: ["doubao-lite-32k", "doubao-pro-32k"],
    defaultModel: "doubao-lite-32k",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    keyURL: "https://console.volcengine.com/ark/",
    steps: [
      "Go to https://console.volcengine.com/ark/",
      "Sign in with ByteDance account",
      "Go to 'Inference' → create API Key",
      "Copy the key and paste below (200M tokens/day!)",
    ],
    limit: "200M tokens/day · 字节跳动",
    desc: "字节跳动 — 每天200M tokens免费",
  },

  // ===== MIDDLE EAST / ISRAEL =====
  {
    id: "ai21",
    name: "AI21 Labs (Israel)",
    models: ["jamba-1.5-mini", "jamba-1.5-large"],
    defaultModel: "jamba-1.5-mini",
    baseURL: "https://api.ai21.com/studio/v1",
    keyURL: "https://studio.ai21.com/",
    steps: [
      "Go to https://studio.ai21.com/",
      "Sign up with email",
      "Get free trial credits",
      "Go to API Keys section, create a key, paste below",
    ],
    limit: "Free trial · Jamba models",
    desc: "Israeli AI — Jamba hybrid SSM-Transformer",
  },

  // ===== LOCAL =====
  {
    id: "local",
    name: "Ollama (local)",
    models: ["llama3.3", "qwen3", "deepseek-r1"],
    defaultModel: "llama3.3",
    baseURL: "http://localhost:11434/v1",
    keyURL: "https://ollama.com/download",
    steps: [
      "Install Ollama from https://ollama.com/download",
      "Run: ollama pull llama3.3",
      "Run: ollama serve",
      "No API key needed — just select a model below",
    ],
    limit: "Unlimited · runs on your machine",
    desc: "Fully local — no data leaves your computer",
  },
];

export interface Config {
  apiKey: string;
  model: string;
  baseURL: string;
  provider: string;
}

async function showProviderInstructions(provider: Provider): Promise<void> {
  console.log();
  console.log(`  ${pc.bold(pc.yellow("⚡ " + provider.name))}`);
  console.log(`  ${pc.dim(provider.limit)}`);
  console.log();

  console.log(`  ${pc.underline("Step-by-step:")}`);
  provider.steps.forEach((step, i) => {
    console.log(`  ${pc.yellow(String(i + 1))}. ${step}`);
  });
  console.log();
  console.log(`  ${pc.dim("URL: " + provider.keyURL)}`);
  console.log(`  ${pc.dim("Base URL: " + provider.baseURL)}`);
  console.log();
}

export async function interactiveSetup(): Promise<Config> {
  console.log(`  ${pc.dim("choose a free AI provider to get started")}`);
  console.log();

  const providerChoice = await p.select({
    message: "Select a free AI provider",
    options: FREE_PROVIDERS.map((prov) => ({
      value: prov.id,
      label: prov.name,
      hint: prov.desc,
    })),
  });

  if (p.isCancel(providerChoice)) {
    p.outro("Goodbye");
    process.exit(0);
  }

  const selected = FREE_PROVIDERS.find((p) => p.id === providerChoice)!;

  if (selected.id !== "local") {
    await showProviderInstructions(selected);

    const manualKey = await p.password({
      message: `Paste your ${selected.name} API key`,
      validate: (v) => {
        if (v.length < 3) return "That doesn't look like a valid key";
      },
    });

    if (p.isCancel(manualKey)) process.exit(0);

    const modelChoice = await p.select({
      message: "Select model",
      options: selected.models.map((m) => ({
        value: m,
        label: m,
      })),
    });

    if (p.isCancel(modelChoice)) process.exit(0);

    console.log();
    console.log(pc.green(`  ✓ ${selected.name} configured`));
    console.log(pc.dim(`  ${selected.limit}`));
    console.log();

    return {
      apiKey: manualKey as string,
      model: modelChoice as string,
      baseURL: selected.baseURL,
      provider: selected.name,
    };
  } else {
    await showProviderInstructions(selected);

    const modelChoice = await p.select({
      message: "Select local model",
      options: selected.models.map((m) => ({
        value: m,
        label: m,
      })),
    });

    if (p.isCancel(modelChoice)) process.exit(0);

    return {
      apiKey: "ollama",
      model: modelChoice as string,
      baseURL: selected.baseURL,
      provider: selected.name,
    };
  }
}

export const CANCEL = Symbol("cancel");

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

let stdinHandleClosed = false;

export async function askForInput(): Promise<string | typeof CANCEL> {
  if (!process.stdin.isTTY) {
    if (stdinHandleClosed) return CANCEL;
    stdinHandleClosed = true;
    return (await readAllStdin()).trim();
  }
  process.stdin.resume();

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "",
    });
    rl.on("SIGINT", () => {
      rl.close();
      resolve(CANCEL);
    });
    rl.question(`  ${pc.dim("┃")} `, (answer) => {
      rl.close();
      resolve(answer || "");
    });
  });
}

export async function confirmAction(label: string): Promise<boolean> {
  const result = await p.confirm({
    message: `Allow ${label}?`,
    initialValue: false,
  });
  return result === true;
}
