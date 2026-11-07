import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadPersistedConfig, savePersistedConfig } from "../config/persist.js";

describe("Persisted config", () => {
  let tmp: string;
  let prevXdg: string | undefined;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-cfg-"));
    prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmp;
  });
  after(() => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips a saved config", () => {
    savePersistedConfig({ provider: "groq", providerKeys: { groq: "secret" } });
    const loaded = loadPersistedConfig();
    assert.equal(loaded.provider, "groq");
    assert.equal(loaded.providerKeys?.groq, "secret");
  });

  it("recovers from a corrupt file via the last known-good backup", () => {
    savePersistedConfig({ provider: "openai", providerKeys: { openai: "key1" } });
    const cfgPath = path.join(tmp, "xyro", "config.json");
    fs.writeFileSync(cfgPath, "{not json", "utf-8");
    const loaded = loadPersistedConfig();
    // The corrupt write is discarded; the last known-good (previous save) is restored.
    assert.equal(loaded.provider, "groq");
    assert.equal(loaded.providerKeys?.groq, "secret");
    const raw = fs.readFileSync(cfgPath, "utf-8");
    assert.ok(!raw.includes("not json"));
  });

  it("leaves no temp files behind (atomic write)", () => {
    savePersistedConfig({ language: "fr" });
    const dir = path.join(tmp, "xyro");
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));
    assert.equal(leftovers.length, 0);
  });
});