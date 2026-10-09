// Shared team board: experts working on the same request leave short notes
// for each other ("changed the auth API signature", "tests live in test/e2e").
// Cleared at the start of every user message.

export interface TeamNote {
  id: number;
  author: string;
  text: string;
  at: number;
}

const notes: TeamNote[] = [];
let nextId = 1;
const MAX_NOTES = 200;

export function postNote(author: string, text: string): TeamNote {
  const n = { id: nextId++, author: author || "XYRO", text: text.trim().slice(0, 2000), at: Date.now() };
  notes.push(n);
  if (notes.length > MAX_NOTES) notes.shift();
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
  return notes.map((n) => `#${n.id} ${n.author}: ${n.text}`).join("\n");
}
