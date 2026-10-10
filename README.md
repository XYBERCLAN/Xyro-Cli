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
| ▸ | **Persistent Sessions** | Auto-saves conversation history; resume with `--resume` |
| ● | **Tool System** | Filesystem read/write, shell execution, code search, glob matching |
| ⚡ | **Interactive Prompts** | Rich terminal UI via clack prompts, gradient banners, colored output |
| ★ | **Config Persistence** | Remembers your provider, model, and API key across sessions |
| ❖ | **No-Banner Mode** | Headless/JSON output for CI pipelines and scripting |
| ◈ | **Free-Tier Friendly** | Built-in provider presets for Groq, OpenRouter, DeepSeek free tiers |
| ▣ | **Error Handling** | Granular API error formatting per provider (auth, rate-limit, model-not-found) |
| ◆ | **Free-Quota Pool** | When a model is rate-limited or out of free quota, XYRO moves to another free model, then to another provider you have a key for. Limited providers rest until they recover. See `/quota` |
| ▸ | **Intent Guard** | Lasting requirements you state ("login must reject empty passwords") are saved as checks in `.xyro/intents.json` and re-run after every change. Anything that broke is fixed before the turn ends. See `/intents` |
| ● | **Privacy Shield** | API keys, tokens, passwords, private keys, card numbers and emails are replaced with placeholders before a request leaves your machine, then restored locally in replies and tool calls. Counts are logged to `privacy-audit.jsonl`, never values. See `/privacy`, or turn it off with `XYRO_PRIVACY=off` |
| ★ | **Tournament Mode** | For a hard change, 2–4 free models from different providers each solve it in their own git worktree. Your tests, saved intents and the type checker score the results, and only a winner that passes is merged. XYRO remembers which models win. Free quota makes this affordable, which paid tools can't match |
| ⚡ | **Hedged Requests** | XYRO learns how quickly each provider usually responds. If a request hasn't started streaming well past that time, a backup goes to another provider, and whichever answers first wins. Turn it off with `XYRO_HEDGE=off` |
| ▸ | **Instant Commands** | "run the tests", "what changed", "show the diff", "typecheck" and "repo map" run locally with no model call and no quota used, and the result stays in the conversation. Turn it off with `XYRO_INSTANT=off` |
| ◈ | **Bring Your Setup** | XYRO reads what you already set up for other agents: rules (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Cursor, Windsurf, Cline, Copilot), skills (`~/.claude/skills` and Claude Code plugins, found with `skill_search`), and MCP servers (Claude Code, Cursor, VS Code, Gemini). MCP servers defined inside a project need `/mcp trust`. Turn it off with `XYRO_IMPORT=off` |
| ❖ | **Evidence-Backed Skills** | Each skill keeps a record of how often its runs pass verification. Skills that keep failing are no longer loaded automatically. `skill_forge` saves a solved procedure as a project skill, but only if its check passes at that moment |
| ◆ | **XYRO as an MCP Server** | `xyro mcp` gives Claude Code, Cursor and other agents XYRO's tools: tournament, experts, repo map, intents, web search and quota. The work runs on your free quota instead of the host's paid model: `claude mcp add xyro -- xyro mcp` |
| ★ | **Learns How You Work** | XYRO keeps a local journal of evidence: what you ask for, your corrections ("no, use pnpm"), your praise, your rewinds, and errors it recovered from. Every so often it reflects on that journal (or right away with `/learn`), and code checks every claim against the evidence. A habit of yours is kept only after it has been seen twice. Project lessons go into `XYRO.md`. A skill is written only for a procedure seen working in two separate sessions. `/profile` shows what XYRO knows about you and `/forget` erases it. Turn it off with `XYRO_LEARN=off` |
| ❖ | **Expert Council** | For decisions that are costly to get wrong, experts each investigate and propose an approach, read each other's proposals, debate and vote. The author of the winning proposal writes the final decision, and the team can then carry it out (`council`) |
| ▸ | **Leads and Workers** | Any expert can lead: `assign_workers` hands out up to 3 sub-tasks in parallel. Workers follow the lead's rules, use only the lead's tools, and report back to the lead |
| ◈ | **Skills Anywhere** | Every expert can search and load any installed skill or plugin tool whenever its task needs one. When nothing installed fits, `skill_find_online` searches the web and `skill_install` installs a skill from GitHub, after your approval |
| ● | **The Team, Animated** | A strip beside the input box (always visible, even next to a long plan) shows each working expert as a small robot. When an expert gets a task, its robot wakes up: dozing, then eyes popping open with a "!", then a happy hop. Then it works in the style of its role: builders throw sparks, inspectors sweep a lens and follow it with their eyes, testers chase a bug until it's caught, writers draw lines, architects turn "?" into "!", and shippers move things along a conveyor. It smiles when done and shows crossed eyes on failure. Workers stand beside their lead, and when nobody is working the team dozes. XYRO itself wakes up when you send a message, then glances around and hops now and then while it works |
| ■ | **Esc to Stop** | Press Esc while XYRO works to stop the whole turn: the model request, running commands and tests, and every expert, worker, council or tournament. What was already said is kept, nothing half-finished is merged, and you can carry on with your next message |
| ◆ | **Experts Ready on Arrival** | The moment you send a message, XYRO recognises what kind of request it is, and the experts for it wake up in the side panel, ready to work. Multi-step requests are planned in the open: XYRO writes the steps, names the expert who owns each one, and hands the specialised steps to those experts. If the model starts without a plan, it is reminded once |
| ● | **Experts Know Their Trade** | No trigger words needed: when XYRO reads or searches files, the scout wakes up and works; when it edits, the builder does; tests wake the tester, git the git expert, web searches the researcher |
| ▸ | **Scrolling** | The mouse wheel scrolls the chat, and your view stays put while new messages arrive (End jumps back to the newest). Long menus, including the main command menu, fit any screen: your selection stays in view, and "↑ N more" / "↓ N more" show what's hidden |
| ◈ | **Easy on Free Quotas** | Each request is about 58% smaller: the main agent gets a core set of tools and loads extra groups (git, team, files, background, intents, skills) only when needed. On providers with a small daily allowance (OpenRouter's free tier is 50 requests a day), XYRO works in fewer, fuller steps and keeps experts short. When a daily allowance runs out, XYRO says so clearly: when it resets, and what you can do in the meantime |
| ■ | **Stays in Your Project** | XYRO reads and writes inside the folder it was started in. Reading anywhere else asks you first, once per folder per session, and writes outside the project are always refused. It warns you if it was started in your home folder |
| ★ | **A Real Welcome** | First launch happens inside XYRO, not as a plain text prompt: the mascot intro, then a choice of language (XYRO then speaks it with you), a look, and connecting a free AI provider, with links to get a free key. `/language` changes the language later |
| ◈ | **Skills, Plugins, MCP in One Place** | `/skills` lists every skill XYRO and its experts can use, grouped by source and with each one's track record. Enter puts a skill to work for the session (Enter again stops it), → reads it in full. `/skills search`, `/skills install <github url>` and `/skills remove <name>` manage them. `/plugins` shows loaded plugins, their tools and load errors; `/plugins reload` picks up changes |
| ★ | **Claude Code Plugins** | Plugins are added the way Claude Code adds them: `/plugin marketplace add owner/repo`, `/plugin browse`, `/plugin install name@marketplace`, `/plugin list`, `/plugin uninstall name`. A plugin's skills join `/skills`, its agents join the expert team (with Claude tool names translated), its commands become slash commands (`/name args`), and its MCP servers connect. Plugin hooks are not run. The same commands work from the shell: `xyro plugin …` |
| ◆ | **MCP, Claude Code Syntax** | `/mcp add name -- npx -y some-server`, `/mcp add --transport http name https://…` (options `--scope project`, `-e KEY=value`, `-H "Header: value"`), `/mcp remove name`, `/mcp list`. Also from the shell: `xyro mcp add …` |
| ▸ | **Sessions per Project** | Each project keeps its conversations in `.xyro/sessions/` (private files, kept out of git). `/sessions` reopens any of them, `/new` (or `/clear`) starts a fresh one, `--resume` reopens this project's latest. ↑/↓ in the input walks back through the prompts of the session |
| ◆ | **XYRO Link** | Open XYRO on the same project in another terminal and the sessions link automatically. `/chat` talks to the other users, and each side's experts see the other's notes, proposals and decisions on a shared team board. Teammates on the same network join with a code (`/link lan` on one machine, `/link join <code>` on the other). Join codes are 16 characters and the key is derived with scrypt, and every message is signed, so others on the network can't read or inject anything. Chat from teammates on the network reaches XYRO only after you type `/chat use`. Linked sessions only exchange text, never commands. Turn it off with `XYRO_LINK=off` |

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
  --api-key <key>          API key
  -m, --model <model>      LLM model
  --base-url <url>         OpenAI-compatible base URL
  --provider <id>          Provider ID (groq, openrouter, deepseek)
  --max-tool-calls <n>     Max tool calls per turn (default: 25)
  --resume                 Resume previous conversation
  --no-banner              Skip interactive setup and banner
  --json                   JSON output mode (skips banner)
  -V, --version            output the version number
  -h, --help               display help for command
```

### Interactive Commands

| Command | Action |
|---------|--------|
| `exit` / `quit` | Save and exit |
| `clear` | Reset conversation history |
| `resume` | Reload last session |
| `/quota` | Free-quota pool: requests, limits and resting providers |
| `/intents` | Re-run saved requirement checks (`/intents trust`, `/intents remove <id>`) |
| `/privacy` | What the privacy shield withheld this session (`/privacy on` / `off`) |
| `/learn` | Reflect now: learn how you work, project lessons and proven skills |
| `/profile` · `/forget` | See, or erase, what XYRO learned about you |
| `/chat <message>` · `/peers` | Talk to linked XYRO sessions, and see who is linked |
| `/link lan` · `/link join <code>` · `/link off` | Link with teammates on your network |
| `/experts trust` | Load this project's experts from `.xyro/agents` after reviewing them (built-in experts can't be replaced) |
| `xyro mcp` | Run XYRO as an MCP server for other agents |

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
| ◈ | **Test runner** — no built-in test execution harness | Future |
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

## ✦ Updating

XYRO checks npm for a newer release in the background (at most every 12 hours, never blocking start-up). When one exists, the home screen and the status rail say so — type `/update` to install it without leaving XYRO, then restart.

```bash
/update                         # inside XYRO
npm install -g xyro-cli@latest  # or from your shell
XYRO_NO_UPDATE_CHECK=1 xyro     # opt out of the background check
```

## ✦ Releasing

Releases are cut by CI — no local publishing needed.

**Automatic (default):** every push to `main` that users would notice is published by `auto-release.yml`. The commit messages decide the version: `feat:` → minor, `fix:`/`perf:`/`revert:` → patch, `type!:` or `BREAKING CHANGE` → major (minor while on 0.x). Pushes that only change docs, chores, tests or CI publish nothing. Add `[release]` to a commit message to force a patch release, or `[skip release]` to skip one. Users see a "New version" pop-up with what's new the next time they start XYRO.

**Manual:**

1. **Actions → Release → Run workflow**, pick `patch`, `minor`, `major` or `prerelease` (or run `npm run release`, `npm run release:minor`, `npm run release:major` with the GitHub CLI).
2. The workflow typechecks, builds, runs the tests, bumps `package.json`, tags `vX.Y.Z`, publishes to npm **with provenance**, and creates a GitHub Release with generated notes.
3. Pre-releases publish to the `next` dist-tag, so `npm install -g xyro-cli` stays on stable.

Pushing a `v*` tag manually (`npm version patch && git push --follow-tags`) runs the same gate through `publish.yml`, and skips versions already on npm.

**One-time setup:** add an npm automation token as the `NPM_TOKEN` repository secret, and allow GitHub Actions to push to `main` (or exempt `github-actions[bot]` from branch protection).

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
