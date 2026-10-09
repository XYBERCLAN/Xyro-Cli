import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_MODELS, filterModelCatalog, getAllModels, buildModelSections } from "../models/catalog.js";
import { getRecentModelIds, recordRecentModel } from "../models/recents.js";
import { ModelPicker } from "../tui/model-picker.js";

describe("Model Catalog", () => {
  it("contains pre-configured free and paid models", () => {
    assert.ok(DEFAULT_MODELS.length >= 15, "Should have at least 15 default models");

    const freeModels = DEFAULT_MODELS.filter((m) => m.isFree);
    assert.ok(freeModels.length >= 8, "Should have free models across providers");

    const paidModels = DEFAULT_MODELS.filter((m) => !m.isFree);
    assert.ok(paidModels.length >= 4, "Should have paid models for Claude/OpenAI/DeepSeek");

    for (const m of DEFAULT_MODELS) {
      assert.ok(m.id, "Model must have an id");
      assert.ok(m.name, "Model must have a display name");
      assert.ok(m.provider, "Model must specify its provider");
      assert.ok(m.badge === "FREE" || m.badge === "PAID" || m.badge === "LOCAL", "Model must have a valid badge");
    }
  });

  it("filters models by search query and category", () => {
    const gemini = filterModelCatalog("gemini");
    assert.ok(gemini.length > 0);
    assert.ok(gemini.every((m) => m.id.includes("gemini") || m.name.toLowerCase().includes("gemini")));

    const freeOnly = filterModelCatalog("free");
    assert.ok(freeOnly.length > 0);
    assert.ok(freeOnly.every((m) => m.isFree));

    const paidOnly = filterModelCatalog("paid");
    assert.ok(paidOnly.length > 0);
    assert.ok(paidOnly.every((m) => !m.isFree));
  });

  it("keeps the same model id from different providers in the catalog", () => {
    const all = getAllModels();
    const deepseekR1 = all.filter((m) => m.id === "deepseek/deepseek-r1:free");
    assert.ok(
      deepseekR1.length >= 2,
      "deepseek/deepseek-r1:free must exist under both OpenRouter and TokenRouter"
    );
    const providers = new Set(deepseekR1.map((m) => m.providerId));
    assert.ok(providers.has("openrouter"));
    assert.ok(providers.has("tokenrouter"));
  });
});

describe("Model Sections (Provider Grouping)", () => {
  it("groups models into RECENT, FREE, and PAID sections ordered by provider", () => {
    const sections = buildModelSections(getAllModels(), ["gpt-4o"]);

    const kinds = sections.map((s) => s.kind);
    assert.ok(kinds.includes("RECENT"), "Should have a RECENT section when recents exist");
    assert.ok(kinds.includes("FREE"), "Should have a FREE section");
    assert.ok(kinds.includes("PAID"), "Should have a PAID section");

    // RECENT must come first
    assert.equal(kinds[0], "RECENT");
    // FREE before PAID
    assert.ok(kinds.indexOf("FREE") < kinds.indexOf("PAID"));

    // RECENT contains exactly the recent id
    const recentSection = sections.find((s) => s.kind === "RECENT")!;
    const recentIds = recentSection.groups.flatMap((g) => g.models.map((m) => m.id));
    assert.ok(recentIds.includes("gpt-4o"));

    // FREE section must not contain any paid model
    const freeSection = sections.find((s) => s.kind === "FREE")!;
    for (const g of freeSection.groups) {
      for (const m of g.models) {
        assert.ok(m.isFree || m.badge === "LOCAL", `FREE section must only contain free/local models: ${m.id}`);
      }
    }

    // PAID section must not contain any free model
    const paidSection = sections.find((s) => s.kind === "PAID")!;
    for (const g of paidSection.groups) {
      for (const m of g.models) {
        assert.ok(!m.isFree, `PAID section must only contain paid models: ${m.id}`);
      }
    }

    // Each provider group only contains models from that provider
    for (const sec of sections) {
      for (const g of sec.groups) {
        for (const m of g.models) {
          assert.equal(m.providerId, g.providerId, `Model ${m.id} is in the wrong provider group`);
        }
      }
    }
  });

  it("omits the RECENT section when no recents are recorded", () => {
    const sections = buildModelSections(getAllModels(), []);
    assert.ok(!sections.some((s) => s.kind === "RECENT"));
    assert.equal(sections[0].kind, "FREE");
  });
});

describe("Recently Used Models", () => {
  function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "xyro-recents-"));
  }

  it("records and orders most recently used models first", () => {
    const dir = tmpDir();
    recordRecentModel("gemini-2.5-flash", dir);
    recordRecentModel("gpt-4o", dir);
    recordRecentModel("gemini-2.5-flash", dir); // re-use moves it to front

    const recents = getRecentModelIds(dir);
    assert.equal(recents[0], "gemini-2.5-flash");
    assert.equal(recents[1], "gpt-4o");
  });

  it("caps the recents list at 5 entries", () => {
    const dir = tmpDir();
    for (let i = 0; i < 8; i++) {
      recordRecentModel(`model-${i}`, dir);
    }
    const recents = getRecentModelIds(dir);
    assert.ok(recents.length <= 5);
    assert.equal(recents[0], "model-7");
  });
});

describe("ModelPicker TUI Component", () => {
  it("opens, navigates, and selects a model", () => {
    const picker = new ModelPicker();
    assert.strictEqual(picker.isOpen(), false);

    picker.open("gpt-4o");
    assert.strictEqual(picker.isOpen(), true);

    let selectedModel: string | null = null;
    picker.onSelect((id) => {
      selectedModel = id;
    });

    // Arrow down moves cursor
    picker.handleKey("\u001b[B");

    // Enter selects
    picker.handleKey("\r");
    assert.strictEqual(picker.isOpen(), false);
    assert.ok(selectedModel !== null);
  });

  it("filters on typing and closes on Escape", () => {
    const picker = new ModelPicker();
    picker.open("gemini-2.5-flash");

    let closed = false;
    picker.onClose(() => {
      closed = true;
    });

    // Type "claude"
    for (const ch of "claude") {
      picker.handleKey(ch);
    }

    const lines = picker.render(80);
    assert.ok(lines.length > 0, "Should render lines");

    // Escape closes
    picker.handleKey("\u001b");
    assert.strictEqual(picker.isOpen(), false);
    assert.strictEqual(closed, true);
  });
});
