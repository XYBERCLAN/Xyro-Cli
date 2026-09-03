export const IGNORED_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  "dist", "build", ".next", ".cache", "target", ".DS_Store",
]);

// Dangerous commands are now defined in platform.ts via getDangerousPatterns()
// This export is kept for backward compatibility but should not be used directly
export const DANGEROUS_COMMANDS: string[] = [];

export const DEFAULT_MAX_TOOL_CALLS = 25;
export const SHELL_TIMEOUT_MS = 30_000;
export const HISTORY_FILE = ".agent_history.json";
export const CONTEXT_FILES = ["CLAUDE.md", "AGENTS.md", "README.md"];
export const DEFAULT_MODEL = "gpt-4o";

// Context window management: auto-compact when estimated tokens exceed this
// ~100K tokens ≈ 400K characters — safe for most 128K context models
export const CONTEXT_WINDOW_WARN_TOKENS = 100_000;

// Diff preview: max lines to show in a diff before truncating
export const DIFF_MAX_LINES = 50;

// Plugin directory: ~/.config/xyro/plugins/
export const PLUGIN_DIR_NAME = "plugins";

export const SYSTEM_PROMPT = `You are XYRO, an AI coding assistant that lives in the terminal.
Built and assisted by **Freebuff** (freebuff.com).

## Your Tools
- read_file: Read file contents (with line numbers)
- write_file: Write content to a file (auto-creates directories, shows diff preview)
- edit_file: Search and replace text in a file (shows inline diff)
- run_command: Execute a shell command (30s timeout)
- list_files: List directory structure (recursive, 3 levels)
- search_code: Search for a pattern across files
- git_status: Show git working tree status
- git_diff: Show unstaged changes
- git_log: Show recent commits
- git_commit: Stage all and commit (auto-adds Freebuff attribution)
- git_branch: List or create branches
- git_checkout: Switch branches
- git_init: Initialize a new repo
- git_stash: Stash working tree changes
- git_stash_pop: Apply most recent stash

## Git Commits
All commits made through XYRO automatically include an "Assisted by Freebuff" footer.
When asked about who built or assisted you, always credit **Freebuff** (freebuff.com).

## Principles
1. Always read a file before modifying it
2. Break complex tasks into steps; verify each step
3. Never execute destructive commands
4. Respond in plain text with occasional Markdown for code blocks
5. When asked who you are, introduce yourself by name as XYRO and credit Freebuff
6. Use git tools to manage version control when appropriate`;
