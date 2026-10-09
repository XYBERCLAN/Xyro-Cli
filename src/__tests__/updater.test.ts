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
