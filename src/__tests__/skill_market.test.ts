import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseGithubSource, installSkill } from "../agents/skill-market.js";
import { findSkill } from "../agents/skills-catalog.js";
import { executeTool } from "../tools/registry.js";

let server: http.Server;
let base = "";
let evilDownload = false;

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const json = (o: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (url.startsWith("/repos/acme/skills/contents/skills/pdf")) {
      return json([
        { name: "SKILL.md", path: "skills/pdf/SKILL.md", type: "file", size: 100, download_url: evilDownload ? "https://evil.example/SKILL.md" : `${base}/raw/pdf/SKILL.md` },
        { name: "forms.md", path: "skills/pdf/forms.md", type: "file", size: 50, download_url: `${base}/raw/pdf/forms.md` },
        { name: "big.bin", path: "skills/pdf/big.bin", type: "file", size: 5, download_url: `${base}/raw/pdf/big.bin` },
        { name: "scripts", path: "skills/pdf/scripts", type: "dir", size: 0, download_url: null },
      ]);
    }
    if (url.startsWith("/repos/acme/skills/contents/skills/nodesc")) {
      return json([{ name: "SKILL.md", path: "x", type: "file", size: 10, download_url: `${base}/raw/nodesc/SKILL.md` }]);
    }
    if (url === "/raw/pdf/SKILL.md") return res.end("---\nname: pdf\ndescription: Fill and merge PDF forms\n---\n# PDF\nUse pypdf to fill forms.\n");
    if (url === "/raw/pdf/forms.md") return res.end("Form field reference");
    if (url === "/raw/nodesc/SKILL.md") return res.end("---\nname: nodesc\n---\nbody");
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.XYRO_GITHUB_API = base;
});
after(() => {
  server.close();
  delete process.env.XYRO_GITHUB_API;
});

let tmp: string;
let oldCwd: string;
const oldEnv = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-market-"));
  process.env.HOME = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".cfg");
  oldCwd = process.cwd();
  process.chdir(tmp);
  evilDownload = false;
});
afterEach(() => {
  process.chdir(oldCwd);
  process.env.HOME = oldEnv.HOME;
  if (oldEnv.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldEnv.XDG;
});

describe("Skills from the web", () => {
  it("understands GitHub URLs and short forms", () => {
    assert.deepEqual(parseGithubSource("https://github.com/acme/skills/tree/main/skills/pdf"), { owner: "acme", repo: "skills", ref: "main", path: "skills/pdf" });
    assert.deepEqual(parseGithubSource("https://github.com/acme/skills/blob/v2/skills/pdf/SKILL.md"), { owner: "acme", repo: "skills", ref: "v2", path: "skills/pdf" });
    assert.deepEqual(parseGithubSource("acme/skills/skills/pdf"), { owner: "acme", repo: "skills", path: "skills/pdf" });
    assert.equal(parseGithubSource("not a source"), null);
  });

  it("installs SKILL.md and its text files, then the skill is usable right away", async () => {
    const out = await installSkill({ source: "acme/skills/skills/pdf" });
    assert.match(out, /Installed skill "pdf"/, out);
    assert.match(out, /Use pypdf to fill forms/, "shows what the skill says");
    const dir = path.join(tmp, ".cfg", "xyro", "skills", "pdf");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["SKILL.md", "forms.md"], "binary files and folders skipped");
    assert.equal(findSkill("pdf")?.description, "Fill and merge PDF forms");
    assert.match(await executeTool("skill_load", { name: "pdf" }), /Use pypdf to fill forms/);
    assert.match(await installSkill({ source: "acme/skills/skills/pdf" }), /already installed/);
  });

  it("refuses downloads from outside GitHub and skills without a description", async () => {
    evilDownload = true;
    assert.match(await installSkill({ source: "acme/skills/skills/pdf" }), /refused to download from https:\/\/evil\.example/);
    evilDownload = false;
    assert.match(await installSkill({ source: "acme/skills/skills/nodesc" }), /no description/);
    assert.match(await installSkill({ source: "acme/skills/skills/missing" }), /GitHub answered 404/);
  });
});
