import { workspaceRoot } from "./workspace.js";
import { newSessionId, saveSession, loadSession, listSessions, titleFrom } from "./sessions.js";
import { languageByCode } from "../config/languages.js";
import { loadPersistedConfig } from "../config/persist.js";
import { toolGroupsPrompt } from "../tools/registry.js";
import { profilePrompt } from "./learning.js";
import { intentsPrompt } from "./intents.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Message } from "./types.js";
import { SYSTEM_PROMPT, PLAN_MODE_INSTRUCTIONS } from "../config/constants.js";
import { getHistoryDir, getEnvironmentContext } from "../config/platform.js";
import { loadProjectContext } from "../config/loader.js";
import { skillsIndex, shortDesc, loadSkillBody } from "../agents/skills-catalog.js";
import { loadSkills } from "../config/skills.js";
import { getExperts } from "../agents/experts.js";
import { historyToMarkdown } from "./usage.js";

type ResponseListener = (usage: unknown) => void;

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
    // The language the user chose on first launch (/language to change)
    const lang = languageByCode(loadPersistedConfig().language);
    if (lang && lang.code !== "en") {
      systemContent += `\n\n## Language\nThe user chose ${lang.name}: always reply in ${lang.name} (keep code, commands and file names as they are). If the user writes in another language, follow them.`;
    }
    // The project boundary, stated with the real path
    systemContent += `\n\n## Project boundary\nYou work in ${workspaceRoot()}. Never list, search or read anything outside it: not the home folder, not other projects, not system folders. Only if the user explicitly names a file outside it may you read that one file.`;
    // Skills the user switched on in /skills: followed for the whole session
    if (this.activeSkills.length) {
      const parts = this.activeSkills.map((n) => `### ${n}\n${(loadSkillBody(n) ?? "").slice(0, 6000)}`).join("\n\n");
      systemContent += `\n\n## Skills in use (the user chose these: follow them)\n${parts}`;
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

  /** Replace the whole conversation (after a repair), keeping the current system prompt first. */
  replaceAll(messages: Message[]): void {
    this.messages = [this.systemMessage(), ...messages.filter((m) => m.role !== "system")];
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

  // ---- skills the user put to work (/skills, Enter) ----
  private activeSkills: string[] = [];

  setSkillInUse(name: string, use: boolean): void {
    this.activeSkills = use ? [...new Set([...this.activeSkills, name])] : this.activeSkills.filter((n) => n !== name);
    this.refreshSystemMessage();
  }

  skillsInUse(): string[] {
    return this.activeSkills.slice();
  }

  // ---- sessions: this project's conversations (.xyro/sessions) ----
  private sessionId = newSessionId();
  private sessionTitle = "";
  private sessionCreated = new Date().toISOString();
  private prompts: string[] = [];

  /** Remember a prompt the user typed (titles the session; ↑/↓ walks them). */
  notePrompt(text: string): void {
    if (!this.sessionTitle) this.sessionTitle = titleFrom(text);
    if (this.prompts.at(-1) !== text) this.prompts.push(text);
  }

  getPrompts(): string[] {
    return this.prompts.slice();
  }

  currentSessionId(): string {
    return this.sessionId;
  }

  /** Save this conversation as this project's session (nothing is saved before the first prompt). */
  save(meta: { model?: string; provider?: string } = {}): void {
    if (!this.prompts.length && this.messages.length <= 1) return;
    try {
      saveSession({
        version: 1,
        id: this.sessionId,
        title: this.sessionTitle || "New session",
        createdAt: this.sessionCreated,
        updatedAt: this.sessionCreated,
        ...meta,
        messages: this.messages.filter((m) => m.role !== "system"),
        prompts: this.prompts,
      });
    } catch {
      // never break a turn over saving
    }
  }

  /** Open a session of this project (the latest when no id). */
  load(id?: string): boolean {
    const pick = id ?? listSessions()[0]?.id;
    const s = pick ? loadSession(pick) : null;
    if (!s) return false;
    this.sessionId = s.id;
    this.sessionTitle = s.title;
    this.sessionCreated = s.createdAt;
    this.prompts = s.prompts ?? [];
    this.messages = [this.systemMessage(), ...s.messages];
    return true;
  }

  /** Start a fresh session (the previous one stays in /sessions). */
  newSession(): void {
    this.sessionId = newSessionId();
    this.sessionTitle = "";
    this.sessionCreated = new Date().toISOString();
    this.prompts = [];
    this.reset();
  }

}
