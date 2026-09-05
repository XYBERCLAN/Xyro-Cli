import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Message } from "./types.js";
import { SYSTEM_PROMPT, PLAN_MODE_INSTRUCTIONS } from "../config/constants.js";
import { getHistoryDir, getEnvironmentContext } from "../config/platform.js";
import { loadProjectContext } from "../config/loader.js";
import { loadSkills } from "../config/skills.js";
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
    const skills = loadSkills();
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
