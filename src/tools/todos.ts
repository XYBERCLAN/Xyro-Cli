/**
 * write_todos — In-session task tracker.
 * Persists a todo list to ~/.xyro/todos.json for the duration of the session.
 * The LLM can update it to plan multi-step tasks and avoid losing track.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TODOS_DIR = join(homedir(), ".xyro");
const TODOS_FILE = join(TODOS_DIR, "todos.json");

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

function loadTodos(): TodoItem[] {
  try {
    if (!existsSync(TODOS_FILE)) return [];
    const raw = readFileSync(TODOS_FILE, "utf-8");
    return JSON.parse(raw) as TodoItem[];
  } catch {
    return [];
  }
}

function saveTodos(todos: TodoItem[]): void {
  if (!existsSync(TODOS_DIR)) mkdirSync(TODOS_DIR, { recursive: true });
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2), "utf-8");
}

function renderTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "No todos.";
  const lines = todos.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.id}. ${t.text}`);
  return `Todos:\n${lines.join("\n")}`;
}

export async function writeTodos(args: {
  todos?: string[];
  mark_done?: number[];
  clear?: boolean;
}): Promise<string> {
  let todos = loadTodos();

  if (args.clear) {
    todos = [];
    saveTodos(todos);
    return "Todos cleared.";
  }

  // Add new todos
  if (args.todos && args.todos.length > 0) {
    const nextId = todos.length > 0 ? Math.max(...todos.map((t) => t.id)) + 1 : 1;
    for (let i = 0; i < args.todos.length; i++) {
      todos.push({ id: nextId + i, text: args.todos[i], done: false });
    }
  }

  // Mark done
  if (args.mark_done && args.mark_done.length > 0) {
    for (const id of args.mark_done) {
      const item = todos.find((t) => t.id === id);
      if (item) item.done = true;
    }
  }

  saveTodos(todos);
  return renderTodos(todos);
}

export async function readTodos(): Promise<string> {
  return renderTodos(loadTodos());
}
