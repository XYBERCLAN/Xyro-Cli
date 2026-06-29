import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Message } from "./types.js";
import { SYSTEM_PROMPT, HISTORY_FILE } from "../config/constants.js";
import { loadProjectContext } from "../config/loader.js";

export class HistoryManager {
  private messages: Message[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    let systemContent = SYSTEM_PROMPT;
    const projectContext = loadProjectContext();
    if (projectContext) {
      systemContent += `\n\n## Project Context\n${projectContext}`;
    }
    this.messages = [{ role: "system", content: systemContent }];
  }

  add(msg: Message): void {
    this.messages.push(msg);
  }

  getAll(): Message[] {
    return this.messages;
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
