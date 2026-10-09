import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import OpenAI from "openai";
import { redactText, restoreText, restoringStream, shouldShield, privacyStatus, setPrivacyEnabled, _resetPrivacy } from "../providers/privacy.js";
import { callLLMStream } from "../providers/llm.js";

const OPENAI_KEY = "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
const GOOGLE_KEY = "AIza" + "SyD3x4mpl3K3yV4lu3AbCdEfGhIjKlMnOpQ";
const GH_TOKEN = "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789";

let tmp: string;
let oldXdg: string | undefined;
before(() => {
  oldXdg = process.env.XDG_CONFIG_HOME;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-privacy-"));
  process.env.XDG_CONFIG_HOME = tmp;
  process.env.XYRO_NO_POOL = "1";
});
after(() => {
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
  delete process.env.XYRO_NO_POOL;
  delete process.env.XYRO_PRIVACY;
});
beforeEach(() => _resetPrivacy());

describe("Privacy shield: detection", () => {
  it("withholds keys, tokens, passwords, private keys, cards and emails", () => {
    const env = [
      `OPENAI_API_KEY=${OPENAI_KEY}`,
      `GEMINI=${GOOGLE_KEY}`,
      `token: "${GH_TOKEN}"`,
      `DB_PASSWORD=hunter2hunter2`,
      `DATABASE_URL=postgres://admin:s3cretPw@db.internal:5432/app`,
      `card 4111 1111 1111 1111 on file`,
      `contact jane.doe@acme.io`,
      `-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----`,
    ].join("\n");
    const out = redactText(env);
    for (const real of [OPENAI_KEY, GOOGLE_KEY, GH_TOKEN, "hunter2hunter2", "s3cretPw", "4111 1111 1111 1111", "jane.doe@acme.io", "MIIEow"]) {
      assert.ok(!out.includes(real), `${real} leaked:\n${out}`);
    }
    assert.match(out, /OPENAI_API_KEY=\[\[XYRO_SECRET_\d+\]\]/);
    assert.match(out, /DB_PASSWORD=\[\[XYRO_PASSWORD_\d+\]\]/);
    assert.match(out, /postgres:\/\/admin:\[\[XYRO_PASSWORD_\d+\]\]@db\.internal/);
    assert.match(out, /\[\[XYRO_CARD_1\]\]/);
    assert.match(out, /\[\[XYRO_EMAIL_1\]\]/);
    assert.match(out, /\[\[XYRO_KEY_1\]\]/);
    assert.equal(restoreText(out), env, "round-trips exactly");
  });

  it("leaves ordinary code alone", () => {
    const code = [
      "const token = getToken(req);",
      "const password = req.body.password;",
      "apiKey: process.env.OPENAI_API_KEY,",
      "MAX_TOKENS=100000",
      "password: string;",
      "const tokenizer = 'cl100k_base';",
      "git commit --author 'Bot <noreply@example.com>'",
      "order id 1234567890123",
      "DB_URL=postgres://user:${DB_PASS}@host/db",
    ].join("\n");
    assert.equal(redactText(code), code);
  });

  it("the same value always gets the same placeholder", () => {
    const a = redactText(`k=${OPENAI_KEY}`);
    const b = redactText(`again ${OPENAI_KEY}`);
    assert.equal(a.match(/\[\[[^\]]+\]\]/)![0], b.match(/\[\[[^\]]+\]\]/)![0]);
  });

  it("withholds your own saved provider keys even in unusual formats", () => {
    fs.mkdirSync(path.join(tmp, "xyro"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "xyro", "config.json"), JSON.stringify({ providerKeys: { groq: "custom-format-key-1234567890" } }));
    _resetPrivacy();
    assert.ok(!redactText("the key is custom-format-key-1234567890 ok").includes("custom-format-key"));
    fs.rmSync(path.join(tmp, "xyro", "config.json"));
  });

  it("restores a placeholder split across stream chunks", () => {
    const ph = redactText(`x ${GH_TOKEN}`).slice(2);
    let shown = "";
    const s = restoringStream((c) => (shown += c));
    for (const part of ["Use ", ph.slice(0, 3), ph.slice(3, 11), ph.slice(11), " in [brackets] and [[ -f x ]]"]) s.push(part);
    s.flush();
    assert.equal(shown, `Use ${GH_TOKEN} in [brackets] and [[ -f x ]]`);
  });

  it("is skipped for local models and when turned off", () => {
    assert.equal(shouldShield("http://localhost:11434/v1"), false);
    assert.equal(shouldShield("https://api.groq.com/openai/v1"), true);
    setPrivacyEnabled(false);
    assert.equal(shouldShield("https://api.groq.com/openai/v1"), false);
    _resetPrivacy();
    process.env.XYRO_PRIVACY = "off";
    assert.equal(shouldShield("https://api.groq.com/openai/v1"), false);
    delete process.env.XYRO_PRIVACY;
  });
});

describe("Privacy shield on the wire", () => {
  let server: http.Server;
  let url = "";
  let received = "";

  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = body;
        const ph = (body.match(/\[\[XYRO_SECRET_\d+\]\]/) ?? ["[[none]]"])[0];
        const email = (body.match(/\[\[XYRO_EMAIL_\d+\]\]/) ?? ["[[none]]"])[0];
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const send = (delta: object) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
        send({ role: "assistant", content: `Your key ${ph.slice(0, 6)}` });
        send({ content: `${ph.slice(6)} belongs to ${email}.` });
        send({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: ".env", content: `OPENAI_API_KEY=${ph}\n` }) } }] });
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  after(() => server.close());

  it("the provider never sees the values; the user and the tools get them back", async () => {
    _resetPrivacy({ shieldLocal: true });
    const client = new OpenAI({ baseURL: url, apiKey: "k", maxRetries: 0 });
    let shown = "";
    const res = await callLLMStream(
      client,
      "fake",
      [
        { role: "user", content: "fix my env, I'm ana@startup.dev" },
        { role: "tool", tool_call_id: "t", content: `OPENAI_API_KEY=${OPENAI_KEY}\n` },
      ],
      (c) => (shown += c),
      []
    );
    assert.ok(!received.includes(OPENAI_KEY) && !received.includes("ana@startup.dev"), received);
    assert.equal(shown, `Your key ${OPENAI_KEY} belongs to ana@startup.dev.`);
    assert.equal(res.content, shown);
    assert.equal(JSON.parse(res.tool_calls[0].function.arguments).content, `OPENAI_API_KEY=${OPENAI_KEY}\n`);

    const audit = fs.readFileSync(privacyStatus().auditPath, "utf-8");
    assert.ok(!audit.includes(OPENAI_KEY) && !audit.includes("ana@"), "audit holds counts, never values");
    assert.deepEqual(JSON.parse(audit.trim().split("\n").pop()!).withheld, { SECRET: 1, EMAIL: 1 });
    assert.equal(privacyStatus().distinct.SECRET, 1);
  });

  it("a local endpoint gets the conversation as is", async () => {
    _resetPrivacy();
    const client = new OpenAI({ baseURL: url, apiKey: "k", maxRetries: 0 });
    await callLLMStream(client, "fake", [{ role: "user", content: `key ${OPENAI_KEY}` }], () => {}, []);
    assert.ok(received.includes(OPENAI_KEY));
  });
});
