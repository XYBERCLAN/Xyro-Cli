import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyModel, sortDiscoveredModels, fetchLiveProviderModels } from "../models/fetcher.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";
import { DEFAULT_MODELS, getAllModels, registerDiscoveredModels } from "../models/catalog.js";

describe("Live Model Discovery & Classification", () => {
  it("classifies free models and coding specialists", () => {
    const freeCoder = classifyModel("deepseek/deepseek-r1:free", "DeepSeek R1", "openrouter");
    assert.equal(freeCoder.isFree, true);
    assert.equal(freeCoder.isCoding, true);
    assert.equal(freeCoder.badge, "FREE");

    const proCoder = classifyModel("anthropic/claude-3.5-sonnet", "Claude 3.5 Sonnet", "tokenrouter");
    assert.equal(proCoder.isFree, false);
    assert.equal(proCoder.isCoding, true);
    assert.equal(proCoder.badge, "PAID");

    const localModel = classifyModel("llama3.3:latest", "Llama 3.3", "local");
    assert.equal(localModel.isFree, true);
    assert.equal(localModel.badge, "LOCAL");
  });

  it("sorts free models at the top, then coding models", () => {
    const models = [
      classifyModel("openai/gpt-4o", "GPT-4o", "tokenrouter"),
      classifyModel("deepseek/deepseek-r1:free", "DeepSeek R1", "tokenrouter"),
      classifyModel("meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 Free", "tokenrouter"),
      classifyModel("anthropic/claude-3.5-sonnet", "Claude 3.5 Sonnet", "tokenrouter"),
    ];

    const sorted = sortDiscoveredModels(models);

    // Free models must be at index 0 and 1
    assert.equal(sorted[0].isFree, true);
    assert.equal(sorted[1].isFree, true);
    // DeepSeek R1 is coding free, should precede non-coding free
    assert.equal(sorted[0].id, "deepseek/deepseek-r1:free");

    // Paid coding models follow
    assert.equal(sorted[2].isFree, false);
    assert.equal(sorted[3].isFree, false);
  });

  it("falls back to default provider models when offline or unreachable", async () => {
    const fallbackIds = ["moonshotai/kimi-k3-free", "anthropic/claude-3.5-sonnet"];
    const models = await fetchLiveProviderModels("https://invalid-non-existent-url.local/v1", "test-key", "tokenrouter", fallbackIds);

    assert.ok(models.length >= 2);
    // Free model should be sorted at top
    assert.equal(models[0].id, "moonshotai/kimi-k3-free");
    assert.equal(models[0].isFree, true);
  });

  it("contains TokenRouter in FREE_PROVIDERS and DEFAULT_MODELS", () => {
    const tr = FREE_PROVIDERS.find((p) => p.id === "tokenrouter");
    assert.ok(tr, "TokenRouter must be present in FREE_PROVIDERS");
    assert.equal(tr.baseURL, "https://api.tokenrouter.com/v1");

    const trCatalog = DEFAULT_MODELS.filter((m) => m.providerId === "tokenrouter");
    assert.ok(trCatalog.length >= 3, "TokenRouter should have catalog entries");
  });

  it("registers discovered models into global catalog", () => {
    const beforeCount = getAllModels().length;
    registerDiscoveredModels([
      {
        id: "test-new-discovered-model-xyz",
        name: "Test Discovered Model",
        provider: "TokenRouter",
        providerId: "tokenrouter",
        isFree: true,
        badge: "FREE",
        desc: "Live model test",
      },
    ]);
    const afterCount = getAllModels().length;
    assert.equal(afterCount, beforeCount + 1);
  });
});
