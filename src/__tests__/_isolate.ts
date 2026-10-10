// Loaded before every test file (see the "test" scripts in package.json).
// Tests must never touch the developer's real XYRO: no saved API keys, no
// quota, no conversations, no network calls on their account. Each test
// process gets its own empty config and data folders; tests that need a
// specific setup create it inside these.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-test-home-"));
process.env.XDG_CONFIG_HOME = path.join(root, "config");
process.env.XDG_DATA_HOME = path.join(root, "data");
process.env.XYRO_LINK = "off";
// Fake providers answer instantly and get many requests a minute; tests/pacing turns it back on
process.env.XYRO_NO_PACING = "1";
for (const key of Object.keys(process.env)) {
  if (/^(OPENAI|ANTHROPIC|GEMINI|GOOGLE|GROQ|OPENROUTER|XYRO)_API_KEY$|^XYRO_(BASE_URL|MODEL)$/.test(key)) delete process.env[key];
}
