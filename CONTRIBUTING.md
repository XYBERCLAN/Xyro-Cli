# Contributing to XYRO

Thank you for your interest in contributing to XYRO! Please follow the steps below to set up your development environment and submit changes.

## Prerequisites

- Node.js 20 or newer
- npm
- Git
- An OpenAI-compatible provider and API key if you want to run the interactive agent locally

XYRO is written in TypeScript and tested in CI on Node.js 20 and 22.

## Getting Started

### Fork and Clone the Repository

```bash
git clone https://github.com/XYBERCLAN/Xyro-Cli.git
cd Xyro-Cli
```

### Create a New Branch

```bash
git checkout -b your-branch-name
```

### Install Dependencies

```bash
npm install
```

No `.env` file is required for the test suite. For local interactive use, configure a provider through XYRO's first-run setup or use the options documented in the [README](README.md), such as `--provider`, `--api-key`, `--base-url`, and `--model`.

### Run the Project

```bash
npm run dev
```

To compile and run the production build:

```bash
npm run build
npm start
```

## Project Structure

| Folder or file | Description |
|---|---|
| `src/index.ts` | CLI entry point and command-line startup |
| `src/agent/` | Core agent loop, sessions, history, commands, intents, learning, and workspace handling |
| `src/agents/` | Expert agents, councils, teams, tournaments, skills, routing, and worktrees |
| `src/tools/` | Agent tools for file access, shell commands, search, git, planning, delegation, MCP, and web search |
| `src/providers/` | OpenAI-compatible provider access, provider pools, failover, and privacy handling |
| `src/models/` | Model catalogues, live model discovery, fetching, and recent models |
| `src/config/` | Configuration loading, persistence, platform settings, plugins, skills, languages, and constants |
| `src/tui/` | Terminal UI components, layouts, selectors, overlays, mascot, and interactive pickers |
| `src/ui/` | Shared prompts, rendering, and terminal theme helpers |
| `src/mcp/` | Model Context Protocol approvals, management, and server functionality |
| `src/plugins/` | Claude Code plugin loading and plugin commands |
| `src/collab/` | Collaboration and linked-session functionality |
| `src/update/` | Background update checks and update behavior |
| `src/__tests__/` | Automated tests for the agent, tools, providers, TUI, plugins, collaboration, and other features |
| `scripts/` | Development and release-support scripts |
| `.github/workflows/` | CI, provider health checks, releases, and npm publishing workflows |
| `.agents/skills/` | Repository-local skills and reference material |
| `package.json` | Project metadata, dependencies, and npm scripts |
| `tsconfig.json` | Strict TypeScript compiler configuration |
| `README.md` | User documentation, architecture, usage, and release notes |
| `TODO.md` | Current development tasks and planned work |
| `dist/` | Generated build output; do not commit it |

## Development Commands

```bash
npm run dev                 # Run the CLI from TypeScript source
npm run lint                # Type-check without emitting files
npm run build               # Compile TypeScript into dist/
npm test                    # Run the test suite
npm run test:watch          # Run tests in watch mode
npm run test:coverage      # Run tests and generate coverage
npm run test:coverage:ci   # Run the CI coverage gate
npm start                   # Run the compiled application
```

Before opening a pull request, run:

```bash
npm run lint
npm run build
npm test
npm run test:coverage:ci
```

## Making Changes

- Keep changes focused and follow the existing TypeScript patterns.
- Add or update tests for bug fixes and new behavior.
- Update the README when commands, configuration, or user-facing behavior changes.
- Do not commit API keys, tokens, private keys, passwords, `.env` files, generated `dist/` output, or local test files.
- For terminal UI changes, include screenshots or a short terminal recording when useful.

## Pull Requests

1. Make sure your branch is up to date with `main`.
2. Describe the problem and solution clearly.
3. Include the validation commands you ran.
4. Keep each pull request focused on one change where possible.
5. Make sure all CI checks pass before requesting review.

Pull requests targeting `main` run type checking, builds, tests, and coverage checks on GitHub Actions.

## Commit Messages

Use concise, descriptive commit messages. Conventional prefixes are recommended:

- `feat:` for a new feature
- `fix:` for a bug fix
- `perf:` for a performance improvement
- `revert:` for a reversal
- `docs:`, `test:`, `chore:`, and `ci:` for non-release changes

The automated release workflow uses these prefixes to determine version bumps. Use `[release]` to force a patch release or `[skip release]` to skip an automatic release.

## Security

Please do not report security vulnerabilities in a public issue. Contact the maintainers privately with a description, affected files or versions, reproduction steps, and impact. Never include live credentials in a report.

## Additional Notes

If you need help, please open an issue or contact the maintainers. For user-facing behavior and setup details, see the [README](README.md).

## License

By contributing to XYRO, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
