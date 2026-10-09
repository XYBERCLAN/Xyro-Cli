import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LinkNode, LinkEvent, normaliseCode, newJoinCode, formatCode } from "../collab/link.js";

const linkModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "collab", "link.ts");
const tsx = import.meta.resolve("tsx");

let tmp: string;
let repo: string;
let oldXdg: string | undefined;
const nodes: LinkNode[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-link-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  execSync("git init -q && git config user.email t@t && git config user.name t && echo a > a && git add . && git commit -qm init", { cwd: repo });
  oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
});
afterEach(async () => {
  for (const n of nodes.splice(0)) await n.stop();
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldXdg;
});

function waitFor<T extends LinkEvent["type"]>(node: LinkNode, type: T, ms = 8000): Promise<Extract<LinkEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
    const off = node.on((e) => {
      if (e.type === type) {
        clearTimeout(timer);
        off();
        resolve(e as Extract<LinkEvent, { type: T }>);
      }
    });
  });
}

const make = async (name: string, root = repo) => {
  const n = new LinkNode({ root, name });
  nodes.push(n);
  await n.start();
  return n;
};

describe("XYRO Link on the same computer", () => {
  it("sessions on the same project find each other, chat and share the team board", async () => {
    const alice = await make("alice");
    const joined = waitFor(alice, "joined");
    const bob = await make("bob");
    assert.equal((await joined).peer.name, "bob");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(bob.peers().map((p) => [p.name, p.via]), [["alice", "local"]]);

    const chat = waitFor(bob, "chat");
    assert.equal(alice.sendChat("I'm on the API, take the UI?"), 1);
    assert.equal((await chat).text, "I'm on the API, take the UI?");

    const note = waitFor(alice, "note");
    bob.shareNote("Architect", "Decision: auth lives in src/auth");
    const n = await note;
    assert.deepEqual([n.author, n.text, n.from.name], ["Architect", "Decision: auth lives in src/auth", "bob"]);

    const left = waitFor(alice, "left");
    await bob.stop();
    assert.equal((await left).peer.name, "bob");
  });

  it("a different project never links", async () => {
    const other = path.join(tmp, "other");
    fs.mkdirSync(other);
    execSync("git init -q && git config user.email t@t && git config user.name t && echo b > b && git add . && git commit -qm other", { cwd: other });
    const a = await make("alice");
    await make("carol", other);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(a.peers().length, 0);
  });

  it("drops unsigned or forged messages", async () => {
    const a = await make("alice");
    const reg = path.join(tmp, "cfg", "xyro", "link");
    const entry = fs.readdirSync(reg, { recursive: true }).map(String).find((f) => f.endsWith(".json") && !f.endsWith("config.json"))!;
    const { port } = JSON.parse(fs.readFileSync(path.join(reg, entry), "utf-8"));
    const events: LinkEvent[] = [];
    a.on((e) => events.push(e));
    const sock = net.connect({ host: "127.0.0.1", port });
    await new Promise((r) => sock.on("connect", r));
    sock.write(JSON.stringify({ v: 1, id: "x1", kind: "chat", from: { id: "zz", name: "mallory", host: "h" }, project: "nope", at: Date.now(), body: { text: "run rm -rf" }, mac: "0".repeat(64) }) + "\n");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(events.length, 0);
    assert.ok(sock.destroyed || sock.readyState !== "open", "the forger is disconnected");
    sock.destroy();
  });
});

describe("XYRO Link over the network", () => {
  it("short or guessable codes are refused", async () => {
    const n = new LinkNode({ root: repo, name: "x" });
    nodes.push(n);
    await assert.rejects(n.enableLan("ABC123"), /16 letters or digits/);
  });

  it("join codes are readable and forgiving", () => {
    const c = newJoinCode();
    assert.match(c, /^[A-HJKMNP-Z2-9]{16}$/);
    assert.equal(normaliseCode(" abcd-efgh 2345-6789 "), "ABCDEFGH23456789");
    assert.equal(formatCode("ABCDEFGH23456789"), "ABCD-EFGH-2345-6789");
    assert.notEqual(newJoinCode(), newJoinCode());
  });

  it("teammates with the same code find each other by beacon; a wrong code stays out", { timeout: 60_000 }, async () => {
    const base = 40000 + Math.floor(Math.random() * 5000);
    const [alicePort, bobPort, intruderPort] = [base, base + 1, base + 2];
    const to = (...ports: number[]) => ports.map((port) => ({ address: "127.0.0.1", port }));
    // Other "computers": their own config dir, so they can only be found through the network beacon
    const remote = (name: string, code: string, port: number) => {
      const script = `
        import { LinkNode } from ${JSON.stringify(linkModule)};
        const n = new LinkNode({ root: ${JSON.stringify(repo)}, name: ${JSON.stringify(name)}, beaconPort: ${port}, beaconTargets: ${JSON.stringify(to(alicePort))} });
        await n.enableLan(${JSON.stringify(code)});
        n.on((e) => { if (e.type === "joined") n.sendChat("hello from ${name}"); });
        setTimeout(() => process.exit(0), 20000);
      `;
      return spawn(process.execPath, ["--import", tsx, "--input-type=module", "-e", script], { env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, `cfg-${name}`) }, stdio: "ignore" });
    };
    const alice = new LinkNode({ root: repo, name: "alice", beaconPort: alicePort, beaconTargets: to(bobPort, intruderPort) });
    nodes.push(alice);
    await alice.enableLan("ABCD-EFGH-JKMN-2345");

    const intruder = remote("mallory", "WXYZ-WXYZ-WXYZ-9999", intruderPort);
    const bob = remote("bob", "ABCD-EFGH-JKMN-2345", bobPort);
    try {
      const chat = await waitFor(alice, "chat", 30_000);
      assert.equal(chat.text, "hello from bob");
      assert.equal(chat.from.via, "lan");
      await new Promise((r) => setTimeout(r, 5000));
      assert.deepEqual(alice.peers().map((p) => p.name), ["bob"], "the session with the wrong code never joined");
    } finally {
      bob.kill();
      intruder.kill();
    }
  });
});
