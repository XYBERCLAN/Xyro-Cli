# XYRO Roadmap — toward the best terminal coding agent

> Written 2026-10-09 from a full read of `src/` (~11.8k LOC, TypeScript, Node ≥ 20).
> Priorities: **P0** = broken or unsafe today · **P1** = core parity with top agents · **P2** = differentiators · **P3** = polish.

---

## 0. Where XYRO stands today

**Architecture**

| Layer | Files | State |
|---|---|---|
| CLI entry | `src/index.ts`, `src/tui/entry.ts` | Commander CLI → full-screen custom TUI (or line mode / `--json`) |
| Agent loop | `src/agent/loop.ts`, `history.ts`, `commands.ts` | Streaming tool loop, auto-compact, 14 slash commands, approval gate |
| Providers | `src/providers/llm.ts`, `src/models/*` | OpenAI-compatible + native Anthropic; model catalog + live fetcher + recents |
| Tools | `src/tools/*` (20 files) | 28 tools **registered**: fs, shell, search, AST (ts-morph), 20 git/gh tools |
| TUI | `src/tui/*` (~4k LOC) | Hand-written renderer (alt-screen, SGR mouse, OSC 52 copy), pickers, modals, themes, logo |
| Config | `src/config/*` | Persisted provider keys, plugins loader, skills loader, platform safety patterns |

**Strengths:** provider-agnostic with free-tier presets, own TUI engine (no Ink dependency at runtime), mouse selection + copy, theme system, AST tools, deep git/gh integration, CI with coverage gate.

---

## P0 — Fix what is broken or unsafe

- [ ] **Re-register orphaned tools.** `glob.ts`, `fetch.ts` (`fetch_url`), `subagent.ts` (`spawn_agent(s)`), `todos.ts` (`write_todos`), `undo.ts` (`revert_file`), `propose.ts`, `end_turn.ts`, `find_files.ts` exist but are **not in `registry.ts`** since commit `d2c7e45`. The agent can't plan, delegate, fetch docs or undo.
- [ ] **Restore loop features deleted in `d2c7e45`**: doom-loop guard (`DOOM_LOOP_THRESHOLD`), `buildLocalContextSummary`, provider failover (`getFallbackChain`), `END_TURN_TOOL_NAMES`. Four tests currently fail because of this (`agent_resilience`, `failover`, `loop_features`, `freebuff_features`).
- [ ] **Sub-agent permission bypass.** `runSubAgent` (`src/tools/subagent.ts:128`) calls `executeTool` with no approval gate; the `generic` type has all tools. Route through `requestPermission` or restrict sub-agents to read-only tools.
- [ ] **Renderer burns CPU.** `paintFrame` (`src/tui/core.ts:281`) repaints the entire screen every 80 ms, even when idle. Add diffing + idle detection (see §3). This also stops the laptop fans spinning up.
- [ ] **Shell safety → real sandbox.** The denylist (`src/config/platform.ts`) is a backstop, not a boundary. Add an opt-in sandbox (`bwrap` on Linux, `sandbox-exec` on macOS) with no network and write access only to the project dir.
- [ ] **Shell-injection in git helpers.** Remaining `execSync` string commands (`parseRepoFromRemote`) → use `execa` arg arrays everywhere.
- [ ] **README honesty.** Header says "Automated commit by XYRO" three times; "MCP" is claimed but not implemented; footer shows a hard-coded "1 MCP" (`app.ts:153`). Fix copy and counters.
- [ ] **Dead code.** `src/tui/ink-app.tsx` (289 LOC) is imported nowhere — delete it or make Ink the renderer, not both. Drop `ink`/`react` deps if unused.
- [ ] Stop committing scratch dirs (`__test_tmp__`, `__test_security__`) — tests should write to `os.tmpdir()`.

---

## 1. Gap analysis vs. Claude Code

| Capability | Claude Code | XYRO | Priority |
|---|---|---|---|
| Streaming agent loop with tools | ✅ | ✅ | — |
| Per-tool permission prompts + allow/deny rules in settings | ✅ (`settings.json` permissions, modes) | ⚠️ hard-coded sets in `permissions.ts`, no persisted rules | P1 |
| Permission modes (default / accept-edits / plan / auto) | ✅ Shift+Tab cycles | ❌ | P1 |
| Plan mode (read-only explore → proposed plan → approve) | ✅ | ❌ | P1 |
| Edit diffs shown before applying, per-hunk accept | ✅ | ⚠️ `diff.ts` exists, not wired into TUI approval | P1 |
| Checkpoints / rewind (Esc Esc) | ✅ | ⚠️ `undo.ts` per file only, unregistered | P1 |
| Todo list shown live in UI | ✅ | ❌ (`todos.ts` unregistered, no widget) | P1 |
| Sub-agents with own context + custom agent definitions (`.claude/agents/*.md`) | ✅ | ⚠️ 5 hard-coded types | P1 |
| MCP client (stdio + HTTP, tools/resources/prompts) | ✅ | ❌ | P1 |
| Hooks (PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit…) | ✅ | ❌ | P1 |
| Skills (SKILL.md auto-invoked by description) | ✅ | ⚠️ `config/skills.ts` loader, no auto-invocation | P1 |
| Plugins (bundle of skills/agents/commands/hooks/MCP) + marketplace | ✅ | ⚠️ `config/plugins.ts` basic loader | P2 |
| Project memory file (`CLAUDE.md` hierarchy, `/init`, `#` to add memory) | ✅ | ⚠️ `/init` exists; no `XYRO.md` hierarchy loading | P1 |
| Custom slash commands from markdown files | ✅ | ❌ | P1 |
| `@file` mentions with fuzzy picker, image paste | ✅ | ❌ | P1 |
| Background shell tasks + monitor | ✅ | ❌ | P2 |
| Headless mode (`-p`, `--output-format stream-json`) + SDK | ✅ | ⚠️ `--json` only | P2 |
| Prompt caching, extended thinking display | ✅ | ❌ | P1 |
| IDE integration (VS Code/JetBrains diff view) | ✅ | ❌ | P3 |
| Git worktrees for parallel sessions | ✅ | ❌ | P2 |
| Web search tool | ✅ | ❌ (`fetch_url` only) | P2 |
| Cost / context meter | ✅ | ✅ `/cost`, `/status` | — |

**What XYRO has that Claude Code doesn't** — lean into these:
- **Any model, any provider**, including free tiers (Groq, OpenRouter, DeepSeek), local models (Ollama/LM Studio) and live model catalog. Claude Code is Claude-only.
- **Built-in AST tools** (`ast_inspect_file`, `ast_find_symbol`) — structural code nav without a language server.
- **Mouse selection + OSC 52 copy** inside a full-screen TUI, theme picker, agent personas (Tab).
- **Rich first-class git/gh tool surface** (20 tools).

**Things neither does well yet** → XYRO differentiators (§4).

---

## P1 — Core parity

### Agent & context
- [ ] Load `XYRO.md` / `AGENTS.md` / `CLAUDE.md` hierarchically (user → repo root → subdir), inject into system prompt; `#` prefix appends a memory.
- [ ] Plan mode: read-only tool subset, ends with an `exit_plan` tool that renders the plan for approval.
- [ ] Permission modes cycled with **Shift+Tab**: `ask` → `accept-edits` → `plan` → `yolo`; shown in footer.
- [ ] Persisted permission rules: `.xyro/settings.json` → `{"allow": ["run_command(npm test*)"], "deny": [...]}`. "Always allow this" option in the approval modal.
- [ ] Checkpoints: snapshot touched files before each turn (shadow git repo under `~/.local/share/xyro/checkpoints`), `/rewind` + Esc Esc picker.
- [ ] Prompt caching for Anthropic (`cache_control` on system + tools) and OpenAI (stable prefix ordering).
- [ ] Show reasoning/thinking tokens in a collapsible dim block.
- [ ] Parallel read-only tool calls (`Promise.all` for reads/searches; serialize writes).
- [ ] Smarter compaction: keep file paths touched, open todos, last error; show "compacted" divider in transcript.

### Extensibility
- [ ] **MCP client** (`@modelcontextprotocol/sdk`): stdio + streamable HTTP, `.xyro/mcp.json`, `/mcp` panel showing servers/tools/status; namespace tools `mcp__server__tool`.
- [ ] **Hooks**: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`; shell commands receiving JSON on stdin, exit code 2 = block with reason.
- [ ] **Skills**: scan `.xyro/skills/*/SKILL.md` + `~/.xyro/skills`, put name+description in system prompt, `use_skill` tool loads body. (Reuse `.agents/skills/` convention already in repo.)
- [ ] **Custom commands**: `.xyro/commands/*.md` with `$ARGUMENTS` → slash commands.
- [ ] **Custom sub-agents**: `.xyro/agents/*.md` frontmatter (`tools`, `model`, `description`).

### Input UX
- [ ] `@` fuzzy file picker (fast-glob + fuzzy score), inserts path; `@dir/` expands.
- [ ] Image paste (clipboard → base64) for vision models.
- [ ] Multiline input (Shift+Enter / `\` + Enter), bracketed paste, Ctrl+R history search, Ctrl+E open `$EDITOR`.
- [ ] Esc interrupts the running turn (AbortController through `callLLMStream` + `execa`).

### Edits
- [ ] Every `write_file`/`edit_file` approval shows a colored unified diff (word-level highlights) in the modal; `a` = accept, `r` = reject, `e` = edit.
- [ ] After edits: optional auto-run of `lint`/`typecheck`/`test` via hooks, feed failures back.

---

## P2 — Differentiators ("next best agent")

- [ ] **Model router**: cheap/fast model for search/summarize/sub-agents, strong model for edits; per-agent model in frontmatter. Free-tier failover chain (already partly built — restore it).
- [ ] **Local-first mode**: one-key Ollama / LM Studio setup, auto-detect running servers, tool-call shim for models without native function calling.
- [ ] **Repo map**: tree-sitter/ts-morph symbol index (Aider-style), ranked by relevance, injected under a token budget. Reuse `ast.ts`.
- [ ] **Semantic search** over the repo (local embeddings, cached in `.xyro/index`).
- [ ] **Parallel agents in worktrees** (`/fork`, `/agents` dashboard showing each agent's live status, diff and cost; merge back).
- [ ] **Session replay & share**: export transcript to HTML/Markdown with tool calls collapsible.
- [ ] **Test-driven loop mode**: `xyro fix "npm test"` — loop until green with budget/iteration caps.
- [ ] **Headless/SDK**: `xyro -p "…" --output-format stream-json`, stable JSON events, exit codes; GitHub Action wrapper.
- [ ] Web search tool (provider-agnostic: Brave/Tavily/SearXNG key).
- [ ] Background shell tasks (`run_command` with `background: true`, `/tasks` panel, tail output).
- [ ] Cost guardrails: per-session budget, warn at 80%, hard stop.

---

## 3. Marvelous TUI — rendering & motion plan

Guided by `.agents/skills/tui-design/SKILL.md` and current agent TUIs (pi-tui, OpenTUI/opencode, Bubble Tea/Harmonica).

### 3.1 Engine (do first — everything else depends on it)
- [ ] **Differential rendering**: keep previous frame as `string[]` of rendered rows; emit only changed rows (`CSI row;1H` + row). Later: cell-level diff.
- [ ] **Synchronized output**: wrap each frame in `CSI ?2026h … CSI ?2026l` → no tearing in Kitty, WezTerm, Ghostty, iTerm2, Windows Terminal, foot.
- [ ] **Render scheduler**: `requestRender()` coalesces to ≤ 60 fps while streaming, ~10 fps for spinners, **0 fps when idle** (stop the 80 ms `setInterval` when nothing animates).
- [ ] **Single `write()` per frame**, cursor hidden during paint.
- [ ] **Capability detection**: truecolor (`COLORTERM`), 256, 16, `NO_COLOR`; Kitty keyboard protocol for Shift+Enter; graceful fallbacks.
- [ ] **Offscreen test renderer**: render to buffer and snapshot-test frames (pickers, modals, diff view).
- [ ] **Smooth streaming text**: buffer tokens and reveal at a steady chars/frame instead of network bursts.

### 3.2 Motion system (`src/tui/motion.ts`)
- [ ] Port **Harmonica-style damped spring** (~40 LOC): `spring(fps, angularFreq, damping)` → `update(pos, vel, target)`. Use for modal slide-in, scroll inertia, progress bars, context meter.
- [ ] Easing helpers (`easeOutCubic`, `easeInOutQuad`) + tween timeline with cancel-on-input (never delay a keypress).
- [ ] Respect `XYRO_REDUCED_MOTION=1` / `--no-animations` → instant transitions.

### 3.3 Signature visuals
- [ ] **Shimmer status line**: "Thinking…" with a moving truecolor highlight band (per-char gradient), elapsed seconds + token count + "esc to interrupt".
- [ ] **Animated logo intro** (≤ 600 ms, skippable, once per session): gradient sweep across the ASCII mark, then settle into the header.
- [ ] **Tool call cards**: `● Read src/app.ts` → spinner while running → ✓/✗ with duration; collapsible output (Ctrl+O to expand).
- [ ] **Live todo widget** pinned above the prompt: `☐ / ◐ / ☑`, current item shimmering.
- [ ] **Diff viewer**: side-by-side when width ≥ 140 cols, unified otherwise; syntax-highlighted (shiki → ANSI), word-level change marks.
- [ ] **Markdown**: syntax-highlighted code fences, tables with box drawing, OSC 8 clickable links and file paths (`file:line`).
- [ ] **Context meter**: thin bar in footer (`▰▰▰▱▱ 62%`) animating with spring, turns amber > 80%.
- [ ] **Command palette** (Ctrl+P, exists) → fuzzy match highlighting, recent commands first, keybinding hints.
- [ ] **Toasts**: top-right transient notices (saved, compacted, model switched) that fade out over 2 s.
- [ ] **Sub-agent dashboard**: one row per agent with sparkline of tokens/sec, status dot, elapsed.
- [ ] **Help tiers**: footer shows 5 contextual keys; `?` opens full keymap overlay.
- [ ] Spinners only after 200 ms delay to avoid flashes on fast tools.
- [ ] Desktop notification (OSC 9 / OSC 777) + terminal bell when a long turn finishes or needs approval.

### 3.4 Accessibility & compatibility
- [ ] Usable in monochrome (symbols + layout, not color, carry meaning); test 16-color mode.
- [ ] Shift+click bypasses mouse capture for native selection; `--no-mouse` flag.
- [ ] Works over SSH and in tmux (passthrough for OSC 52 / sync output), Windows Terminal, macOS Terminal.app (no truecolor → 256 fallback).
- [ ] Resize: immediate reflow, no animation.

---

## P3 — Polish & distribution

- [ ] `npx xyro-cli` cold-start < 300 ms (lazy-load ts-morph, Anthropic SDK, catalog).
- [ ] Single-file binaries via `bun build --compile` / Node SEA for Linux/macOS/Windows; Homebrew + AUR + Scoop.
- [ ] Auto-update check (non-blocking), `xyro doctor` for env diagnostics.
- [ ] Telemetry opt-in only; crash reports with redacted paths.
- [ ] Docs site with GIF demos (vhs tapes checked into `docs/tapes/`).
- [ ] VS Code extension that opens diffs from the TUI (later).

---

## Suggested order of work

1. P0 list (restore tools/features → tests green → sub-agent gate → renderer diff + idle).
2. Render engine §3.1 + motion §3.2 (foundation for all UI work).
3. MCP + hooks + skills + XYRO.md (ecosystem parity).
4. Plan mode, permission modes, checkpoints, diff approvals.
5. Signature visuals §3.3.
6. Differentiators (router, local-first, repo map, parallel worktree agents).

---

### References
- [pi-tui differential rendering architecture](https://instagit.com/badlogic/pi-mono/pi-tui-differential-rendering-architecture/)
- [oh-my-pi TUI runtime internals](https://gitcode.com/tonyliux/oh-my-pi/blob/main/docs/tui-runtime-internals.md)
- [agentui (Go) — cell diff + CSI 2026](https://pkg.go.dev/github.com/minoism/agentui)
- [OpenTUI (powers opencode) — React/Zig TUI](https://betterstack.com/community/guides/scaling-nodejs/opentui-react.md) · [timeline animations guide](https://www.mintlify.com/anomalyco/opentui/guides/animations)
- [charmbracelet/harmonica — spring animation](https://github.com/charmbracelet/harmonica)
- [handleui/shimmer — shimmer text spinner](https://pkg.go.dev/github.com/handleui/shimmer)
- [ora — Node spinners](https://docsearch.algolia.com/mcp/docs/repo/sindresorhus/ora)
- In-repo: `.agents/skills/tui-design/SKILL.md` (layout, color tiers, flicker-free stack, anti-patterns)
