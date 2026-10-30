# Releasing XYRO

Releases are cut by CI. Nobody publishes from a laptop.

## Automatic (the default)

Every push to `main` that users would notice is published to npm by [`auto-release.yml`](../.github/workflows/auto-release.yml). The commit messages decide the version:

| Commit type | Release |
|---|---|
| `feat:` | minor |
| `fix:` · `perf:` · `revert:` | patch |
| `type!:` or a `BREAKING CHANGE` footer | major |
| `docs:` · `chore:` · `test:` · `ci:` · `refactor:` only | nothing is published |

- Add `[release]` to a commit message to force a patch release, or `[skip release]` to skip one.
- A version that was tagged but never reached npm is published on the next run.
- Users on an older XYRO see a "new version" pop-up on their next launch and can install it with `/update`.

Pull requests are squash-merged, so the PR title becomes the commit message on `main`: give it the right type.

## Manual

1. **Actions → Release → Run workflow**, then pick `patch`, `minor`, `major` or `prerelease`. From a terminal with the GitHub CLI: `npm run release`, `npm run release:minor` or `npm run release:major`.
2. [`release.yml`](../.github/workflows/release.yml) typechecks, builds, runs the tests, bumps `package.json`, tags `vX.Y.Z`, publishes to npm with provenance and creates a GitHub Release with generated notes.
3. Pre-releases go to the `next` dist-tag, so `npm install -g xyro-cli` stays on the stable version.

Pushing a `v*` tag by hand (`npm version patch && git push --follow-tags`) runs the same checks through [`publish.yml`](../.github/workflows/publish.yml), which skips versions already on npm.

## One-time setup

- **npm:** set up Trusted Publishing for `xyro-cli` on npmjs.com (Settings → Trusted publishing). The workflows fall back to an `NPM_TOKEN` repository secret (an npm automation token) when it isn't set up.
- **GitHub:** if `main` is branch-protected, allow `github-actions[bot]` to push the version commit.
