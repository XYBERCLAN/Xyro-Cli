import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { Agent, repairHistory, getMaxHistoryTokens, noteContextLimit } from "../agent/loop.js";
import type { Message } from "../agent/types.js";

describe("Recovering from a 400 (tester report: OpenRouter 400 after a while)", () => {
  let server: http.Server;
  let url = "";
  const bodies: number[] = [];
  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        bodies.push(body.length);
        if (bodies.length === 1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "This endpoint's maximum context length is 16384 tokens. However, you requested about 30000 tokens.", code: 400 } }));
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "Answer after recovery." } }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  after(() => server.close());

  it("learns the model's window from the error, shortens the conversation and retries once", async () => {
    process.env.XYRO_NO_POOL = "1";
    process.env.XYRO_HEDGE = "off";
    try {
      const agent = new Agent({ baseURL: url, apiKey: "k", model: "small/free-model" });
      const notices: string[] = [];
      let text = "";
      agent.setOutputAdapter({ onNotice: (n) => notices.push(n), onAssistantText: (c) => (text += c), onError: (e) => notices.push(`ERROR ${e}`) });
      await agent.run("hello");
      assert.equal(text, "Answer after recovery.");
      assert.match(notices.join("|"), /takes at most 16,384 tokens: XYRO shortened the conversation and retried/);
      assert.ok(!notices.some((n) => n.startsWith("ERROR")));
      assert.ok(getMaxHistoryTokens(url, "small/free-model") <= 16384 - 4096 - 5000);
    } finally {
      delete process.env.XYRO_NO_POOL;
      delete process.env.XYRO_HEDGE;
    }
  });

  it("repairs a conversation broken by a stop or a crash", () => {
    const msgs: Message[] = [
      { role: "system", content: "s" },
      { role: "user", content: "do it" },
      { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: "{}" } }, { id: "b", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "ok" },
      { role: "tool", tool_call_id: "zombie", content: "orphan" },
      { role: "assistant", content: "" },
      { role: "user", content: "next" },
    ];
    const { messages, changed } = repairHistory(msgs);
    assert.equal(changed, true);
    assert.deepEqual(messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id).sort(), ["a", "b"], "every call answered, no orphan result");
    assert.ok(!messages.some((m) => m.role === "assistant" && !m.tool_calls && !m.content), "no empty assistant turn");
    assert.equal(repairHistory(messages).changed, false, "a sound conversation is left alone");
  });

  it("reads context limits from the ways providers word them", () => {
    assert.equal(noteContextLimit("m1", new Error("This endpoint's maximum context length is 32768 tokens")), 32768);
    assert.equal(noteContextLimit("m2", new Error("Please reduce the length of the messages")), null);
  });
});
