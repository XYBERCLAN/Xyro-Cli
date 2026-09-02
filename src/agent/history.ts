import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Message } from "./types.js";
import { SYSTEM_PROMPT, HISTORY_FILE } from "../config/constants.js";
import { loadProjectContext } from "../config/loader.js";
import { historyToMarkdown } from "./usage.js";

type ResponseListener = (usage: unknown) => void;export class HistoryManager {
  private messages: Message[] = [];
  private listeners: ResponseListener[] = [];

  constructor() {
    this.reset();
  }

  onResponse(listener: ResponseListener): void {
    this.listeners.push(listener);
  }

  emitResponse(response: { usage?: unknown }): void {
    for (const l of this.listeners) l(response.usage);
  }

  systemMessage(): Message {
    let systemContent = SYSTEM_PROMPT;
    const projectContext = loadProjectContext();
    if (projectContext) {
      systemContent += `\n\n## Project Context\n${projectContext}`;
    }
    return { role: "system", content: systemContent };
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
      writeFileSync(HISTORY_FILE, JSON.stringify(this.messages, null, 2), "utf-8");
    } catch {
      // silent fail
    }
  }

  load(): boolean {
    try {
      if (existsSync(HISTORY_FILE)) {
        const data = readFileSync(HISTORY_FILE, "utf-8");
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
