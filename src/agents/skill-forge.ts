// skill_forge — turn a verified win into a reusable skill.
//
// After XYRO solves something non-obvious in your project (a migration
// recipe, how to add an endpoint the house way, a tricky build fix), the
// procedure can be saved as .xyro/skills/<name>/SKILL.md so every expert can
// reuse it. The difference from writing a skill by hand: it must come with
// evidence. XYRO runs the check first and only saves the skill if it passes
// right now; the check, date and commit are written into the skill, and the
// skill starts with one verified win in its track record.

import * as fs from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { workspaceRoot } from "../agent/workspace.js";
import { isDangerousCommand } from "../tools/shell.js";
import { redactText } from "../providers/privacy.js";
import { discoverSkills, invalidateSkillCache } from "./skills-catalog.js";
import { recordSkillOutcome } from "./skill-stats.js";

export interface ForgeArgs {
  name: string;
  description: string;
  /** The procedure: when to use it, steps, pitfalls, a short example */
  body: string;
  /** Command that proves the procedure works in this project (exits 0) */
  check: string;
}

export async function forgeSkill(args: ForgeArgs): Promise<string> {
  const name = (args.name ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(name)) return "❌ skill_forge: `name` must be 2-50 lowercase letters, digits or dashes.";
  const description = (args.description ?? "").replace(/\s+/g, " ").trim();
  if (description.length < 20) return "❌ skill_forge: `description` must say when to use the skill (20+ characters).";
  const body = (args.body ?? "").trim();
  if (body.length < 80) return "❌ skill_forge: `body` is too short to be reusable: give the steps, pitfalls and a short example.";
  if (body.length > 12_000) return "❌ skill_forge: `body` is too long (max 12,000 characters). Keep the essentials.";
  if (redactText(body) !== body || redactText(description) !== description) return "❌ skill_forge: the skill looks like it contains a secret or personal data. Remove it and try again.";
  const check = (args.check ?? "").trim();
  if (!check) return "❌ skill_forge: `check` is required: a command that proves the procedure works here.";
  if (isDangerousCommand(check)) return "❌ skill_forge: refused, the check command is dangerous.";

  const root = workspaceRoot();
  const dir = join(root, ".xyro", "skills", name);
  if (fs.existsSync(dir) || discoverSkills(root).some((s) => s.name === name && s.source === "project")) return `❌ skill_forge: a project skill named "${name}" already exists.`;

  const res = await execa(check, { shell: true, cwd: root, reject: false, timeout: 10 * 60_000, all: true, env: { ...process.env, CI: "1", NO_COLOR: "1" } });
  if (res.exitCode !== 0 || res.timedOut) {
    const tail = String(res.all ?? "").split("\n").filter(Boolean).slice(-8).join("\n");
    return `❌ Not saved: the evidence check fails right now (${res.timedOut ? "timed out" : `exit ${res.exitCode}`}). A skill is only saved from work that verifiably works.\n${tail}`;
  }
  const sha = await execa("git", ["rev-parse", "--short", "HEAD"], { cwd: root, reject: false });
  const at = sha.exitCode === 0 ? ` at commit ${String(sha.stdout).trim()}` : "";
  const date = new Date().toISOString().slice(0, 10);
  const yaml = (v: string) => JSON.stringify(v);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${yaml(description)}\nevidence: ${yaml(`\`${check}\` passed on ${date}${at}`)}\nforged-by: xyro\n---\n\n${body}\n`
  );
  invalidateSkillCache();
  recordSkillOutcome([name], true);
  return `✅ Forged skill "${name}" in .xyro/skills/${name}/SKILL.md (evidence: \`${check}\` passed${at}). Experts will load it when a task matches; its track record decides whether it keeps being used.`;
}
