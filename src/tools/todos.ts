/**
 * write_todos — In-session task tracker.
 * Keeps the task list in memory for this session (shown live in the side panel).
 * The LLM can update it to plan multi-step tasks and avoid losing track.
 */

import { getExpert } from "../agents/experts.js";
import { emitTodos, TodoStatus } from "../agent/ui-bridge.js";


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

// The task list belongs to this session and this project only. (It used to live in
// one global file, so a plan from another project or an old session leaked in.)
let sessionTodos: TodoItem[] = [];

function loadTodos(): TodoItem[] {
  return sessionTodos.map((t) => ({ ...t }));
}

function saveTodos(todos: TodoItem[]): void {
  sessionTodos = todos.map((t) => ({ ...t }));
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
