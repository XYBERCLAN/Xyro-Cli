import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { compareVersions, xyroVersion } from "../version.js";
import { checkForUpdate } from "../update/updater.js";

describe("compareVersions", () => {
  it("orders major / minor / patch numerically", () => {
    assert.ok(compareVersions("0.3.0", "0.4.0") < 0);
    assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
    assert.ok(compareVersions("1.0.0", "1.0.0") === 0);
    assert.ok(compareVersions("v1.2.3", "1.2.3") === 0);
  });

  it("sorts a pre-release before its release", () => {
    assert.ok(compareVersions("1.5.0-beta.2", "1.5.0") < 0);
    assert.ok(compareVersions("1.5.0-beta.10", "1.5.0-beta.2") > 0);
  });
});

describe("xyroVersion", () => {
  it("reads the version from package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    assert.equal(xyroVersion(), pkg.version);
  });
});

describe("checkForUpdate", () => {
  let realFetch: typeof fetch;
  let oldXdg: string | undefined;
  let oldCi: string | undefined;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    oldXdg = process.env.XDG_CONFIG_HOME;
    oldCi = process.env.CI;
    // Isolated config dir so the 12h cache never leaks between tests
    process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-update-"));
    delete process.env.CI;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldXdg;
    if (oldCi !== undefined) process.env.CI = oldCi;
  });

  it("reports an update when npm has a newer version", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ version: "999.0.0" }), { status: 200 })) as typeof fetch;
    const info = await checkForUpdate({ force: true });
    assert.ok(info);
    assert.equal(info!.latest, "999.0.0");
    assert.equal(info!.updateAvailable, true);
  });

  it("reports no update when already on the latest", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ version: xyroVersion() }), { status: 200 })) as typeof fetch;
    const info = await checkForUpdate({ force: true });
    assert.equal(info!.updateAvailable, false);
  });

  it("returns null when the registry is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    assert.equal(await checkForUpdate({ force: true }), null);
  });

  it("uses the cache instead of the network within 12 hours", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ version: "999.0.0" }), { status: 200 });
    }) as typeof fetch;
    await checkForUpdate();
    await checkForUpdate();
    assert.equal(calls, 1);
  });

  it("is skipped in CI", async () => {
    process.env.CI = "true";
    assert.equal(await checkForUpdate(), null);
  });
});

describe("Launch pop-up for new versions", () => {
  it("announces each version once, then again after a few days", async () => {
    const { shouldAnnounce, markAnnounced } = await import("../update/updater.js");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    const oldCi = process.env.CI;
    delete process.env.CI;
    process.env.XDG_CONFIG_HOME = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "xyro-announce-"));
    try {
      assert.equal(shouldAnnounce("1.4.0"), true);
      markAnnounced("1.4.0");
      assert.equal(shouldAnnounce("1.4.0"), false, "not twice in a row");
      assert.equal(shouldAnnounce("1.5.0"), true, "a newer version is announced");
      assert.equal(shouldAnnounce("1.4.0", Date.now() + 4 * 24 * 3600_000), true, "reminds after a few days");
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
      if (oldCi !== undefined) process.env.CI = oldCi;
    }
  });

  it("turns GitHub release notes into a short what's-new list", async () => {
    const { summarizeNotes } = await import("../update/updater.js");
    const md = "## What's Changed\n* feat(agents): expert council by @dev in https://github.com/x/y/pull/12\n* fix: flicker in [side panel](https://x)\n\n**Full Changelog**: v1...v2";
    assert.deepEqual(summarizeNotes(md), ["expert council", "flicker in side panel"]);
  });

  it("fetches notes for the version and shows them in the pop-up", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      if (req.url === "/repos/XYBERCLAN/Xyro-Cli/releases/tags/v9.9.9") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ body: "* feat: animated expert mascots\n* fix: faster start" }));
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    process.env.XYRO_GITHUB_API = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const { fetchReleaseNotes } = await import("../update/updater.js");
      const notes = await fetchReleaseNotes("9.9.9");
      assert.deepEqual(notes, ["animated expert mascots", "faster start"]);
      assert.equal(await fetchReleaseNotes("0.0.1"), null);
      const { UpdateModal } = await import("../tui/overlays.js");
      const m = new UpdateModal();
      m.set({ kind: "available", current: "0.2.0", latest: "9.9.9", method: "npm install -g xyro-cli@9.9.9", notes: notes!, announce: true });
      const text = m.render(90).map((l) => l.spans.map((s) => s.text).join("")).join("\n");
      assert.match(text, /XYRO v9\.9\.9 is here/);
      assert.match(text, /WHAT'S NEW/);
      assert.match(text, /animated expert mascots/);
      assert.match(text, /enter update now\s+esc later/);
    } finally {
      server.close();
      delete process.env.XYRO_GITHUB_API;
    }
  });
});
