<div align="center">

```
      ___           ___           ___           ___     
     |\__\         |\__\         /\  \         /\  \    
     |:|  |        |:|  |       /::\  \       /::\  \   
     |:|  |        |:|  |      /:/\:\  \     /:/\:\  \  
     |:|__|__      |:|__|__   /::\~\:\  \   /:/  \:\  \ 
 ____/::::\__\     /::::\__\ /:/\:\ \:\__\ /:/__/ \:\__\
 \::::/~~/~       /:/~~/~    \/_|::\/:/  / \:\  \ /:/  /
  ~~|:|~~|       /:/  /         |:|::/  /   \:\  /:/  / 
    |:|  |       \/__/          |:|\/__/     \:\/:/  /  
    |:|  |                      |:|  |        \::/  /   
 \|__|                       \|__|         \/__/
```

<br>

<p>terminal-native ai coding agent  ◆  built from scratch  ◆  no dependencies beyond what you see</p>

<br>

<a href="#features">Features</a> ◆ <a href="#quickstart">Quickstart</a> ◆ <a href="#usage">Usage</a> ◆ <a href="#architecture">Architecture</a> ◆ <a href="#roadmap">Roadmap</a> ◆ <a href="#gaps">Known Gaps</a>

<br>

<p>Automated commit by XYRO.</p>
<p>XYRO — the terminal-native AI coding assistant that built this project.</p>
<p>Built with XYRO — terminal-native AI coding agent (xyberclan.dev)</p>
</div>

---

## ◆ Built with XYRO

Built with XYRO — terminal-native AI coding agent (xyberclan.dev)

## ◆ What is XYRO?

**XYRO** is a terminal-native AI coding agent written in TypeScript from scratch. It operates as an interactive CLI that connects to OpenAI-compatible LLM providers (OpenAI, Groq, OpenRouter, DeepSeek, and others) and helps you navigate, analyze, understand, and modify codebases — all without leaving your terminal.

Unlike most AI coding tools that require a VS Code extension, a web dashboard, or proprietary infrastructure, XYRO is a single binary that runs wherever Node.js runs. It uses the **model context protocol (MCP)** pattern: the LLM drives the session, calls tools (file read, file write, shell commands, code search), and XYRO executes them locally.

---

## ✦ Features

| Icon | Area | Description |
|------|------|-------------|
| ◆ | **Provider-Agnostic** | Works with OpenAI, Groq, OpenRouter, DeepSeek, or any OpenAI-compatible API |
| ▸ | **Persistent Sessions** | One conversation per project, auto-saved; named sessions, switchable and resumable |
| ● | **Tool System** | Filesystem read/write, shell execution, code search, glob matching |
| ⚡ | **Interactive Prompts** | Rich terminal UI via clack prompts, gradient banners, colored output |
| ★ | **Config Persistence** | Remembers your provider, model, and API key across sessions |
| ❖ | **Headless / JSON** | One-shot `-p` runs with NDJSON events and exit codes, for CI and scripting |
| ✔ | **Self-Verification** | `diagnostics` typechecks and lints; `run_tests` runs the suite and names the failures |
| ◈ | **Free-Tier Friendly** | Built-in provider presets for Groq, OpenRouter, DeepSeek free tiers |
| ▣ | **Error Handling** | Granular API error formatting per provider (auth, rate-limit, model-not-found) |

---

## ⚡ Quickstart

```bash
# Install globally
npm install -g xyro-cli

# Or run directly
npx xyro-cli

# First run walks you through setup
xyro
```

### Environment

```
OPENAI_API_KEY=sk-...           # default for any provider
XYRO_NO_BANNER=1                # suppress the ASCII banner
```

### Provider presets

```bash
# Use a specific provider
xyro --provider groq
xyro --provider openrouter --model openai/gpt-4o
xyro --provider deepseek

# Full manual config
xyro --api-key sk-... --base-url https://api.example.com/v1 --model gpt-4o
```

---

## ◆ Usage

```
Usage: xyro [options]

Options:
  -p, --prompt <text>     Run one prompt and exit (implies headless mode)
  --api-key <key>          API key
  -m, --model <model>      LLM model
  --base-url <url>         OpenAI-compatible base URL
  --provider <id>          Provider ID (groq, openrouter, deepseek)
  --max-tool-calls <n>     Max tool calls per turn (default: 25)
  --session <name>         Named session to use (created if missing)
  --resume [name]          Resume the default session, or a named one
  --no-banner              Skip interactive setup and banner
  --json                   JSON output mode (skips banner)
  -V, --version            output the version number
  -h, --help               display help for command
```

### Headless Mode

With `-p/--prompt`, or with a prompt piped on stdin and no TTY, XYRO runs a
single turn and exits — useful for CI, cron and scripts:

```bash
xyro -p "Summarise the diff and flag security issues" --json
echo "Explain this stack trace" | xyro --json
```

- Every line is one JSON object (NDJSON): `user`, `assistant`, `tool`,
  `error`, and a final `done` event carrying `ok`, `exit_code`, `session`,
  token usage and cost.
- Exit codes: `0` success, `1` the run failed (API error, crash), `2` bad usage
  (missing API key, unknown option).
- `--session <name>` / `--resume [name]` pick the conversation to continue, so
  a follow-up turn is possible:

```bash
xyro -p "Add a login form" --session feature          # first turn
xyro -p "Now add tests for it" --session feature       # continues it
```

### Interactive Commands

| Command | Action |
|---------|--------|
| `exit` / `quit` | Save and exit |
| `clear` | Reset conversation history |
| `resume` | Reload last session |
| `/status` | Session name/id, turn count, token usage and cost |
| `/sessions` | List every saved session, marking the current project |
| `/new [name]` | Start a new session for this project |
| `/switch <id\|name>` | Load another session into this session |
| `/rename <name>` | Rename the current session |
| `/delete <id\|name>` | Delete a session |

Sessions are stored per project directory, so switching folders in a terminal
gives you a separate conversation; the history is auto-saved about a second
after each change.

---

## ▸ Architecture

```
┌─────────────────────────────────────────────────────┐
│                     XYRO CLI                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ commander │  │  clack   │  │  gradient-string │  │
│  │ (args)    │  │(prompts) │  │  (banners)       │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │             │                  │            │
│  ┌────▼─────────────▼──────────────────▼─────────┐  │
│  │              Agent Loop                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │   LLM    │  │  Tools   │  │  History     │  │  │
│  │  │ Provider │──│ Registry │──│  Persistance │  │  │
│  │  └──────────┘  └──────────┘  └─────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Tools                                          │  │
│  │  read ├── write ├── shell ├── search ├── glob   │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Core Loop

1. **CLI** parses arguments and reads persisted config (provider, model, key)
2. **Agent Loop** creates an OpenAI-compatible client and enters the interaction loop
3. **User input** is sent to the LLM alongside tool definitions
4. **LLM responds** with text or tool call requests
5. **Tool Registry** dispatches calls to filesystem/shell/search operations
6. **Results** are fed back to the LLM for the next turn
7. **History** is saved on exit for `--resume`

### Tool System

| Tool | Capability |
|------|-----------|
| `read` | Read file contents with line numbers |
| `write` | Write or overwrite files |
| `shell` | Execute shell commands with timeout |
| `search` | Regex/grep file contents |
| `glob` | Pattern-based file discovery |
| `diagnostics` | Typecheck + lint the project, auto-detected, parsed to `file:line:col` findings |
| `run_tests` | Run the project's own test suite, reporting counts and failing test names |

`diagnostics` and `run_tests` read the project's own `package.json` scripts
(plus `tsconfig.json`, ESLint config, `Cargo.toml`, `go.mod`, `pyproject.toml`),
so they invoke the same commands a developer would. The agent is instructed to
run both after changing code rather than claim success on an unverified change.

---

## ● Stack

```
Runtime     ◆  Node.js / TypeScript / ES2022
CLI         ◆  commander
Prompts     ◆  @clack/prompts
Terminal    ◆  picocolors + gradient-string
AI API      ◆  openai SDK (OpenAI-compatible)
Build       ◆  TypeScript compiler (tsc)
Dev runner  ◆  tsx
```

---

## ❖ Known Gaps & Roadmap

XYRO is in early development. Here is what it does not yet have, in rough priority order:

| Area | Gap | Status |
|------|-----|--------|
| ◈ | **Multi-file edits** — single-file writes only, no diff/patch | Planned |
| ▣ | **Diff preview** — no staged review of changes before apply | Planned |
| ⚡ | **Cost tracking** — no per-session token/cost meter | Planned |
| ▸ | **Git integration** — no automatic commits or branch management | Planned |
| ◆ | **Context window management** — no summarization or sliding window | Planned |
| ● | **Plugin system** — tools are hard-coded, not extensible at runtime | Future |
| ❖ | **File watching** — no `--watch` mode for continuous feedback | Future |
| ★ | **Config profiles** — single saved config only | Future |
| ▣ | **Streaming output** — blocks until full LLM response | Future |
| ◈ | **Test runner** — no built-in test execution harness | Done (`run_tests`) |
| ▣ | **Self-hosted docs** — no `xyro --help` beyond commander output | Future |
| ⚡ | **Multi-turn planning** — no explicit plan/approve step before execution | Future |

---

## ✦ Development

```bash
# Clone
git clone git@github.com:CYBERCLAN237/Xyro-Cli.git
cd xyro

# Install
npm install

# Dev (runs via tsx)
npm run dev

# Build
npm run build

# Run built version
npm start
```

### ▸ Releasing to npm

Releases are automated via GitHub Actions (`.github/workflows/publish.yml`). Pushing a `v*` tag triggers `npm publish`:

```bash
# 1. Bump version in package.json first, commit
npm version patch   # or minor / major — this commits and tags for you

# 2. Push the tag
git push --follow-tags
# GitHub Actions now: installs → builds → verifies tag == package.json version → publishes
```

The workflow requires an `NPM_TOKEN` secret in the repo (Settings → Secrets → Actions). Use a **granular access token** with "Read and write" packages permission, and 2FA bypass enabled for automation.

---

## ▸ License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<br>
<p>
  <sub>
  built from scratch with TypeScript  ◆  by CYBERCLAN237  ◆  icon set: unicode geometric shapes
  </sub>
</p>
<br>
</div>
