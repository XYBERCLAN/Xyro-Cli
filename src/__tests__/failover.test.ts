import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getFallbackChain,
  isFallbackableError,
  callLLM,
} from "../providers/llm.js";

describe("Failover & Fallback Mechanism", () => {
  it("computes fallback chain with current model first without duplicates", () => {
    const googleChain = getFallbackChain(
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      "gemini-flash-latest"
    );

    assert.equal(googleChain[0], "gemini-flash-latest");
    assert.ok(googleChain.includes("gemini-3.5-flash"));
    assert.ok(googleChain.includes("gemini-3.6-flash"));

    // No duplicates
    const unique = new Set(googleChain);
    assert.equal(unique.size, googleChain.length);
  });

  it("identifies fallbackable errors (503, 429, 404, high demand)", () => {
    assert.equal(isFallbackableError({ status: 503 }), true);
    assert.equal(isFallbackableError(new Error("503 Service Unavailable")), true);
    assert.equal(isFallbackableError(new Error("This model is currently experiencing high demand.")), true);
    assert.equal(isFallbackableError({ status: 429 }), true);
    assert.equal(isFallbackableError({ status: 404 }), true);
    assert.equal(isFallbackableError(new Error("Generic code error")), false);
  });

  it("automatically fails over to secondary candidate model on 503", async () => {
    let attemptedModels: string[] = [];
    let switchedTo: string | null = null;

    const mockClient: any = {
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      chat: {
        completions: {
          create: async (params: { model: string }) => {
            attemptedModels.push(params.model);
            if (params.model === "gemini-flash-latest") {
              const err: any = new Error("This model is currently experiencing high demand.");
              err.status = 503;
              throw err;
            }
            return {
              choices: [
                {
                  message: {
                    content: "Recovered via fallback model!",
                    tool_calls: [],
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          },
        },
      },
    };

    const result = await callLLM(
      mockClient,
      "gemini-flash-latest",
      [{ role: "user", content: "hello" }],
      [],
      (newModel) => {
        switchedTo = newModel;
      }
    );

    assert.equal(result.content, "Recovered via fallback model!");
    assert.equal(result.actualModel, "gemini-3.5-flash");
    assert.equal(switchedTo, "gemini-3.5-flash");
    assert.ok(attemptedModels.includes("gemini-flash-latest"));
    assert.ok(attemptedModels.includes("gemini-3.5-flash"));
  });
});
