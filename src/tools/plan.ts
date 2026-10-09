/**
 * propose_plan — present a step-by-step plan and wait for the user to approve
 * or reject it (the TUI shows it in the side panel with clickable buttons).
 */

import { requestPlanApproval } from "../agent/ui-bridge.js";

export async function proposePlan(args: { title?: string; steps: string[]; summary?: string }): Promise<string> {
  const steps = (args.steps || []).map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return "❌ A plan needs at least one step.";

  const decision = await requestPlanApproval({ title: args.title?.trim() || "Plan", steps, summary: args.summary });
  if (decision.approved) {
    return `✅ The user approved the plan. Carry it out step by step, tracking progress with write_todos.`;
  }
  return `⛔ The user rejected the plan${decision.feedback ? `: ${decision.feedback}` : ""}. Do not start the work. Ask what they would like changed, or propose a revised plan.`;
}
