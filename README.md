<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/XYBERCLAN/Xyro-Cli/main/docs/assets/banner-dark.svg">
  <img alt="XYRO" src="https://raw.githubusercontent.com/XYBERCLAN/Xyro-Cli/main/docs/assets/banner-light.svg" width="420">
</picture>

### The AI coding agent that lives in your terminal and runs on free models.

Plan, edit, test and ship with a team of 25 expert agents, using the free tiers of Google AI Studio, Groq, OpenRouter, Ollama and 21 other providers. When one runs out, XYRO moves to the next.

[![npm](https://img.shields.io/npm/v/xyro-cli?style=flat-square&color=38BDF8&labelColor=0B1018&label=npm)](https://www.npmjs.com/package/xyro-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/XYBERCLAN/Xyro-Cli/ci.yml?branch=main&style=flat-square&labelColor=0B1018&label=CI)](https://github.com/XYBERCLAN/Xyro-Cli/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/xyro-cli?style=flat-square&color=3B82F6&labelColor=0B1018)](https://nodejs.org)
[![license](https://img.shields.io/github/license/XYBERCLAN/Xyro-Cli?style=flat-square&color=C6F135&labelColor=0B1018)](LICENSE)

[Quickstart](#quickstart) · [Features](#features) · [Usage](#usage) · [Configuration](#configuration) · [How it works](#how-it-works) · [Contributing](#contributing)

<br>

<img alt="XYRO adds input validation to a signup handler: it plans the work, reads the file, edits it and runs the tests" src="https://raw.githubusercontent.com/XYBERCLAN/Xyro-Cli/main/docs/assets/demo.gif" width="100%">

<sub>A real XYRO session. The model's replies are scripted so the recording can be reproduced (<a href="docs/demo">docs/demo</a>); everything else on screen is XYRO itself.</sub>

</div>

<br>

## Quickstart

```bash
npm install -g xyro-cli
xyro
```

That's it. The first launch happens inside XYRO: pick your language and a look, then connect a provider. XYRO links to the free key page of each one. [Google AI Studio](https://aistudio.google.com/apikey) and [Groq](https://console.groq.com/keys) take about a minute, and [Ollama](https://ollama.com) needs no key at all.

Then ask for what you want, in your own words:

```text
❯ Add input validation to the signup handler, then run the tests
```

XYRO plans the steps, reads the code, makes the change, runs your tests and tells you what it did. Press <kbd>Esc</kbd> at any time to stop.

> XYRO needs **Node.js 20 or newer**. To try it without installing, run `npx xyro-cli`.

<br>

## Features

### Free models, without the limits getting in your way

XYRO ships with **25 provider presets**, from Google AI Studio, Groq and OpenRouter to Mistral, DeepSeek, GitHub Models and a local Ollama. Connect as many as you like; XYRO treats them as one pool.

- **Free-quota pool.** When a model is rate-limited or out of free quota, XYRO switches to another free model, then to another provider you have a key for. Limited providers rest until they recover. `/quota` shows the live capacity of each one.
- **Hedged requests.** XYRO learns how fast each provider usually answers. If a request is slow to start, a backup goes to another provider and the first answer wins.
- **Light requests.** The agent starts with a core set of tools and loads extra groups (git, team, files, background jobs, intents, skills) only when a task needs them. On providers with a small daily allowance, it works in fewer, fuller steps.
- **Instant commands.** "run the tests", "what changed", "show the diff", "typecheck" and "repo map" run locally, with no model call and no quota used.

### A team of experts, not a single chat

<p align="center"><img alt="The /experts panel listing XYRO's built-in experts with their roles and tools" src="https://raw.githubusercontent.com/XYBERCLAN/Xyro-Cli/main/docs/assets/experts.png" width="100%"></p>

XYRO hands work to **25 built-in experts**: scout, architect, builder, debugger, tester, reviewer, security, docs writer, git operator and more. Each has its own tools, rules and track record. A strip beside the input shows each one at work as a small animated robot.

- **Plans in the open.** Multi-step requests become a visible task list, each step owned by an expert.
- **Leads and workers.** Any expert can split its task into up to 3 parallel sub-tasks.
- **Expert council.** For decisions that are costly to get wrong, experts each propose an approach, read each other's proposals, debate and vote.
- **Tournament.** For a hard change, 2 to 4 models from different providers each solve it in their own git worktree. Your tests, saved requirements and the type checker score the results, and only a winner that passes is merged.
- **Workflows.** `/workflow feature`, `bugfix`, `review`, `release-check`, `refactor` and `onboard` run a whole team play.
- **Your own experts.** Add experts as Markdown files in `.xyro/agents/` (project) or `~/.config/xyro/agents/` (user).

### Safe by default

<p align="center"><img alt="XYRO asks 'Allow this action?' before editing src/signup.js, with allow, always allow and deny" src="https://raw.githubusercontent.com/XYBERCLAN/Xyro-Cli/main/docs/assets/approval.png" width="100%"></p>

- **Four permission modes.** <kbd>Shift</kbd>+<kbd>Tab</kbd> cycles them: **ask** (asks before changing anything), **accept-edits** (file edits run, commands still ask), **plan** (read-only) and **yolo** (nothing asks). "Always allow" answers become rules you can edit.
- **Stays in your project.** XYRO reads and writes inside the folder it started in. Reading elsewhere asks first, and writing elsewhere is refused.
- **Privacy shield.** API keys, tokens, passwords, private keys, card numbers and emails are replaced with placeholders before a request leaves your machine, then restored locally. `/privacy` shows what was withheld.
- **Undo anything.** `/rewind` (or <kbd>Esc</kbd> <kbd>Esc</kbd>) takes files and the conversation back to an earlier message.
- **Requirements that stick.** Say "login must reject empty passwords" once, and it becomes a check that runs again after every change. `/intents` lists them.

### Works with the setup you already have

- **Your rules.** XYRO reads `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and the rule files of Cursor, Windsurf, Cline and Copilot.
- **Skills and Claude Code plugins.** `/skills` lists every skill XYRO can use, including `~/.claude/skills`. `/plugin install name@marketplace` adds Claude Code plugins: their skills, agents, commands and MCP servers.
- **MCP, both ways.** Connect MCP servers with Claude Code's syntax (`/mcp add name -- npx -y some-server`), or run `xyro mcp` to give Claude Code, Cursor and other agents XYRO's tournament, experts, repo map and web search: `claude mcp add xyro -- xyro mcp`.

### Learns how you work

XYRO keeps a local journal of what you ask for, your corrections ("no, use pnpm") and what worked. It keeps a habit only after seeing it twice, writes project lessons to `XYRO.md`, and turns a procedure into a skill only once it has worked in two separate sessions. `/profile` shows what it knows about you and `/forget` erases it.

### A terminal interface built for long sessions

<p align="center"><img alt="The command palette, opened with / or Ctrl+P" src="https://raw.githubusercontent.com/XYBERCLAN/Xyro-Cli/main/docs/assets/commands.png" width="100%"></p>

- <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>P</kbd> opens the command palette; <kbd>@</kbd> picks a project file to mention.
- Sessions are saved per project: `/sessions` reopens any of them and `xyro --resume` continues the latest.
- 13 themes (`/theme`), 14 languages (`/language`), mouse-wheel scrolling, multi-line input with <kbd>Shift</kbd>+<kbd>Enter</kbd>, and a terminal notification when a long turn ends.
- **XYRO Link.** Open XYRO on the same project in another terminal, or on a teammate's machine with `/link lan`, and the sessions share notes, proposals and decisions. Messages are signed, and linked sessions never exchange commands.

<br>

## Usage

```text
Usage: xyro [options]

Options:
  -V, --version         output the version number
  -v                    output the version number (shorthand for --version)
  --api-key <key>       API key
  -m, --model <model>   LLM model
  --base-url <url>      OpenAI-compatible base URL
  --provider <id>       Provider ID (e.g. groq, openrouter, deepseek)
  --max-tool-calls <n>  Max tool calls per turn (default: "25")
  --resume              Resume previous conversation (default: false)
  --no-banner           Skip interactive setup and banner
  --json                JSON output mode (skips banner) (default: false)
  --tui                 Full-screen XYRO interactive terminal interface
  -h, --help            display help for command

Commands:
  xyro mcp              Serve XYRO's team (tournament, experts, repo map…) to other agents over MCP
  xyro mcp add|add-json|get|remove|list …
                        Manage MCP servers (Claude Code syntax: xyro mcp add <name> -- <command>)
  xyro plugin …         Claude Code plugins: marketplace add <repo>, install <name>, browse, list
```

In a terminal, `xyro` opens the full-screen interface. With `--json`, `--no-banner`, or when input is piped, it runs a plain line-by-line mode instead, which supports fewer commands.

<details>
<summary><b>Keyboard</b></summary>
<br>

| Key | Action |
|---|---|
| <kbd>Enter</kbd> · <kbd>Shift</kbd>+<kbd>Enter</kbd> | Send · new line |
| <kbd>Esc</kbd> | Stop the current turn (your draft is kept), or close a panel |
| <kbd>Esc</kbd> <kbd>Esc</kbd> | Rewind to an earlier message (on an empty prompt) |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Cycle permission mode: ask → accept-edits → plan → yolo |
| <kbd>Tab</kbd> | Switch persona: Build, Plan, Review, Explore |
| <kbd>/</kbd> · <kbd>Ctrl</kbd>+<kbd>P</kbd> | Command palette |
| <kbd>@</kbd> | Mention a project file |
| <kbd>↑</kbd> <kbd>↓</kbd> | Earlier prompts of this session |
| <kbd>PgUp</kbd> <kbd>PgDn</kbd> · mouse wheel | Scroll the conversation; <kbd>End</kbd> jumps to the newest message |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Copy the selection, or quit when idle |

</details>

<details>
<summary><b>Commands</b></summary>
<br>

| Command | What it does |
|---|---|
| **Conversation** | |
| `/sessions` · `/new` · `/clear` | Reopen a conversation of this project, or start a new one (the old one is kept) |
| `/rewind` | Undo files and conversation back to an earlier message |
| `/compact` | Summarize the conversation to free up context |
| `/export [file]` | Save the conversation to a file |
| **Models and providers** | |
| `/model` · `/provider` | Switch model, connect or reconfigure a provider |
| `/quota` | Live capacity of every free provider XYRO can fall back to |
| `/cost` · `/status` | Token use and estimated cost · model, context and active tools |
| **Team** | |
| `/experts` | Browse the experts, their tools, skills and record (`/experts trust` loads `.xyro/agents`) |
| `/workflow <name> <goal>` | Run a team play: feature, bugfix, review, release-check, refactor, onboard |
| **Extend** | |
| `/skills` | Browse, search, install and remove skills |
| `/plugin` · `/plugins` | Install Claude Code plugins · see loaded plugins and load errors |
| `/mcp` | Connected MCP servers; `/mcp add`, `/mcp remove` |
| `/hooks` | See active hooks and trust this project's hooks |
| **Safety and memory** | |
| `/intents` | Re-check your saved requirements; trust or remove them |
| `/privacy` | What the privacy shield kept off the network; `on` / `off` |
| `/learn` · `/profile` · `/forget` | Reflect now · see · erase what XYRO learned about you |
| `/init` | Create an `AGENTS.md` with this project's context |
| **Interface** | |
| `/theme` · `/language` · `/agent` | Look · language · persona |
| `/peers` · `/link` · `/chat` | Linked sessions on this project and your network |
| `/update` · `/help` · `/exit` | Install the latest XYRO · all commands · save and quit |

</details>

<br>

## Configuration

### Providers

Pick a provider in the app with `/provider`, or on the command line:

```bash
xyro --provider groq
xyro --provider openrouter --model cohere/north-mini-code:free
xyro --base-url https://api.example.com/v1 --api-key sk-… --model my-model   # any OpenAI-compatible API
```

<details>
<summary><b>All 25 presets</b></summary>
<br>

`google` Google AI Studio · `groq` Groq · `openrouter` OpenRouter · `tokenrouter` TokenRouter · `github` GitHub Models · `nvidia` NVIDIA NIM · `cerebras` Cerebras · `cloudflare` Cloudflare Workers AI · `huggingface` Hugging Face · `sambanova` SambaNova · `together` Together AI · `fireworks` Fireworks AI · `mistral` Mistral AI · `ovhcloud` OVHcloud · `cohere` Cohere · `nebius` Nebius · `deepseek` DeepSeek · `zhipu` Zhipu AI · `siliconflow` SiliconFlow · `qwen` Alibaba Qwen · `baidu` Baidu Qianfan · `hunyuan` Tencent Hunyuan · `volcengine` Volcengine Doubao · `ai21` AI21 Labs · `local` Ollama

Free tiers and limits change often; `/model` shows the current ones for each provider.

</details>

### Where XYRO keeps things

| Path | Contents |
|---|---|
| `~/.config/xyro/` (`%APPDATA%\xyro` on Windows) | Settings, saved keys (file readable only by you), MCP servers, user experts and skills, quota history |
| `.xyro/` in your project | Sessions, permission rules, saved requirements, project experts, skills and MCP servers. Sessions are kept out of git |
| `XYRO.md` in your project | Project lessons and conventions, read at the start of every session |

### Permissions

Rules live in `.xyro/settings.json` (or `~/.config/xyro/settings.json` for every project). Deny rules always win.

```json
{
  "mode": "ask",
  "allow": ["run_command(npm test)", "run_command(npm run lint)"],
  "deny": ["run_command(git push*)"]
}
```

### Environment variables

<details>
<summary><b>Turn features off, or change how they work</b></summary>
<br>

| Variable | Effect |
|---|---|
| `OPENAI_API_KEY` | API key used when none is saved or passed with `--api-key` |
| `ANTHROPIC_API_KEY` | Claude models go straight to Anthropic when no other base URL is configured |
| `XYRO_PRIVACY=off` | Turn off the privacy shield |
| `XYRO_HEDGE=off` | Turn off hedged requests |
| `XYRO_NO_POOL=1` | Never fall back to another provider |
| `XYRO_INSTANT=off` | Turn off instant (no-model) commands |
| `XYRO_LEARN=off` | Turn off learning |
| `XYRO_IMPORT=off` | Don't import Claude Code skills, plugins or other agents' MCP servers |
| `XYRO_LINK=off` | Turn off XYRO Link |
| `XYRO_NO_UPDATE_CHECK=1` | Don't check npm for a newer version (also off when `CI` is set) |
| `XYRO_NO_NOTIFY=1` | No terminal notification when a turn ends |
| `XYRO_REDUCED_MOTION=1` | Reduce animation and skip the intro |
| `TAVILY_API_KEY` · `BRAVE_SEARCH_API_KEY` · `SEARXNG_URL` | Web search engines, tried in that order before DuckDuckGo |

</details>

### Updating

XYRO checks npm when it starts (at most once every 10 minutes, without slowing start-up) and tells you when a new version is out. Type `/update` to install it, or run `npm install -g xyro-cli@latest`.

<br>

## How it works

XYRO is a TypeScript program with no server and no account. It talks to any OpenAI-compatible API (and to Anthropic directly), and runs every tool on your machine.

```text
 you ─▶ terminal UI ─▶ agent loop ─▶ model (from the free-quota pool)
                          │  ▲
                tool call │  │ result
                          ▼  │
           tools: files · shell · tests · git · web · MCP · experts
                          │
             permissions · privacy shield · checkpoints for /rewind
```

| Part | Where |
|---|---|
| Terminal interface | [`src/tui/`](src/tui) |
| Agent loop, sessions, learning, hooks | [`src/agent/`](src/agent) |
| Experts, council, tournament, worktrees | [`src/agents/`](src/agents) |
| Providers, free-quota pool, privacy shield | [`src/providers/`](src/providers) |
| Tools and permissions | [`src/tools/`](src/tools) |
| MCP client and server | [`src/mcp/`](src/mcp) |

<br>

## Roadmap

XYRO is young and moves fast. What's planned, known bugs and good first issues are all on the [issue tracker](https://github.com/XYBERCLAN/Xyro-Cli/issues). A few larger gaps:

- **Headless one-shot mode**: `xyro -p "…"` that runs one task and exits, for CI and scripts
- **Patch-based multi-file edits** with a diff preview before approval
- **Windows parity**: the test suite does not fully pass on Windows yet

<br>

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow and commit conventions.

```bash
git clone https://github.com/XYBERCLAN/Xyro-Cli.git
cd Xyro-Cli
npm install
npm run dev        # run from source
npm test           # tests never touch your real XYRO config
```

Releases are automatic: see [docs/RELEASING.md](docs/RELEASING.md).

## License

[MIT](LICENSE)

<br>

<div align="center">
<sub>Built in the open by <a href="https://github.com/XYBERCLAN">XYBERCLAN</a> and <a href="https://github.com/XYBERCLAN/Xyro-Cli/graphs/contributors">contributors</a>.</sub>
</div>
