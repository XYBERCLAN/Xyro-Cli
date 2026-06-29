import OpenAI from "openai";
import { Tool } from "../agent/types.js";
import { readFile } from "./read.js";
import { writeFile, editFile } from "./write.js";
import { runCommand } from "./shell.js";
import { listFiles } from "./fs.js";
import { searchCode } from "./search.js";

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: properties as Record<string, unknown>,
        required,
      },
    },
  };
}

export const tools: Tool[] = [
  {
    definition: def("read_file", "Read file contents with line numbers", {
      path: { type: "string", description: "File path to read" },
    }, ["path"]),
    execute: (args) => readFile(args as { path: string }),
  },
  {
    definition: def("write_file", "Write content to a file (creates directories)", {
      path: { type: "string", description: "File path" },
      content: { type: "string", description: "Complete file content" },
    }, ["path", "content"]),
    execute: (args) => writeFile(args as { path: string; content: string }),
  },
  {
    definition: def("edit_file", "Replace text in a file (first occurrence)", {
      path: { type: "string", description: "File path" },
      old_text: { type: "string", description: "Text to find" },
      new_text: { type: "string", description: "Replacement text" },
    }, ["path", "old_text", "new_text"]),
    execute: (args) => editFile(args as { path: string; old_text: string; new_text: string }),
  },
  {
    definition: def("run_command", "Execute a shell command (30s timeout)", {
      command: { type: "string", description: "Shell command to execute" },
    }, ["command"]),
    execute: (args) => runCommand(args as { command: string }),
  },
  {
    definition: def("list_files", "List directory structure (recursive, 3 levels)", {
      path: { type: "string", description: "Directory path" },
    }, []),
    execute: (args) => listFiles(args as { path?: string }),
  },
  {
    definition: def("search_code", "Search for a pattern across files", {
      pattern: { type: "string", description: "Search pattern" },
      path: { type: "string", description: "Search directory" },
    }, ["pattern"]),
    execute: (args) => searchCode(args as { pattern: string; path?: string }),
  },
];

export function getToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => t.definition);
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = tools.find((t) => t.definition.function.name === name);
  if (!tool) return `❌ Unknown tool: ${name}`;
  try {
    return await tool.execute(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ ${name} error: ${msg}`;
  }
}
