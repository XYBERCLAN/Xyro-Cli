import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Message } from "./types.js";
import { SYSTEM_PROMPT } from "../config/constants.js";
import { getHistoryDir, getEnvironmentContext } from "../config/platform.js";
import { loadProjectContext } from "../config/loader.js";
import { historyToMarkdown } from "./usage.js";

type ResponseListener = (usage: unknown) => void;

function historyFilePath(): string {
  return join(getHistoryDir(), "session.json");
}

export class HistoryManager {
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
    let systemContent = `${SYSTEM_PROMPT}\n\n${getEnvironmentContext()}`;
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
