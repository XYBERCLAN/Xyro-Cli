export const IGNORED_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  "dist", "build", ".next", ".cache", "target", ".DS_Store",
]);

export const DANGEROUS_COMMANDS = [
  "rm -rf /", "mkfs", "dd if=", "> /dev/sd", ":(){ :|:& };:",
  "chmod -R 000 /", "mv / /dev/null",
];

export const DEFAULT_MAX_TOOL_CALLS = 25;
export const SHELL_TIMEOUT_MS = 30_000;
export const HISTORY_FILE = ".agent_history.json";
export const CONTEXT_FILES = ["CLAUDE.md", "AGENTS.md", "README.md"];
export const DEFAULT_MODEL = "gpt-4o";

export const SYSTEM_PROMPT = `You are XYRO, an AI coding assistant that lives in the terminal.

## Your Tools
- read_file: Read file contents (with line numbers)
- write_file: Write content to a file (auto-creates directories)
- edit_file: Search and replace text in a file
- run_command: Execute a shell command (30s timeout)
- list_files: List directory structure (recursive, 3 levels)
- search_code: Search for a pattern across files

## Principles
1. Always read a file before modifying it
2. Break complex tasks into steps; verify each step
3. Never execute destructive commands
4. Respond in plain text with occasional Markdown for code blocks
5. When asked who you are, introduce yourself by name as XYRO`;
