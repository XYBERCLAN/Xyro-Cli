import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Message } from "../agent/types.js";
import { trimHistory, estimateTokens, truncateToolResult, MAX_TOOL_RESULT_CHARS } from "../agent/loop.js";
import { isRateLimitError, extractRetryDelay, isTransientNetworkError } from "../providers/llm.js";

describe("Rate Limit & Network Detection", () => {
  it("detects 429 status and rate limit strings", () => {
    assert.strictEqual(isRateLimitError({ status: 429 }), true);
    assert.strictEqual(isRateLimitError(new Error("429 Too Many Requests")), true);
    assert.strictEqual(isRateLimitError(new Error("Rate limit reached for model")), true);
    assert.strictEqual(isRateLimitError(new Error("Resource has been exhausted (check quota)")), true);
    assert.strictEqual(isRateLimitError(new Error("exceeded TPM limit")), true);
    assert.strictEqual(isRateLimitError(new Error("regular compilation error")), false);
  });

  it("detects transient network errors", () => {
    assert.strictEqual(isTransientNetworkError(new Error("ETIMEDOUT connection")), true);
    assert.strictEqual(isTransientNetworkError(new Error("ECONNRESET")), true);
    assert.strictEqual(isTransientNetworkError(new Error("fetch failed")), true);
    assert.strictEqual(isTransientNetworkError(new Error("Syntax error")), false);
  });

  it("extracts retry delay from headers", () => {
    const errWithSecHeader = {
      headers: { "retry-after": "5" },
    };
    assert.strictEqual(extractRetryDelay(errWithSecHeader, 0), 5000);

    const errWithMsHeader = {
      headers: { "retry-after-ms": "2500" },
    };
    assert.strictEqual(extractRetryDelay(errWithMsHeader, 0), 2500);
  });

  it("extracts retry delay from error message", () => {
    const err = new Error("Rate limit exceeded, please try again in 12.5s");
    assert.strictEqual(extractRetryDelay(err, 0), 12500);

    const errMs = new Error("Rate limit reached: wait 3500ms");
    assert.strictEqual(extractRetryDelay(errMs, 0), 3500);
  });

  it("computes backoff with jitter when no delay is specified", () => {
    const delay = extractRetryDelay(new Error("Rate limit"), 1);
    assert.ok(delay >= 4000 && delay <= 6000, `Expected delay between 4000 and 6000, got ${delay}`);
  });
});

describe("History Trimming and Context Protection", () => {
  it("truncates large tool results", () => {
    const longText = "a".repeat(MAX_TOOL_RESULT_CHARS + 500);
    const truncated = truncateToolResult(longText);
    assert.ok(truncated.includes("truncated"));
    assert.strictEqual(truncated.startsWith("a".repeat(100)), true);
  });

  it("never splits assistant tool_calls from their corresponding tool results", () => {
    const msgs: Message[] = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Task 1 " + "x".repeat(40000) },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"test.txt"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "Result 1 " + "x".repeat(40000) },
      { role: "assistant", content: "Task 1 complete" },
      { role: "user", content: "Task 2 recent prompt" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"app.ts"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_2", content: "Result 2 app content" },
    ];

    const trimmed = trimHistory(msgs);

    // Should keep system message
    assert.strictEqual(trimmed[0].role, "system");

    // Must never have an orphaned tool message right after system
    if (trimmed.length > 1) {
      assert.notStrictEqual(trimmed[1].role, "tool", "First message after system should not be a tool role");
    }

    // Every tool message must have a preceding assistant message with matching tool_calls
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i].role === "tool") {
        const prev = trimmed[i - 1];
        const isPrevAssistantTool =
          prev.role === "assistant" &&
          prev.tool_calls &&
          prev.tool_calls.some((tc) => tc.id === trimmed[i].tool_call_id);
        const isPrevTool = prev.role === "tool";
        assert.ok(
          isPrevAssistantTool || isPrevTool,
          `Tool message at index ${i} is orphaned without matching assistant tool_calls`
        );
      }
    }
  });
});
