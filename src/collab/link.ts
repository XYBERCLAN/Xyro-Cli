// XYRO Link — XYRO sessions on the same project find each other and talk.
//
//   Same computer: automatic. Each session registers itself in
//     ~/.config/xyro/link/<project>/<session>.json and signs messages with a
//     secret only your user account can read.
//   Same network: opt-in. `/link lan` prints a short join code; on the other
//     machine `/link join <code>`. Sessions announce themselves with a UDP
//     broadcast beacon; every message is signed with a key derived from the
//     code, so others on the network can neither read the beacon's project
//     nor inject anything into your experts.
//
// What flows between linked sessions: chat between users (/chat), and the
// team board — experts' notes, proposals and council decisions — so every
// session's experts see what the others decided. Nothing runs remotely: a
// message is text to read, never a command.
//
// Wire format: one JSON object per line over TCP, full mesh (each pair of
// sessions keeps one connection, opened by the session with the smaller id).

import * as fs from "node:fs";
import * as net from "node:net";
import * as dgram from "node:dgram";
import * as os from "node:os";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { getConfigDir } from "../config/platform.js";

export const BEACON_PORT = 47321;
const BEACON_EVERY_MS = 4000;
const REGISTRY_SCAN_MS = 2000;
const PEER_TIMEOUT_MS = 15_000;
const MAX_LINE = 64 * 1024;
const MAX_AGE_MS = 5 * 60_000;

export interface PeerInfo {
  id: string;
  name: string;
  host: string;
  /** "local" (same computer) or "lan" */
  via: "local" | "lan";
}

export type LinkEvent =
  | { type: "chat"; from: PeerInfo; text: string; at: number }
  | { type: "note"; from: PeerInfo; author: string; text: string; at: number }
  | { type: "joined"; peer: PeerInfo }
  | { type: "left"; peer: PeerInfo };

interface Wire {
  v: 1;
  id: string; // message id (dedupe)
  kind: "hello" | "chat" | "note" | "bye";
  from: { id: string; name: string; host: string };
  project: string;
  at: number;
  body?: { text?: string; author?: string };
  mac?: string;
}

// ─── identity ───────────────────────────────────────────────────────────────

/** Same project on every machine: the repository's first commit (else the folder name). */
export function projectIdFor(root: string): string {
  try {
    const first = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split("\n")
      .sort()[0];
    if (first) return `git:${first}`;
  } catch {
    // not a git repo
  }
  return `dir:${basename(root)}`;
}

function shortHash(s: string, n = 16): string {
  return createHash("sha256").update(s).digest("hex").slice(0, n);
}

function linkDir(project: string): string {
  return join(getConfigDir(), "link", shortHash(project));
}

interface LinkConfig {
  /** LAN join code per project hash */
  lan?: Record<string, string>;
}

function configPath(): string {
  return join(getConfigDir(), "link", "config.json");
}

function readConfig(): LinkConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8")) as LinkConfig;
  } catch {
    return {};
  }
}

function writeConfig(c: LinkConfig): void {
  fs.mkdirSync(join(getConfigDir(), "link"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

/** Secret for same-computer links: created once, readable only by you. */
function localSecret(project: string): string {
  const dir = linkDir(project);
  const p = join(dir, "secret");
  try {
    return fs.readFileSync(p, "utf-8").trim();
  } catch {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const s = randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(p, s, { mode: 0o600, flag: "wx" });
      return s;
    } catch {
      return fs.readFileSync(p, "utf-8").trim(); // another session created it first
    }
  }
}

/**
 * Join codes: 16 characters from a 32-letter alphabet with no look-alikes
 * (80 bits), shown in groups of four. Long enough that guessing it offline
 * from a captured beacon is hopeless, especially behind scrypt (see key()).
 */
export const JOIN_CODE_LENGTH = 16;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 symbols, no 0/O/1/I/L

export function newJoinCode(): string {
  // Rejection sampling keeps every symbol equally likely
  const out: string[] = [];
  while (out.length < JOIN_CODE_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < JOIN_CODE_LENGTH) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    }
  }
  return out.join("");
}

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS" */
export function formatCode(code: string): string {
  return normaliseCode(code).replace(/(.{4})(?=.)/g, "$1-");
}

/** Slow, project-salted key from a join code: each guess costs ~32 MB and tens of ms. */
function deriveLanKey(project: string, code: string): string {
  return scryptSync(normaliseCode(code), `xyro-link:${project}`, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
}

function displayName(): string {
  try {
    const n = execFileSync("git", ["config", "user.name"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (n) return n;
  } catch {
    // no git name
  }
  try {
    return os.userInfo().username;
  } catch {
    return "someone";
  }
}

function sign(key: string, w: Omit<Wire, "mac">): string {
  return createHmac("sha256", key).update(JSON.stringify(w)).digest("hex");
}

function verify(key: string, w: Wire): boolean {
  if (typeof w.mac !== "string" || w.mac.length !== 64) return false;
  const { mac, ...rest } = w;
  const expected = Buffer.from(sign(key, rest), "hex");
  const got = Buffer.from(mac, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ─── the node ───────────────────────────────────────────────────────────────

interface Conn {
  socket: net.Socket;
  peer?: PeerInfo;
  buf: string;
}

export interface LinkOptions {
  root: string;
  name?: string;
  /** Port this session listens on for beacons (default 47321) */
  beaconPort?: number;
  /** Where beacons go (default: broadcast to the beacon port). Tests simulate separate computers with explicit targets. */
  beaconTargets?: { address: string; port: number }[];
}

export class LinkNode {
  readonly id = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  readonly name: string;
  readonly host = os.hostname();
  readonly project: string;
  private server: net.Server | null = null;
  private port = 0;
  private conns = new Set<Conn>();
  private seen = new Map<string, number>();
  private listeners = new Set<(e: LinkEvent) => void>();
  private timers: NodeJS.Timeout[] = [];
  private udp: dgram.Socket | null = null;
  private lanCode: string | null = null;
  private dialing = new Set<string>();
  private lanKey: { code: string; key: string } | null = null;
  private opts: LinkOptions;

  constructor(opts: LinkOptions) {
    this.opts = opts;
    this.project = projectIdFor(opts.root);
    this.name = opts.name ?? displayName();
    this.lanCode = readConfig().lan?.[shortHash(this.project)] ?? null;
  }

  /** Same key for every session of this project that you (or your LAN team, via the code) run. */
  private key(): string {
    if (!this.lanCode) return `local:${localSecret(this.project)}`;
    if (this.lanKey?.code !== this.lanCode) this.lanKey = { code: this.lanCode, key: deriveLanKey(this.project, this.lanCode) };
    return `lan:${this.lanKey.key}`;
  }

  on(fn: (e: LinkEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: LinkEvent): void {
    for (const l of this.listeners) l(e);
  }

  get lanEnabled(): boolean {
    return this.lanCode !== null;
  }

  get joinCode(): string | null {
    return this.lanCode;
  }

  peers(): PeerInfo[] {
    const out = new Map<string, PeerInfo>();
    for (const c of this.conns) if (c.peer) out.set(c.peer.id, c.peer);
    return [...out.values()];
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = net.createServer((socket) => this.adopt(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      // LAN sessions must accept connections from other machines
      this.server!.listen(0, this.lanCode ? "0.0.0.0" : "127.0.0.1", () => resolve());
    });
    this.port = (this.server.address() as net.AddressInfo).port;
    this.server.unref(); // linking never keeps XYRO running on its own
    this.register();
    this.timers.push(setInterval(() => this.scanRegistry(), REGISTRY_SCAN_MS));
    this.scanRegistry();
    if (this.lanCode) this.startBeacon();
    for (const t of this.timers) t.unref();
  }

  async stop(): Promise<void> {
    this.broadcast("bye", {});
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try {
      fs.rmSync(join(linkDir(this.project), `${this.id}.json`), { force: true });
    } catch {
      // ignore
    }
    for (const c of this.conns) c.socket.destroy();
    this.conns.clear();
    this.udp?.close();
    this.udp = null;
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }

  /** Turn LAN linking on with a new code (or the given one), and restart listening. */
  async enableLan(code?: string): Promise<string> {
    const c = code ? normaliseCode(code) : newJoinCode();
    if (c.length < JOIN_CODE_LENGTH) throw new Error(`join codes have ${JOIN_CODE_LENGTH} letters or digits (like ${formatCode("ABCDEFGHJKMNPQRS")})`);
    const cfg = readConfig();
    cfg.lan = { ...(cfg.lan ?? {}), [shortHash(this.project)]: c };
    writeConfig(cfg);
    this.lanCode = c;
    await this.restart();
    return c;
  }

  async disableLan(): Promise<void> {
    const cfg = readConfig();
    if (cfg.lan) delete cfg.lan[shortHash(this.project)];
    writeConfig(cfg);
    this.lanCode = null;
    await this.restart();
  }

  private async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  sendChat(text: string): number {
    const t = text.trim().slice(0, 4000);
    if (!t) return 0;
    return this.broadcast("chat", { text: t });
  }

  shareNote(author: string, text: string): number {
    return this.broadcast("note", { author, text: text.slice(0, 2000) });
  }

  // ─── discovery: same computer ─────────────────────────────────────────────

  private register(): void {
    const dir = linkDir(this.project);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(dir, `${this.id}.json`), JSON.stringify({ id: this.id, port: this.port, pid: process.pid, name: this.name }), { mode: 0o600 });
  }

  private scanRegistry(): void {
    // Another session on this computer joined (or left) a LAN code: follow it
    const code = readConfig().lan?.[shortHash(this.project)] ?? null;
    if (code !== this.lanCode) {
      this.lanCode = code;
      void this.restart();
      return;
    }
    const dir = linkDir(this.project);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    for (const f of files) {
      try {
        const e = JSON.parse(fs.readFileSync(join(dir, f), "utf-8")) as { id: string; port: number; pid: number };
        if (e.id === this.id) continue;
        if (!pidAlive(e.pid)) {
          fs.rmSync(join(dir, f), { force: true });
          continue;
        }
        this.dial(e.id, "127.0.0.1", e.port, "local");
      } catch {
        // half-written entry: next scan
      }
    }
  }

  // ─── discovery: same network ──────────────────────────────────────────────

  /** Peers with a different code (or project) can't produce this tag; the nonce makes every beacon different. */
  private beaconTag(nonce: string): string {
    return createHmac("sha256", this.key()).update(`beacon:${nonce}:${this.project}`).digest("hex").slice(0, 32);
  }

  private startBeacon(): void {
    const port = this.opts.beaconPort ?? BEACON_PORT;
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.udp = sock;
    sock.on("error", () => {
      // no network / port taken: same-computer linking still works
    });
    sock.on("message", (msg, rinfo) => {
      try {
        const b = JSON.parse(msg.toString()) as { xyro: 1; nonce: string; tag: string; id: string; port: number };
        if (b.xyro !== 1 || b.id === this.id || typeof b.nonce !== "string" || b.nonce.length > 64) return;
        const expected = Buffer.from(this.beaconTag(b.nonce));
        const got = Buffer.from(String(b.tag));
        if (expected.length !== got.length || !timingSafeEqual(expected, got)) return;
        this.dial(b.id, rinfo.address, b.port, "lan");
      } catch {
        // not ours
      }
    });
    sock.unref();
    sock.bind(port, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        // ignore
      }
      const send = () => {
        const nonce = randomBytes(12).toString("hex");
        const payload = Buffer.from(JSON.stringify({ xyro: 1, nonce, tag: this.beaconTag(nonce), id: this.id, port: this.port }));
        for (const t of this.opts.beaconTargets ?? [{ address: "255.255.255.255", port }]) sock.send(payload, t.port, t.address, () => undefined);
      };
      send();
      const t = setInterval(send, BEACON_EVERY_MS);
      t.unref();
      this.timers.push(t);
    });
  }

  // ─── connections ──────────────────────────────────────────────────────────

  private connectedTo(id: string): boolean {
    for (const c of this.conns) if (c.peer?.id === id) return true;
    return false;
  }

  /** One connection per pair: the session with the smaller id dials. */
  private dial(peerId: string, host: string, port: number, via: "local" | "lan"): void {
    if (this.id > peerId || this.connectedTo(peerId) || this.dialing.has(peerId)) return;
    this.dialing.add(peerId);
    const socket = net.connect({ host, port }, () => {
      this.dialing.delete(peerId);
      const conn = this.adopt(socket, via);
      this.send(conn, this.wire("hello", {}));
    });
    socket.on("error", () => this.dialing.delete(peerId));
    socket.setTimeout(PEER_TIMEOUT_MS, () => socket.destroy());
  }

  private adopt(socket: net.Socket, via: "local" | "lan" = socket.remoteAddress === "127.0.0.1" || socket.remoteAddress === "::ffff:127.0.0.1" ? "local" : "lan"): Conn {
    const conn: Conn = { socket, buf: "" };
    socket.unref();
    this.conns.add(conn);
    socket.setEncoding("utf-8");
    // Strangers must prove themselves (a signed hello) quickly, or they are dropped
    socket.setTimeout(PEER_TIMEOUT_MS, () => {
      if (!conn.peer) socket.destroy();
    });
    socket.on("data", (chunk: string) => {
      conn.buf += chunk;
      if (conn.buf.length > MAX_LINE * 4) return socket.destroy();
      let i: number;
      while ((i = conn.buf.indexOf("\n")) !== -1) {
        const line = conn.buf.slice(0, i);
        conn.buf = conn.buf.slice(i + 1);
        if (line.length <= MAX_LINE) this.receive(conn, line, via);
      }
    });
    const gone = () => {
      if (!this.conns.delete(conn)) return;
      if (conn.peer && !this.connectedTo(conn.peer.id)) this.emit({ type: "left", peer: conn.peer });
    };
    socket.on("close", gone);
    socket.on("error", gone);
    return conn;
  }

  private wire(kind: Wire["kind"], body: Wire["body"]): Wire {
    const w: Omit<Wire, "mac"> = { v: 1, id: randomBytes(8).toString("hex"), kind, from: { id: this.id, name: this.name, host: this.host }, project: shortHash(this.project), at: Date.now(), body };
    return { ...w, mac: sign(this.key(), w) };
  }

  private send(conn: Conn, w: Wire): void {
    if (!conn.socket.destroyed) conn.socket.write(JSON.stringify(w) + "\n");
  }

  private broadcast(kind: Wire["kind"], body: Wire["body"]): number {
    const w = this.wire(kind, body);
    let n = 0;
    for (const c of this.conns) {
      if (!c.peer) continue;
      this.send(c, w);
      n++;
    }
    return n;
  }

  private receive(conn: Conn, line: string, via: "local" | "lan"): void {
    let w: Wire;
    try {
      w = JSON.parse(line) as Wire;
    } catch {
      return;
    }
    // Unsigned, foreign-project, stale or replayed messages are dropped
    if (w?.v !== 1 || w.project !== shortHash(this.project) || !verify(this.key(), w)) {
      if (!conn.peer) conn.socket.destroy();
      return;
    }
    if (Math.abs(Date.now() - w.at) > MAX_AGE_MS || this.seen.has(w.id)) return;
    this.seen.set(w.id, w.at);
    if (this.seen.size > 2000) for (const k of [...this.seen.keys()].slice(0, 1000)) this.seen.delete(k);

    const peer: PeerInfo = { id: String(w.from.id), name: String(w.from.name).slice(0, 60), host: String(w.from.host).slice(0, 60), via };
    if (!conn.peer) {
      if (this.connectedTo(peer.id)) {
        conn.socket.destroy(); // duplicate link to the same session
        return;
      }
      conn.peer = peer;
      conn.socket.setTimeout(0);
      if (w.kind === "hello") this.send(conn, this.wire("hello", {}));
      this.emit({ type: "joined", peer });
    }
    if (w.kind === "chat" && w.body?.text) this.emit({ type: "chat", from: peer, text: String(w.body.text).slice(0, 4000), at: w.at });
    else if (w.kind === "note" && w.body?.text) this.emit({ type: "note", from: peer, author: String(w.body.author ?? "XYRO").slice(0, 60), text: String(w.body.text).slice(0, 2000), at: w.at });
    else if (w.kind === "bye") conn.socket.destroy();
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function describePeer(p: PeerInfo): string {
  return `${p.name}${p.via === "lan" ? ` @ ${p.host}` : " (this computer)"}`;
}
