/**
 * ui-bridge — lets tools talk to whichever UI is running (full-screen TUI or
 * line mode) without importing it. The TUI registers listeners at start-up;
 * with no UI attached, plans auto-approve and todo updates are ignored.
 */

export type TodoStatus = "pending" | "in_progress" | "done";

export interface TodoView {
  text: string;
  status: TodoStatus;
  /** Expert who owns the step */
  expert?: string;
}

export interface PlanRequest {
  title: string;
  steps: string[];
  summary?: string;
}

export interface PlanDecision {
  approved: boolean;
  feedback?: string;
}

let todosListener: ((todos: TodoView[]) => void) | null = null;
let planApprover: ((plan: PlanRequest) => Promise<PlanDecision>) | null = null;

export function onTodosChanged(fn: ((todos: TodoView[]) => void) | null): void {
  todosListener = fn;
}

export function emitTodos(todos: TodoView[]): void {
  todosListener?.(todos);
}

export function setPlanApprover(fn: ((plan: PlanRequest) => Promise<PlanDecision>) | null): void {
  planApprover = fn;
}

/** Ask the user to approve a plan; approves automatically when no UI is attached. */
export async function requestPlanApproval(plan: PlanRequest): Promise<PlanDecision> {
  return planApprover ? planApprover(plan) : { approved: true };
}

// ── sub-agents (experts) ─────────────────────────────────────────────────────

export interface AgentActivity {
  id: number;
  expert: string;
  title: string;
  task: string;
  status: "running" | "done" | "failed";
  step: number;
  maxSteps: number;
  tool?: string;
  skills: string[];
  startedAt: number;
  endedAt?: number;
  /** Tokens spent so far, and the per-task budget */
  tokens?: number;
  budget?: number;
  model?: string;
}

let agentListener: ((a: AgentActivity) => void) | null = null;
let toolApprover: ((label: string) => Promise<boolean>) | null = null;

export function onAgentActivity(fn: ((a: AgentActivity) => void) | null): void {
  agentListener = fn;
}

export function emitAgentActivity(a: AgentActivity): void {
  agentListener?.({ ...a });
}

/** UI hook used by experts to ask the user before risky tools (null → caller decides). */
export function setToolApprover(fn: ((label: string) => Promise<boolean>) | null): void {
  toolApprover = fn;
}

export function getToolApprover(): ((label: string) => Promise<boolean>) | null {
  return toolApprover;
}
