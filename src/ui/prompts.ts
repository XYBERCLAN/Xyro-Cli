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
    models: [
      "gemini-3.5-flash",
      "gemini-3.5-pro",
      "gemini-3.1-pro",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-flash-latest",
    ],
    defaultModel: "gemini-2.5-flash",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyURL: "https://aistudio.google.com/apikey",
    steps: [
      "Go to https://aistudio.google.com/apikey",
      "Click 'Get API Key' → 'Create API Key'",
      "Sign in with any Google account (no credit card)",
      "Copy the key (starts with 'AIzaSy...') and paste below",
    ],
    limit: "1,500 req/day · 1M context",
    desc: "Best free tier — Gemini 3.5 Flash, 1M context",
  },
  {
    id: "groq",
    name: "Groq (USA)",
    models: [
      "qwen/qwen3.8-27b",
      "qwen/qwen3.6-27b",
      "groq/compound",
      "groq/compound-mini",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ],
    defaultModel: "qwen/qwen3.8-27b",
    baseURL: "https://api.groq.com/openai/v1",
    keyURL: "https://console.groq.com/keys",
    steps: [
      "Go to https://console.groq.com/keys",
      "Sign up with email or GitHub (no credit card)",
      "Click 'Create API Key', give it a name",
      "Copy the key (starts with 'gsk_') and paste below",
    ],
    limit: "500+ tok/s · Qwen3, Compound AI",
    desc: "Blazing fast LPU chips — Qwen3, Compound",
  },
  {
    id: "openrouter",
    name: "OpenRouter (USA)",
    models: [
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "deepseek/deepseek-r1:free",
      "deepseek/deepseek-chat:free",
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "mistralai/mistral-small-24b-instruct-2501:free",
    ],
    defaultModel: "google/gemini-2.0-flash-exp:free",
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
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    defaultModel: "gpt-4o-mini",
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
    models: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1", "nvidia/llama-3.1-nemotron-70b-instruct"],
    defaultModel: "meta/llama-3.3-70b-instruct",
    baseURL: "https://integrate.api.nvidia.com/v1",
    keyURL: "https://build.nvidia.com/",
    steps: [
      "Go to https://build.nvidia.com/",
      "Sign up with email (no credit card needed)",
      "Select a model → 'Get API Key'",
      "Copy the key and paste below",
    ],
    limit: "40 RPM · 100+ models",
    desc: "NVIDIA-hosted DeepSeek, Llama 3.3, Nemotron",
  },
  {
    id: "cerebras",
    name: "Cerebras (USA)",
    models: ["llama3.3-70b", "llama3.1-8b"],
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
    models: ["@cf/meta/llama-3.3-70b-instruct", "@cf/qwen/qwen2.5-72b-instruct"],
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
    models: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-Coder-32B-Instruct"],
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
    models: ["codestral-latest", "mistral-large-latest", "mistral-small-latest"],
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
    models: ["Qwen/Qwen2.5-Coder-32B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3"],
    defaultModel: "Qwen/Qwen2.5-Coder-32B-Instruct",
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
    models: ["meta-llama/Meta-Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-Coder-32B-Instruct"],
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
      "Sign up with email",
      "Go to API Keys → Create API Key",
      "Copy the key and paste below",
    ],
    limit: "5M tokens free · strong coder",
    desc: "DeepSeek V3 / R1 reasoning model",
  },
  {
    id: "zhipu",
    name: "Zhipu AI · BigModel (China)",
    models: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
    defaultModel: "glm-4-flash",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    keyURL: "https://open.bigmodel.cn/",
    steps: [
      "Go to https://open.bigmodel.cn/",
      "Register with email or phone",
      "Go to API Keys → create a new key",
      "Copy the key and paste below (GLM-4-Flash is permanently free)",
    ],
    limit: "GLM-4-Flash permanently free · 128k context",
    desc: "GLM-4-Flash free, fast inference",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow · 硅基流动 (China)",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"],
    defaultModel: "deepseek-ai/DeepSeek-V3",
    baseURL: "https://api.siliconflow.cn/v1",
    keyURL: "https://cloud.siliconflow.cn/",
    steps: [
      "Go to https://cloud.siliconflow.cn/",
      "Register with account",
      "Go to API Keys → 'Create API Key'",
      "Copy the key and paste below",
    ],
    limit: "20M tokens new users · 1000 RPM",
    desc: "DeepSeek V3, R1, Qwen2.5, low latency",
  },
  {
    id: "qwen",
    name: "Alibaba Qwen · 百炼 (China)",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    defaultModel: "qwen-plus",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyURL: "https://bailian.console.aliyun.com/",
    steps: [
      "Go to https://bailian.console.aliyun.com/",
      "Sign in with Alibaba Cloud account",
      "Open 'Model Studio' → create API Key",
      "Copy the key and paste below",
    ],
    limit: "Free trial tokens · strong coding capabilities",
    desc: "Alibaba Qwen series",
  },
  {
    id: "baidu",
    name: "Baidu Qianfan · 千帆 (China)",
    models: ["ernie-speed-128k", "ernie-lite-8k", "ernie-4.0-8k"],
    defaultModel: "ernie-speed-128k",
    baseURL: "https://qianfan.baidubce.com/v2",
    keyURL: "https://console.bce.baidu.com/qianfan/",
    steps: [
      "Go to https://console.bce.baidu.com/qianfan/",
      "Sign in with Baidu account",
      "Access 'Model Inference' → create API Key",
      "Copy the key and paste below (ERNIE-Speed free)",
    ],
    limit: "ERNIE-Speed free tier",
    desc: "Baidu Qianfan ERNIE models",
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
      "Sign in with Tencent account",
      "Click 'Activate' → go to API Keys",
      "Create key and paste below",
    ],
    limit: "Lite version free",
    desc: "Tencent Hunyuan models",
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
      "Copy the key and paste below",
    ],
    limit: "Free trial quota",
    desc: "ByteDance Doubao models",
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
    models: ["llama3.3", "qwen2.5-coder", "deepseek-r1"],
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
    rl.question(`  ${pc.cyan(">")} `, (answer) => {
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
