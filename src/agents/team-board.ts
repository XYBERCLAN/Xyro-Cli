// Shared team board: experts working on the same request leave short notes
// for each other ("changed the auth API signature", "tests live in test/e2e").
// Cleared at the start of every user message.

export interface TeamNote {
  id: number;
  author: string;
  text: string;
  at: number;
  /** Set for notes from a linked XYRO session ("alice@laptop") */
  from?: string;
}

let outgoing: ((n: TeamNote) => void) | null = null;

/** XYRO Link: hear about notes posted in this session, to share them with linked sessions. */
export function onNotePosted(fn: ((n: TeamNote) => void) | null): void {
  outgoing = fn;
}

/** A note that arrived from a linked session (not shared onward). */
export function addRemoteNote(author: string, text: string, from: string): TeamNote {
  const n = { id: nextId++, author: author || "XYRO", text: text.trim().slice(0, 2000), at: Date.now(), from };
  notes.push(n);
  if (notes.length > MAX_NOTES) notes.shift();
  return n;
}

const notes: TeamNote[] = [];
let nextId = 1;
const MAX_NOTES = 200;

export function postNote(author: string, text: string): TeamNote {
  const n = { id: nextId++, author: author || "XYRO", text: text.trim().slice(0, 2000), at: Date.now() };
  notes.push(n);
  if (notes.length > MAX_NOTES) notes.shift();
  outgoing?.(n);
  return n;
}

export function listNotes(): TeamNote[] {
  return notes.slice();
}

export function clearNotes(): void {
  notes.length = 0;
}

export function formatNotes(): string {
  if (!notes.length) return "The team board is empty.";
  return notes.map((n) => `#${n.id} ${n.author}${n.from ? ` (linked session ${n.from})` : ""}: ${n.text}`).join("\n");
}
