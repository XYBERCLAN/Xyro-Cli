import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { healModel, isChatModel } from "../models/live.js";
import { describeError } from "../providers/llm.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";

let oldXdg: string | undefined;
let dir: string;
beforeEach(() => {
  oldXdg = process.env.XDG_CONFIG_HOME;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-fresh-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => {
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

const cache = (models: { id: string; isFree?: boolean }[]) => {
  fs.mkdirSync(path.join(dir, "xyro"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "xyro", "models-cache.json"),
    JSON.stringify({ nvidia: { fetchedAt: Date.now(), models: models.map((m) => ({ id: m.id, name: m.id, provider: "NVIDIA", providerId: "nvidia", isFree: m.isFree ?? true, badge: "FREE", desc: "" })) } })
  );
};

describe("Providers stay current", () => {
  it("a model the provider retired is replaced by its default, or the best live chat model", () => {
    const def = FREE_PROVIDERS.find((p) => p.id === "nvidia")!.defaultModel;
    cache([{ id: def }, { id: "nvidia/nemotron-3.5-content-safety" }, { id: "other/model-instruct" }]);
    assert.equal(healModel("nvidia", "meta/llama-3.3-70b-instruct"), def);
    assert.equal(healModel("nvidia", def), null, "a live model is left alone");
    cache([{ id: "nvidia/nemotron-3.5-content-safety" }, { id: "x/some-coder-model" }, { id: "y/chat-model" }]);
    assert.equal(healModel("nvidia", "gone/model"), "x/some-coder-model", "prefers a coding model, never a safety classifier");
    assert.equal(healModel("groq", "anything"), null, "no live list: no guessing");
  });

  it("models that can't chat are never offered", () => {
    for (const id of ["nvidia/nemotron-3.5-content-safety", "nvidia/llama-nemotron-embed-vl-1b-v2", "meta/llama-guard-4", "nvidia/nemotron-4-340b-reward", "nvidia/nemotron-parse-2.0"]) assert.equal(isChatModel(id), false, id);
    for (const id of ["cohere/north-mini-code:free", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3"]) assert.equal(isChatModel(id), true, id);
  });

  it("built-in providers use their current addresses", () => {
    const url = (id: string) => FREE_PROVIDERS.find((p) => p.id === id)!.baseURL;
    assert.equal(url("github"), "https://models.github.ai/inference");
    assert.equal(url("huggingface"), "https://router.huggingface.co/v1");
    assert.equal(url("cohere"), "https://api.cohere.ai/compatibility/v1");
    assert.equal(url("ovhcloud"), "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1");
  });
});

describe("Error messages are never empty", () => {
  it("explains a bare status, a dropped connection, and the totally silent case", () => {
    assert.match(describeError(Object.assign(new Error(""), { status: 400 })), /^HTTP 400: the request was rejected/);
    assert.match(describeError(Object.assign(new Error("400 status code (no body)"), { status: 400, xyroProvider: "google" })), /^Google AI Studio: HTTP 400/);
    assert.equal(describeError(Object.assign(new Error(""), { cause: { code: "ECONNRESET" } })), "connection problem: ECONNRESET");
    assert.match(describeError(new Error("")), /no details from the provider/);
    assert.equal(describeError(new Error("429 Rate limit exceeded: free-models-per-day")), "429 Rate limit exceeded: free-models-per-day");
  });
});
