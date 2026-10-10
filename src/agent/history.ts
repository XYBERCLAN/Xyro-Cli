import { toolGroupsPrompt } from "../tools/registry.js";
import { profilePrompt } from "./learning.js";
import { intentsPrompt } from "./intents.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Message } from "./types.js";
import { SYSTEM_PROMPT, PLAN_MODE_INSTRUCTIONS } from "../config/constants.js";
import { getHistoryDir, getEnvironmentContext } from "../config/platform.js";
import { loadProjectContext } from "../config/loader.js";
import { skillsIndex, shortDesc } from "../agents/skills-catalog.js";
import { loadSkills } from "../config/skills.js";
import { getExperts } from "../agents/experts.js";
import { historyToMarkdown } from "./usage.js";

type ResponseListener = (usage: unknown) => void;

function historyFilePath(): string {
  return join(getHistoryDir(), "session.json");
}

export class HistoryManager {
  private messages: Message[] = [];
  private listeners: ResponseListener[] = [];
  private planMode = false;

  constructor() {
    this.reset();
  }

  setPlanMode(enabled: boolean): void {
    this.planMode = enabled;
  }

  isPlanMode(): boolean {
    return this.planMode;
  }

  onResponse(listener: ResponseListener): void {
    this.listeners.push(listener);
  }

  emitResponse(response: { usage?: unknown }): void {
    for (const l of this.listeners) l(response.usage);
  }

  systemMessage(): Message {
    let systemContent = `${SYSTEM_PROMPT}\n\n${getEnvironmentContext()}`;
    if (this.planMode) {
      systemContent += `\n\n${PLAN_MODE_INSTRUCTIONS}`;
    }
    const projectContext = loadProjectContext();
    if (projectContext) {
      systemContent += `\n\n## Project Context\n${projectContext}`;
    }
    // Team roster: the experts XYRO can activate with delegate / delegate_team
    const roster = getExperts()
      .map((e) => `- ${e.name}: ${shortDesc(e.description, 60)}${e.source !== "builtin" ? ` (${e.source})` : ""}`)
      .join("\n");
    systemContent += `\n\n## Your team\n${roster}`;
    // Loose SKILL.md files are project guidance: always in the prompt (small, capped)
    const guidance = loadSkills();
    if (guidance) {
      systemContent += `\n\n${guidance}`;
    }
    // Specialised tool groups are loaded on demand (keeps every request small)
    const groups = toolGroupsPrompt();
    if (groups) systemContent += `\n\n${groups}`;
    // What XYRO learned about how this user works (evidence-backed, capped)
    const profile = profilePrompt();
    if (profile) systemContent += `\n\n${profile}`;
    // When XYRO's distinctive tools pay off (kept short: the tool descriptions hold the details)
    systemContent += `\n\n## Power moves\n- tournament: for a hard change with an objective check (tests or a check command), when one attempt may fail. Not for trivial edits.\n- skill_forge: after a non-obvious procedure was solved and verified, save it so the team reuses it.\n- skill_search: before a specialised task, look for an installed skill.\n- council: for decisions that are expensive to get wrong, let the experts propose, debate and vote before anyone writes code.`;
    // Intent guard: lasting requirements that must keep holding
    systemContent += `\n\n${intentsPrompt()}`;
    // Skill libraries: index only — experts load full skill text when their task needs it
    const skills = skillsIndex();
    if (skills) {
      systemContent += `\n\n${skills}`;
    }
    return { role: "system", content: systemContent };
  }

  /** Rebuild the system message in place (e.g. after toggling plan mode or adding skills). */
  refreshSystemMessage(): void {
    if (this.messages.length > 0) {
      this.messages[0] = this.systemMessage();
    }
  }

  reset(): void {
    this.messages = [this.systemMessage()];
  }

  resetWithSummary(summary: string): void {
    const sys = this.systemMessage();
    this.messages = [
      sys,
      {
        role: "system",
        content: `## Previous Conversation (compacted summary)\n${summary}`,
      },
    ];
  }

  /**
   * Compaction v2: keep a summary of the older history AND a verbatim tail of
   * the most recent turn(s) so the model retains its immediate working state.
   */
  resetWithSummaryAndRecent(summary: string, recent: Message[]): void {
    const sys = this.systemMessage();
    const sumMsg: Message = {
      role: "system",
      content: `## Previous Conversation\n${summary}`,
    };
    this.messages = [sys, sumMsg, ...recent];
  }

  add(msg: Message): void {
    this.messages.push(msg);
  }

  getAll(): Message[] {
    return this.messages;
  }

  /** Cut the conversation back to `length` messages (the system message always stays). */
  truncate(length: number): void {
    this.messages.length = Math.max(1, Math.min(length, this.messages.length));
  }

  toMarkdown(): string {
    return historyToMarkdown(this.messages);
  }

  save(): void {
    try {
      const filePath = historyFilePath();
      const dir = getHistoryDir();
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, JSON.stringify(this.messages, null, 2), "utf-8");
    } catch {
      // silent fail
    }
  }

  load(): boolean {
    try {
      const filePath = historyFilePath();
      if (existsSync(filePath)) {
        const data = readFileSync(filePath, "utf-8");
        this.messages = JSON.parse(data);
        return true;
      }
    } catch {
      // corrupted file, reset
      this.reset();
    }
    return false;
  }
}
