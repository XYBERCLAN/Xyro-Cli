#!/usr/bin/env node
// Decide the next release from the commits since the last tag (Conventional Commits).
//
//   feat: …                     → minor   (a new capability)
//   fix: / perf: / revert: …    → patch   (users get a better XYRO)
//   type!: … / BREAKING CHANGE  → major   (minor while still 0.x)
//   docs/chore/test/ci/style/build/refactor only → none (nothing users would notice)
//   "[release]" anywhere        → at least patch;  "[skip release]" → none
//
// Prints one word: major | minor | patch | none

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** @param {string[]} messages full commit messages, @param {string} version current version */
export function computeBump(messages, version = "1.0.0") {
  let bump = "none";
  const raise = (b) => {
    if (RANK[b] > RANK[bump]) bump = b;
  };
  for (const msg of messages) {
    if (/\[skip release\]/i.test(msg)) continue;
    const subject = msg.split("\n")[0];
    if (/^chore\(release\)/i.test(subject)) continue;
    const m = subject.match(/^(\w+)(\([^)]*\))?(!)?:/);
    const breaking = Boolean(m?.[3]) || /^BREAKING[ -]CHANGE:/m.test(msg);
    if (breaking) raise(version.startsWith("0.") ? "minor" : "major");
    else if (m && m[1] === "feat") raise("minor");
    else if (m && ["fix", "perf", "revert", "security"].includes(m[1])) raise("patch");
    if (/\[release\]/i.test(msg)) raise("patch");
  }
  return bump;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let range = "HEAD";
  try {
    range = `${git(["describe", "--tags", "--abbrev=0", "--match", "v*"])}..HEAD`;
  } catch {
    // no tag yet: every commit counts
  }
  const raw = git(["log", range, "--format=%B%x00"]);
  const messages = raw.split("\0").map((m) => m.trim()).filter(Boolean);
  const version = JSON.parse(readFileSync("package.json", "utf-8")).version;
  process.stdout.write(computeBump(messages, version));
}
