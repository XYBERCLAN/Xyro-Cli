// A scripted, OpenAI-compatible model for recording XYRO's README demo.
//
// The interface on screen is the real XYRO: real tools, real approvals, real
// tests. Only the model's replies are scripted, so the recording is identical
// every time, needs no API key and sends no code anywhere.
//
//   node docs/demo/fake-model.mjs            # listens on 127.0.0.1:4545
//   xyro --tui --base-url http://127.0.0.1:4545/v1 --api-key demo --model xyro-demo

import { createServer } from "node:http";

const PORT = Number(process.env.DEMO_PORT || 4545);
const MODEL = "xyro-demo";

const plan = (states) => ({
  items: [
    { text: "Read the signup handler", status: states[0], expert: "scout" },
    { text: "Validate email and password", status: states[1], expert: "builder" },
    { text: "Run the test suite", status: states[2], expert: "tester" },
  ],
});

const BEFORE = `export function signup({ email, password }) {
  return { ok: true, user: { email } };
}`;

const AFTER = `const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

export function signup({ email, password }) {
  if (!EMAIL.test(email ?? "")) return { ok: false, error: "Enter a valid email address." };
  if ((password ?? "").length < 8) return { ok: false, error: "Use at least 8 characters for the password." };
  return { ok: true, user: { email } };
}`;

// One entry per model call in the turn: what the model "says" and which tools it calls.
const SCRIPT = [
  {
    text: "I'll read the handler first, then add the validation and run the tests.",
    tools: [
      ["write_todos", plan(["in_progress", "pending", "pending"])],
      ["read_file", { path: "src/signup.js" }],
    ],
  },
  {
    text: "`signup` accepts an empty email and any password. I'll reject both with a clear message.",
    tools: [
      ["write_todos", plan(["done", "in_progress", "pending"])],
      ["edit_file", { path: "src/signup.js", old_text: BEFORE, new_text: AFTER }],
    ],
  },
  {
    text: "Now the tests.",
    tools: [
      ["write_todos", plan(["done", "done", "in_progress"])],
      ["run_tests", {}],
    ],
  },
  {
    text:
      "Done. `signup` now rejects an invalid email and passwords shorter than 8 characters, " +
      "with a message the user can act on. All 4 tests pass.",
    tools: [["write_todos", plan(["done", "done", "done"])]],
  },
  { text: "", tools: [["end_turn", { summary: "Signup input validation added; tests pass." }]] },
];

/** Which step of the script we are at: model calls made since the user's last message. */
function stepOf(messages) {
  let last = -1;
  messages.forEach((m, i) => { if (m.role === "user") last = i; });
  return messages.slice(last + 1).filter((m) => m.role === "assistant").length;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (delta, finish = null) => ({
  id: "demo", object: "chat.completion.chunk", created: 0, model: MODEL,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

async function stream(res, step) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  await sleep(450);
  send(chunk({ role: "assistant" }));
  // Stream the reply word by word so it types out on screen
  for (const word of step.text.split(/(?<= )/)) {
    send(chunk({ content: word }));
    await sleep(28);
  }
  step.tools.forEach(([name, args], index) => {
    send(chunk({ tool_calls: [{ index, id: `call_${name}_${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }));
  });
  send(chunk({}, step.tools.length ? "tool_calls" : "stop"));
  send({ ...chunk({}), choices: [], usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 } });
  res.end("data: [DONE]\n\n");
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "demo" }] }));
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  const request = JSON.parse(body || "{}");
  const step = SCRIPT[Math.min(stepOf(request.messages ?? []), SCRIPT.length - 1)];

  // Side requests (titles, summaries, classification) don't stream and get a short answer
  if (!request.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      id: "demo", object: "chat.completion", created: 0, model: MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: "Signup validation" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
    }));
  }
  await stream(res, step);
}).listen(PORT, "127.0.0.1", () => console.log(`demo model on http://127.0.0.1:${PORT}/v1`));
