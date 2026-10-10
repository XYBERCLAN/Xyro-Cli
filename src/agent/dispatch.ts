// Dispatch — the moment the user writes, the right experts get ready.
//
// XYRO used to leave planning and delegation entirely to the model, and free
// models often skip both: they dive in alone, with no plan the user can see.
// Dispatch makes coordination part of every turn, in code:
//
//   1. The request is recognised (the router: triggers, descriptions, and
//      what worked before) and the experts for it are picked. The UI wakes
//      them up right away, so the user sees who is on it.
//   2. Multi-step requests get a short coordinator note with the turn: plan
//      with write_todos first (each step names its expert), then hand the
//      specialised steps to those experts.
//   3. If the model starts working without a plan anyway, it is reminded
//      once (see Agent.run).
// Small questions and one-step requests get no note: XYRO just answers.

import { routeTask } from "../agents/router.js";
import { getExperts } from "../agents/experts.js";

export interface Dispatch {
  /** Experts ready for this request, best first */
  team: { name: string; title: string; why: string }[];
  multiStep: boolean;
  /** Coordinator note added to the user's message (empty when none is needed) */
  note: string;
  /** Tight request budget: no plan reminder, fewer expert steps */
  frugal?: boolean;
}

const QUESTION = /^(what|why|how|who|where|when|which|is|are|does|do|can|could|should|explain|tell me|show me)\b/i;
const ACTION = /\b(add|build|create|implement|make|fix|refactor|migrate|rewrite|write|update|change|remove|delete|set ?up|configure|deploy|test|optimi[sz]e|integrate|convert|upgrade|design)\b/gi;

/** Rough but useful: does this request need several steps? */
export function looksMultiStep(text: string): boolean {
  const t = text.trim();
  if (t.length < 25) return false;
  const actions = new Set((t.match(ACTION) ?? []).map((a) => a.toLowerCase())).size;
  const listed = (t.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) ?? []).length;
  const joined = (t.match(/\b(and then|then|also|after that|plus)\b|,/gi) ?? []).length;
  if (listed >= 2) return true;
  if (QUESTION.test(t) && actions === 0) return false;
  return actions >= 2 || (actions >= 1 && (joined >= 2 || t.length > 160));
}

export function dispatchFor(text: string, budget: { frugal: boolean; left?: number } = { frugal: false }): Dispatch | null {
  const t = text.trim();
  if (!t || t.startsWith("[") || t.startsWith("/")) return null;
  const ranked = routeTask(t).filter((r) => r.score > 0 && r.expert.name !== "verifier");
  const multiStep = looksMultiStep(t);
  if (!ranked.length && !multiStep) return null;

  const top = ranked[0]?.score ?? 0;
  const team = ranked
    .filter((r) => r.score >= Math.max(1.5, top * 0.5))
    .slice(0, multiStep ? 3 : 1)
    .map((r) => ({ name: r.expert.name, title: r.expert.title, why: r.reasons[0] ?? "fits the request" }));
  // A multi-step build with no clear specialist still gets a builder and a tester
  if (multiStep && !team.length) {
    for (const n of ["builder", "tester"]) {
      const e = getExperts().find((x) => x.name === n);
      if (e) team.push({ name: e.name, title: e.title, why: "general work" });
    }
  }

  // A tight daily request budget changes the play: fewer, fuller steps, little delegation
  if (budget.frugal) {
    const left = budget.left !== undefined ? ` (about ${budget.left} requests left today on this provider)` : "";
    const frugalNote = `[coordinator] Request budget is tight${left}. Every step costs one request, and every expert step costs one too. Work directly in as few steps as possible: batch independent tool calls in ONE response, write whole files instead of many small edits, skip write_todos unless the job is long, and delegate only what you truly cannot do yourself.`;
    return { team, multiStep, note: multiStep || budget.left !== undefined ? frugalNote : "", frugal: true };
  }

  const note = multiStep
    ? `[coordinator] Multi-step request. Ready experts: ${team.map((m) => `${m.name} (${m.why})`).join(", ")}.
1. First call write_todos with the plan: short steps, one in_progress, each with "expert" set to who owns it (e.g. "builder").
2. Hand each specialised step to its expert with delegate (independent steps together with delegate_team); do quick steps yourself.
3. Keep the list current as steps finish, verify the result, then reply.`
    : "";
  return { team, multiStep, note };
}
