import { Message } from "./types.js";
import { SYSTEM_PROMPT, PLAN_MODE_INSTRUCTIONS } from "../config/constants.js";
import { getEnvironmentContext } from "../config/platform.js";
import { loadProjectContext } from "../config/loader.js";
import { loadSkills } from "../config/skills.js";
import { historyToMarkdown } from "./usage.js";
import {
  createSession,
  getOrCreateProjectSession,
  getSessionMeta,
  loadSessionMessages,
  saveSessionMessages,
} from "./sessions.js";

type ResponseListener = (usage: unknown) => void;

/** Debounce window for the autosave that runs after every turn. */
const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface HistoryManagerOptions {
  /** Session id to bind to. Defaults to this project's `default` session. */
  sessionId?: string;
}

export class HistoryManager {
  private messages: Message[] = [];
  private listeners: ResponseListener[] = [];
  private planMode = false;
  private sessionId: string;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: HistoryManagerOptions = {}) {
    this.sessionId = opts.sessionId || getOrCreateProjectSession();
    this.reset();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionName(): string {
    return getSessionMeta(this.sessionId)?.name || "default";
  }

  /**
   * Schedule a debounced write of the current conversation. Called after every
   * turn so a crash or a closed terminal never loses more than one turn — the
   * previous behaviour only persisted on `/save`, `/exit` or Ctrl-C.
   */
  touch(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.save();
    }, AUTOSAVE_DEBOUNCE_MS);
    // Never hold the event loop open just for an autosave.
    if (typeof this.autosaveTimer.unref === "function") this.autosaveTimer.unref();
  }

  /** Cancel a pending autosave without writing (used before a manual save). */
  private cancelAutosave(): void {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  /** Persist immediately, flushing any pending autosave first. */
  flush(): void {
    this.cancelAutosave();
    this.save();
  }

  /** Point this manager at another session and load its messages. */
  switchSession(id: string): boolean {
    const messages = loadSessionMessages(id);
    if (!messages) return false;
    this.sessionId = id;
    this.messages = messages;
    if (this.messages.length === 0 || this.messages[0].role !== "system") {
      this.messages = [this.systemMessage(), ...messages];
    }
    this.touch();
    return true;
  }

  /** Start a brand-new empty session (optionally named) for this project. */
  newSession(name?: string): string {
    this.sessionId = createSession(name);
    this.reset();
    this.save();
    return this.sessionId;
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
    this.cancelAutosave();
    try {
      saveSessionMessages(this.sessionId, this.messages);
    } catch {
      // silent fail
    }
  }

  load(): boolean {
    this.cancelAutosave();
    const messages = loadSessionMessages(this.sessionId);
    if (!messages || messages.length === 0) return false;
    this.messages = messages;
    // A session saved by an older build (or hand-edited) may be missing its
    // system message; put a fresh one back at the head.
    if (this.messages.length === 0 || this.messages[0].role !== "system") {
      this.messages = [this.systemMessage(), ...messages];
    }
    return true;
  }
}
