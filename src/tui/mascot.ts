// XYRO mascot — exact braille trace of the official artwork (see mascot-art.ts).
// Animation never alters the drawing: it only swaps in the traced blink frame,
// breathes the eye glow and glides a soft light across the forehead emblem.

import { RenderLine, StyledSpan, line } from "./core.js";
import { MASCOT_ART, MascotArt } from "./mascot-art.js";

export type MascotMood = "idle" | "thinking" | "happy" | "error" | "asking";
export type { MascotArt };

const COLORS = {
  outline: "#E6EDF3",
  emblemLight: "#7DD3FC",
  glowHi: "#D6E8FF",
  glowLo: "#93C5FD",
  error: "#e06c75",
  ask: "#C6F135",
};

/** Largest traced size that fits within the given cell budget (null if none). */
export function pickMascot(maxCols: number, maxRows: number): MascotArt | null {
  return MASCOT_ART.find((a) => a.cols <= maxCols && a.rows <= maxRows) ?? null;
}

/** Blink for two ticks every ~4s (80ms ticks), with an occasional double blink. */
export function isBlinking(tick: number, mood: MascotMood): boolean {
  if (mood === "error") return false;
  const c = tick % 50;
  return c === 46 || c === 47 || tick % 150 === 140 || tick % 150 === 141;
}

export interface MascotRenderOptions {
  /** 0..1 — fraction of braille dots shown (intro "materialise" effect) */
  reveal?: number;
  /** Force the blink frame (intro "smile at the user" beat) */
  blink?: boolean;
}

/** Render one frame of the mascot at a given traced size. */
export function mascotRows(
  art: MascotArt,
  tick: number,
  mood: MascotMood,
  reducedMotion = false,
  opts: MascotRenderOptions = {}
): RenderLine[] {
  const blink = opts.blink ?? (!reducedMotion && isBlinking(tick, mood));
  const reveal = opts.reveal ?? 1;
  const frame = blink ? art.blink : art.open;
  const mask = blink ? art.blinkMask : art.mask;

  // Eye glow breathes between two tints (slow when idle, quicker when thinking)
  const half = mood === "thinking" ? 6 : 15;
  const glow =
    mood === "error"
      ? COLORS.error
      : mood === "asking"
        ? Math.floor(tick / 8) % 2 === 0 || reducedMotion
          ? COLORS.ask
          : COLORS.glowHi
        : reducedMotion || Math.floor(tick / half) % 2 === 0
        ? COLORS.glowHi
        : COLORS.glowLo;

  // Emblem light: a 3-column band gliding left → right across the X and ring
  const step = mood === "thinking" ? 1 : 3;
  const lightCol = reducedMotion ? -99 : Math.floor(tick / step) % (art.cols + 20);

  return frame.map((row, r) => {
    const kinds = Array.from(mask[r]);
    const spans: StyledSpan[] = [];
    Array.from(row).forEach((raw, c) => {
      const ch = reveal >= 1 ? raw : revealDots(raw, r, c, reveal);
      const kind = kinds[c];
      const fg = kind === "b" ? glow : kind === "x" && Math.abs(c - lightCol) <= 1 ? COLORS.emblemLight : COLORS.outline;
      const bold = kind === "b";
      const prev = spans[spans.length - 1];
      if (prev && prev.fg === fg && prev.bold === bold) prev.text += ch;
      else spans.push({ text: ch, fg, bold });
    });
    return line(...spans);
  });
}

/** Keep each braille dot once `reveal` passes its own pseudo-random threshold. */
function revealDots(ch: string, r: number, c: number, reveal: number): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x2801 || code > 0x28ff) return ch;
  let bits = code - 0x2800;
  for (let b = 0; b < 8; b++) {
    if (!(bits & (1 << b))) continue;
    const h = Math.sin(r * 127.1 + c * 311.7 + b * 74.7) * 43758.5453;
    if (h - Math.floor(h) > reveal) bits &= ~(1 << b);
  }
  return bits ? String.fromCodePoint(0x2800 + bits) : " ";
}
