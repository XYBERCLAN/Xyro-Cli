import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { Messages } from "@anthropic-ai/sdk/resources/messages";
import { callLLM, callLLMStream, createClient, setRetryReporter } from "../providers/llm.js";

describe("direct Anthropic routing and retries", () => {
  afterEach(() => {
    mock.restoreAll();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.XYRO_PRIVACY;
  });

  it("recreates the stream after a transient failure", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.XYRO_PRIVACY = "off";
    setRetryReporter(() => {});
    let attempts = 0;
    mock.method(Messages.prototype, "stream", (() => {
      attempts++;
      const attempt = attempts;
      let onText: (text: string) => void = () => {};
      return {
        on(_event: string, callback: (text: string) => void) { onText = callback; },
        async finalMessage() {
          if (attempt === 1) throw Object.assign(new Error("overloaded"), { status: 529 });
          onText("ok");
          return { content: [], usage: {} };
        },
      };
    }) as typeof Messages.prototype.stream);
    const chunks: string[] = [];
    const result = await callLLMStream(createClient(undefined, "test"), "claude-test", [{ role: "user", content: "hi" }], (chunk) => chunks.push(chunk));
    assert.equal(attempts, 2);
    assert.deepEqual(chunks, ["ok"]);
    assert.equal(result.content, "ok");
  });

  it("does not retry after emitting partial output", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.XYRO_PRIVACY = "off";
    let attempts = 0;
    mock.method(Messages.prototype, "stream", (() => {
      attempts++;
      let onText: (text: string) => void = () => {};
      return {
        on(_event: string, callback: (text: string) => void) { onText = callback; },
        async finalMessage() {
          onText("partial");
          throw Object.assign(new Error("network error"), { status: 503 });
        },
      };
    }) as typeof Messages.prototype.stream);
    const chunks: string[] = [];
    await assert.rejects(callLLMStream(createClient(undefined, "test"), "claude-test", [{ role: "user", content: "hi" }], (chunk) => chunks.push(chunk)), /network error/);
    assert.equal(attempts, 1);
    assert.deepEqual(chunks, ["partial"]);
  });

  it("sends Anthropic-named models through an explicitly configured gateway", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    mock.method(Messages.prototype, "stream", (() => { throw new Error("unexpected direct request"); }) as typeof Messages.prototype.stream);
    let calls = 0;
    const client = createClient("https://gateway.example/v1", "test");
    mock.method(client.chat.completions, "create", (async () => {
      calls++;
      return { choices: [{ message: { content: "gateway", tool_calls: [] } }], usage: {} };
    }) as typeof client.chat.completions.create);
    const result = await callLLM(client, "anthropic.claude-test", [{ role: "user", content: "hi" }], []);
    assert.equal(calls, 1);
    assert.equal(result.content, "gateway");
  });

  it("streams through the configured gateway", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    mock.method(Messages.prototype, "stream", (() => { throw new Error("unexpected direct request"); }) as typeof Messages.prototype.stream);
    const client = createClient("https://gateway.example/v1", "test");
    mock.method(client.chat.completions, "create", (async () => (async function* () {
      yield { choices: [{ delta: { content: "gateway" } }] };
    })()) as typeof client.chat.completions.create);
    const chunks: string[] = [];
    const result = await callLLMStream(client, "claude-test", [{ role: "user", content: "hi" }], (chunk) => chunks.push(chunk), [], { pool: false, hedge: false });
    assert.deepEqual(chunks, ["gateway"]);
    assert.equal(result.content, "gateway");
  });

  it("honors an environment-configured gateway when no URL argument is supplied", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.OPENAI_BASE_URL = "https://gateway.example/v1";
    const client = createClient(undefined, "test");
    mock.method(client.chat.completions, "create", (async () => ({
      choices: [{ message: { content: "gateway", tool_calls: [] } }], usage: {},
    })) as typeof client.chat.completions.create);
    const result = await callLLM(client, "claude-test", [{ role: "user", content: "hi" }], []);
    assert.equal(result.content, "gateway");
  });

  it("uses direct Anthropic for its explicit HTTPS endpoint", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.XYRO_PRIVACY = "off";
    let attempts = 0;
    mock.method(Messages.prototype, "stream", (() => {
      attempts++;
      return { on() {}, async finalMessage() { return { content: [], usage: {} }; } };
    }) as typeof Messages.prototype.stream);
    await callLLM(createClient("https://api.anthropic.com/v1", "test"), "claude-test", [{ role: "user", content: "hi" }], []);
    assert.equal(attempts, 1);
  });
});
