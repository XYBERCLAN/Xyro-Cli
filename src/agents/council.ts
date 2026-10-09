// Council — experts discuss, share ideas and decide together before acting.
//
// Why: one expert sees a task through one lens. The architect worries about
// structure, the security expert about trust boundaries, the tester about
// what can break. Asked separately, they each produce a partial plan; asked
// together, they catch each other's blind spots. So for decisions that are
// expensive to get wrong, XYRO convenes a council:
//
//   1. PROPOSE  — each member investigates (read-only) and proposes an
//                 approach, its risks, and who should own which part.
//   2. DISCUSS  — each member reads every proposal, says what it agrees or
//                 disagrees with, and votes for the best one.
//   3. DECIDE   — the author of the winning proposal writes the final
//                 decision, folding in the concerns raised.
//   4. (EXECUTE) — optionally the decided assignments run as a team, with
//                 the decision as shared context.
//
// Proposals and the decision are posted to the team board so everyone who
// works on the request afterwards sees them.

import { getExpert, Expert } from "./experts.js";
import { routeTask } from "./router.js";
import { runExpert } from "./runtime.js";
import { postNote } from "./team-board.js";
import { TOOL_GROUPS } from "./experts.js";
import { delegateTeam } from "../tools/delegate.js";

const READ_ONLY = new Set([...TOOL_GROUPS.read, "team_notes", "skill_search", "git_status", "git_diff", "git_log"]);
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;

export interface CouncilArgs {
  goal: string;
  /** Members by name (default: the experts best suited to the goal) */
  experts?: string[];
  /** Run the decided assignments as a team afterwards */
  execute?: boolean;
}

export interface Assignment {
  expert: string;
  task: string;
}

/** "- builder: add the route" lines → assignments (known experts only). */
export function parseAssignments(text: string): Assignment[] {
  const section = text.split(/^\s*ASSIGNMENTS:\s*$/im)[1] ?? "";
  const out: Assignment[] = [];
  for (const m of section.matchAll(/^\s*[-*]\s*([a-z][a-z0-9-]*)\s*[:—-]\s*(.+)$/gim)) {
    const e = getExpert(m[1]);
    if (e && e.name !== "verifier") out.push({ expert: e.name, task: m[2].trim() });
  }
  return out.slice(0, 6);
}

/** Tally "VOTE: name" lines; ties go to the member listed first (the router's best fit). */
export function tallyVotes(members: string[], ballots: string[]): { winner: string; votes: Record<string, number> } {
  const votes: Record<string, number> = Object.fromEntries(members.map((m) => [m, 0]));
  for (const b of ballots) {
    const m = b.match(/VOTE:\s*([a-z][a-z0-9-]*)/i);
    const name = m ? getExpert(m[1])?.name : undefined;
    if (name && name in votes) votes[name]++;
  }
  const winner = members.reduce((best, m) => (votes[m] > votes[best] ? m : best), members[0]);
  return { winner, votes };
}

function pickMembers(goal: string, names?: string[]): Expert[] {
  let members: Expert[] = [];
  if (names?.length) members = names.map((n) => getExpert(n)).filter((e): e is Expert => Boolean(e) && e!.name !== "verifier");
  if (members.length < MIN_MEMBERS) {
    for (const r of routeTask(goal)) {
      if (members.length >= 3) break;
      if (r.score > 0 && r.expert.name !== "verifier" && !members.some((m) => m.name === r.expert.name)) members.push(r.expert);
    }
  }
  for (const fallback of ["architect", "reviewer"]) {
    if (members.length >= MIN_MEMBERS) break;
    const e = getExpert(fallback);
    if (e && !members.some((m) => m.name === e.name)) members.push(e);
  }
  return members.slice(0, MAX_MEMBERS);
}

export async function council(args: CouncilArgs): Promise<string> {
  const goal = (args.goal || "").trim();
  if (!goal) return "❌ council: `goal` is required.";
  const members = pickMembers(goal, args.experts);
  if (members.length < MIN_MEMBERS) return "❌ council: needs at least 2 experts.";
  const roster = members.map((m) => `${m.name} (${m.title})`).join(", ");
  const everyone = members.map((m) => m.name).join(", ");

  // 1. PROPOSE — in parallel, read-only
  const proposals = await Promise.all(
    members.map((m) =>
      runExpert(
        m,
        `You sit on a council with: ${roster}. Goal: ${goal}\n\nInvestigate as much as you need (read-only), then propose how the TEAM should do it, from your specialty's point of view. Reply in exactly this format:\nAPPROACH: <the plan, concrete>\nRISKS: <what could go wrong>\nASSIGNMENTS:\n- <expert name>: <task>\n(one line per task; experts: ${everyone}, or any other XYRO expert)`,
        { toolFilter: (t) => READ_ONLY.has(t), label: "proposing" }
      )
    )
  );
  proposals.forEach((p, i) => postNote(members[i].title, `Proposal: ${p.output.slice(0, 600)}`));
  const proposalText = proposals.map((p, i) => `### ${members[i].name} proposes\n${p.output.slice(0, 2500)}`).join("\n\n");

  // 2. DISCUSS — everyone reads everything, talks, votes
  const ballots = await Promise.all(
    members.map((m) =>
      runExpert(
        m,
        `Council goal: ${goal}\n\nHere are all proposals, including yours:\n\n${proposalText}\n\nDiscuss as a teammate: what do you agree with, what worries you, what would you change? Be brief and specific. Then vote for the proposal the team should follow (yours only if no other is acceptable). End with exactly one line: VOTE: <expert name>`,
        { toolFilter: () => false, label: "discussing" }
      )
    )
  );
  const { winner, votes } = tallyVotes(
    members.map((m) => m.name),
    ballots.map((b) => b.output)
  );
  const discussion = ballots.map((b, i) => `### ${members[i].name}\n${b.output.slice(0, 1500)}`).join("\n\n");

  // 3. DECIDE — the winner writes the final decision, folding in concerns
  const lead = members.find((m) => m.name === winner)!;
  const decision = await runExpert(
    lead,
    `The council chose your proposal for: ${goal}\n\nProposals:\n${proposalText}\n\nDiscussion:\n${discussion}\n\nWrite the FINAL decision the team will follow. Address every concern raised (accept or explain why not). Reply in exactly this format:\nDECISION: <what we will do and why>\nASSIGNMENTS:\n- <expert name>: <task>`,
    { toolFilter: () => false, label: "deciding" }
  );
  const assignments = parseAssignments(decision.output);
  postNote(`Council (${lead.title})`, `Decision: ${decision.output.slice(0, 1200)}`);

  const tally = Object.entries(votes)
    .sort((a, b) => b[1] - a[1])
    .map(([n, v]) => `${n} ${v}`)
    .join(" · ");
  const sections = [
    `Council on "${goal.slice(0, 100)}" — members: ${roster}`,
    `Votes: ${tally} → the ${lead.title}'s proposal`,
    `Decision:\n${decision.output.slice(0, 4000)}`,
    `Proposals (summary):\n${proposals.map((p, i) => `- ${members[i].name}: ${p.output.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}`,
    `Discussion (summary):\n${ballots.map((b, i) => `- ${members[i].name}: ${b.output.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}`,
  ];

  // 4. EXECUTE — the decided assignments, as one team, with the decision as context
  if (args.execute) {
    if (!assignments.length) sections.push("Not executed: the decision had no ASSIGNMENTS lines.");
    else {
      const context = `The council decided:\n${decision.output.slice(0, 3000)}`;
      sections.push(await delegateTeam({ tasks: assignments.map((a) => ({ task: a.task, expert: a.expert, context })) }));
    }
  } else if (assignments.length) {
    sections.push(`Assignments ready (run with execute: true, or delegate_team):\n${assignments.map((a) => `- ${a.expert}: ${a.task}`).join("\n")}`);
  }
  return sections.join("\n\n");
}
