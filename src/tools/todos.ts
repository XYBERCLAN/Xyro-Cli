/**
 * write_todos — In-session task tracker.
 * Persists a todo list to ~/.xyro/todos.json for the duration of the session.
 * The LLM can update it to plan multi-step tasks and avoid losing track.
 */

import { getExpert } from "../agents/experts.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { emitTodos, TodoStatus } from "../agent/ui-bridge.js";

const TODOS_DIR = join(homedir(), ".xyro");
const TODOS_FILE = join(TODOS_DIR, "todos.json");

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  status?: TodoStatus;
  /** Expert who owns this step (shown in the task panel; wakes them while in progress) */
  expert?: string;
}

function statusOf(t: TodoItem): TodoStatus {
  return t.done ? "done" : t.status ?? "pending";
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
  emitTodos(todos.map((t) => ({ text: t.text, status: statusOf(t), ...(t.expert ? { expert: t.expert } : {}) })));
}

function renderTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "No todos.";
  const mark = { done: "[x]", in_progress: "[~]", pending: "[ ]" } as const;
  const lines = todos.map((t) => `${mark[statusOf(t)]} ${t.id}. ${t.text}${t.expert ? ` (${t.expert})` : ""}`);
  return `Todos:\n${lines.join("\n")}`;
}

export async function writeTodos(args: {
  items?: { text: string; status: TodoStatus; expert?: string }[];
  todos?: string[];
  mark_done?: number[];
  clear?: boolean;
}): Promise<string> {
  let todos = loadTodos();

  // Replace the whole list (preferred: the model restates every item + status)
  if (args.items) {
    todos = args.items.map((it, i) => {
      const owner = it.expert ? getExpert(it.expert)?.name : undefined;
      return { id: i + 1, text: it.text, done: it.status === "done", status: it.status, ...(owner ? { expert: owner } : {}) };
    });
    saveTodos(todos);
    return renderTodos(todos);
  }

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
