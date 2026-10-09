import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import OpenAI from "openai";
import { callLLMStream, ModelSwitch, setRetryReporter } from "../providers/llm.js";
import { poolStatus, isCoolingDown, _resetPool, buildCandidates, hedgeDelayMs, noteRateLimit, isKeyRejected } from "../providers/pool.js";
import { FREE_PROVIDERS } from "../ui/prompts.js";

type Behaviour = (model: string) => { status?: number; error?: string; text?: string; cutMidStream?: boolean; delayMs?: number };
const aborted: Record<string, number> = { a: 0, b: 0 };
const hits: Record<string, string[]> = { a: [], b: [] };
let behaviourA: Behaviour = () => ({ text: "A ok" });
let behaviourB: Behaviour = () => ({ text: "B ok" });

function fakeProvider(name: "a" | "b", get: () => Behaviour): http.Server {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const { model } = JSON.parse(body);
      hits[name].push(model);
      const b = get()(model);
      if (b.delayMs) {
        let closed = false;
        res.on("close", () => {
          if (!res.writableEnded) {
            closed = true;
            aborted[name]++;
          }
        });
        await new Promise((r) => setTimeout(r, b.delayMs));
        if (closed) return;
      }
      if (b.status) {
        res.writeHead(b.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: b.error ?? "error" } }));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: b.text } }] })}\n\n`);
      if (b.cutMidStream) return res.destroy();
      res.end("data: [DONE]\n\n");
    });
  });
}

let serverA: http.Server;
let serverB: http.Server;
let urlA = "";
let urlB = "";
const saved: Record<string, string> = {};
let oldXdg: string | undefined;

before(async () => {
  serverA = fakeProvider("a", () => behaviourA);
  serverB = fakeProvider("b", () => behaviourB);
  await new Promise<void>((r) => serverA.listen(0, r));
  await new Promise<void>((r) => serverB.listen(0, r));
  urlA = `http://127.0.0.1:${(serverA.address() as { port: number }).port}/v1`;
  urlB = `http://127.0.0.1:${(serverB.address() as { port: number }).port}/v1`;
  // Point two known providers at the fakes
  for (const [id, url] of [["google", urlA], ["openrouter", urlB]] as const) {
    const p = FREE_PROVIDERS.find((x) => x.id === id)!;
    saved[id] = p.baseURL;
    p.baseURL = url;
  }
  oldXdg = process.env.XDG_CONFIG_HOME;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-pool-"));
  process.env.XDG_CONFIG_HOME = tmp;
  fs.mkdirSync(path.join(tmp, "xyro"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "xyro", "config.json"), JSON.stringify({ providerKeys: { google: "ka", openrouter: "kb" } }));
});

after(() => {
  serverA.close();
  serverB.close();
  for (const [id, url] of Object.entries(saved)) FREE_PROVIDERS.find((x) => x.id === id)!.baseURL = url;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

beforeEach(() => {
  _resetPool();
  behaviourA = () => ({ text: "A ok" });
  behaviourB = () => ({ text: "B ok" });
  hits.a.length = 0;
  hits.b.length = 0;
  aborted.a = 0;
  aborted.b = 0;
});

const client = () => new OpenAI({ baseURL: urlA, apiKey: "ka", maxRetries: 0 });
const ask = (onSwitch?: (s: ModelSwitch) => void) => {
  let text = "";
  return callLLMStream(client(), "gemini-flash-latest", [{ role: "user", content: "hi" }], (c) => (text += c), [], { onSwitch }).then((r) => ({ r, text }));
};

describe("Free-quota pool", () => {
  it("moves to another provider when the free quota is used up", async () => {
    behaviourA = () => ({ status: 429, error: "Resource has been exhausted (check quota)." });
    behaviourB = () => ({ text: "answered by B" });
    const switches: ModelSwitch[] = [];
    const { r, text } = await ask((s) => switches.push(s));
    assert.equal(text, "answered by B");
    assert.equal(r.providerId, "openrouter");
    assert.equal(hits.a.length, 1, "a per-key limit is not retried on every model of the same provider");
    const cross = switches.find((s) => s.crossProvider)!;
    assert.equal(cross.toProvider, "openrouter");
    assert.equal(cross.reason, "free quota used up");
    assert.ok(isCoolingDown("google"));
  });

  it("skips a provider that is resting", async () => {
    behaviourA = () => ({ status: 429, error: "Resource has been exhausted (check quota)." });
    await ask();
    hits.a.length = 0;
    behaviourA = () => ({ text: "A is back" });
    const { text } = await ask();
    assert.equal(hits.a.length, 0, "resting provider is not called");
    assert.equal(text, "B ok");
  });

  it("tries another model on the same provider when one is overloaded", async () => {
    behaviourA = (model) => (model === "gemini-flash-latest" ? { status: 503, error: "model overloaded" } : { text: `A via ${model}` });
    const switches: ModelSwitch[] = [];
    const { text, r } = await ask((s) => switches.push(s));
    assert.equal(r.providerId, "google");
    assert.ok(text.startsWith("A via "));
    assert.equal(switches[0].crossProvider, false);
    assert.equal(hits.b.length, 0);
  });

  it("never switches after text was already shown", async () => {
    behaviourA = () => ({ text: "partial answ", cutMidStream: true });
    await assert.rejects(ask());
    assert.equal(hits.b.length, 0, "no duplicate answer from another provider");
  });

  it("reports capacity for /quota", async () => {
    behaviourA = () => ({ status: 429, error: "rate limit reached, retry after 120s" });
    await ask();
    const g = poolStatus().find((p) => p.providerId === "google")!;
    assert.equal(g.rateLimitsToday, 1);
    assert.ok(g.coolingForMs > 100_000 && g.coolingForMs <= 120_000, `cooldown follows the retry hint: ${g.coolingForMs}`);
    const o = poolStatus().find((p) => p.providerId === "openrouter")!;
    assert.equal(o.requestsToday, 1);
  });

  it("XYRO_NO_POOL keeps requests on one provider", () => {
    process.env.XYRO_NO_POOL = "1";
    try {
      assert.ok(buildCandidates(urlA, "gemini-flash-latest").every((c) => c.sameProvider));
    } finally {
      delete process.env.XYRO_NO_POOL;
    }
  });
});

describe("Hedged requests", () => {
  const hedgeAsk = (onSwitch?: (s: ModelSwitch) => void) => {
    let text = "";
    return callLLMStream(client(), "gemini-flash-latest", [{ role: "user", content: "hi" }], (c) => (text += c), [], { onSwitch, hedge: true }).then((r) => ({ r, text }));
  };
  before(() => (process.env.XYRO_HEDGE_MS = "150"));
  after(() => delete process.env.XYRO_HEDGE_MS);

  it("a stuck request is raced on another provider; the fast one wins and the slow one is cancelled", async () => {
    behaviourA = () => ({ text: "slow A", delayMs: 1500 });
    behaviourB = () => ({ text: "fast B" });
    const switches: ModelSwitch[] = [];
    const started = Date.now();
    const { r, text } = await hedgeAsk((s) => switches.push(s));
    assert.equal(text, "fast B", "only the winner's words reach the screen");
    assert.equal(r.providerId, "openrouter");
    assert.ok(Date.now() - started < 1200, "did not wait for the slow provider");
    assert.equal(switches[0].reason, "slow to respond");
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(aborted.a, 1, "the losing request was aborted");
  });

  it("no backup request when the provider answers in time", async () => {
    const { text } = await hedgeAsk();
    assert.equal(text, "A ok");
    assert.equal(hits.b.length, 0);
  });

  it("if the primary starts streaming first, the backup is cancelled and output is not mixed", async () => {
    behaviourA = () => ({ text: "A first", delayMs: 300 });
    behaviourB = () => ({ text: "B late", delayMs: 1500 });
    const { text, r } = await hedgeAsk();
    assert.equal(text, "A first");
    assert.equal(r.providerId, "google");
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(aborted.b, 1);
  });

  it("an immediate error still fails over normally", async () => {
    behaviourA = () => ({ status: 429, error: "Resource has been exhausted (check quota)." });
    const { text } = await hedgeAsk();
    assert.equal(text, "B ok");
  });

  it("XYRO_HEDGE=off and calls without hedge never send a backup", async () => {
    behaviourA = () => ({ text: "slow A", delayMs: 400 });
    process.env.XYRO_HEDGE = "off";
    try {
      assert.equal((await hedgeAsk()).text, "slow A");
    } finally {
      delete process.env.XYRO_HEDGE;
    }
    assert.equal((await ask()).text, "slow A");
    assert.equal(hits.b.length, 0);
  });

  it("learns each provider's usual first-token time to decide when to hedge", async () => {
    delete process.env.XYRO_HEDGE_MS;
    try {
      assert.equal(hedgeDelayMs("google"), 8000, "unknown provider: patient default");
      await ask();
      const learned = poolStatus().find((p) => p.providerId === "google")!.typicalFirstTokenMs!;
      assert.ok(learned >= 0 && learned < 1000, String(learned));
      assert.equal(hedgeDelayMs("google"), 2500, "fast provider: hedge after the floor");
    } finally {
      process.env.XYRO_HEDGE_MS = "150";
    }
  });
});

describe("Bad keys elsewhere never block your provider", () => {
  it("your provider is still tried while it rests, after the others", () => {
    noteRateLimit("google", Object.assign(new Error("rate limit"), { status: 429 }));
    const c = buildCandidates(urlA, "gemini-flash-latest");
    assert.ok(c.some((x) => x.sameProvider), "the provider you chose is never dropped");
    assert.equal(c[0].sameProvider, false, "while it rests, ready providers go first");
  });

  it("another provider's rejected key is skipped (and remembered) and your provider answers", async () => {
    noteRateLimit("google", Object.assign(new Error("rate limit"), { status: 429 }));
    behaviourB = () => ({ status: 401, error: "Invalid token" });
    behaviourA = () => ({ text: "your provider answered" });
    const notices: string[] = [];
    setRetryReporter((m) => notices.push(m));
    try {
      const { text, r } = await ask();
      assert.equal(text, "your provider answered");
      assert.equal(r.providerId, "google");
      assert.ok(notices.some((n) => /OpenRouter rejected its saved API key/.test(n)), notices.join("|"));
      assert.equal(isKeyRejected("openrouter", "kb"), true);
      assert.equal(isKeyRejected("openrouter", "a-brand-new-key"), false, "a newly saved key is tried again");
      hits.b.length = 0;
      await ask();
      assert.equal(hits.b.length, 0, "the rejected key is not tried again");
    } finally {
      setRetryReporter(() => {});
    }
  });

  it("a borrowed provider failing for any reason (a bare 400) doesn't end the chain", async () => {
    noteRateLimit("google", Object.assign(new Error("rate limit"), { status: 429 }));
    behaviourB = () => ({ status: 400, error: "" });
    behaviourA = () => ({ text: "still fine" });
    assert.equal((await ask()).text, "still fine");
  });

  it("when everything fails, the error is YOUR provider's, labelled with it", async () => {
    behaviourA = () => ({ status: 404, error: "No endpoints found for this model" });
    behaviourB = () => ({ status: 401, error: "Invalid token" });
    const err = (await ask().catch((e) => e)) as { status?: number; xyroProvider?: string };
    assert.equal(err.xyroProvider, "google");
    assert.equal(err.status, 404, "not the other provider's 401, which would wrongly ask for a new key");
  });
});

describe("Model switch notices", () => {
  it("say nothing when your own model ends up answering, even after a detour", async () => {
    noteRateLimit("google", Object.assign(new Error("rate limit"), { status: 429 })); // your provider "rests"
    behaviourB = () => ({ status: 400, error: "" }); // the borrowed provider fails
    behaviourA = () => ({ text: "mine" });
    const switches: ModelSwitch[] = [];
    const { text } = await ask((s) => switches.push(s));
    assert.equal(text, "mine");
    assert.deepEqual(switches, [], "no 'continuing on…' lines for a detour that came back");
  });

  it("a successful answer ends the rest period, so the next request goes straight to your provider", async () => {
    noteRateLimit("google", Object.assign(new Error("rate limit"), { status: 429 }));
    behaviourB = () => ({ status: 400, error: "" });
    await ask();
    assert.equal(isCoolingDown("google"), false, "it answered, so it's not resting");
    hits.b.length = 0;
    await ask();
    assert.equal(hits.b.length, 0, "no detour through the other provider any more");
  });

  it("a real switch is announced once, not on every step", async () => {
    behaviourA = (model) => (model === "gemini-flash-latest" ? { status: 404, error: "model not found" } : { text: "other model" });
    const switches: ModelSwitch[] = [];
    for (let i = 0; i < 4; i++) await ask((s) => switches.push(s));
    assert.equal(switches.length, 1);
    assert.equal(switches[0].from, "gemini-flash-latest");
    assert.equal(switches[0].reason, "model unavailable");
  });
});
