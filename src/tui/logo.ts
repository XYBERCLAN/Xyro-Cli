// Logo: animated mascot on the left, X-cursor symbol + XYRO block title on
// the right. The symbol is a half-block transcription of the X-cursor brand
// SVG (160 × 120 master) and carries the four-stop brand gradient by column
// band. On first show the right block is revealed left → right in ~600 ms.

import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, StyledSpan, span, line, visualWidth } from "./core.js";
import { mascotRows, pickMascot, MascotMood, MascotArt } from "./mascot.js";

const GRADIENT = ["#4FC3E0", "#38BDF8", "#3B82F6", "#2563EB"];

/** 19 × 7 X-cursor symbol (pairs with the 7-line title) */
export const XCURSOR_7 = [
  "███▄      ▄███     ",
  "▀████▄  ▄████▀   ██",
  "  ▀████████▀     ██",
  "    ██████       ██",
  "  ▄████████▄     ██",
  "▄████▀  ▀████▄   ██",
  "███▀      ▀███     ",
];

/** 16 × 6 X-cursor symbol (narrow terminals) */
export const XCURSOR_6 = [
  "███      ███    ",
  "▀▀███▄▄███▀   ██",
  "   ██████▀    ██",
  "  ▄██████▄    ██",
  "▄▄███▀▀▀███   ██",
  "███      ███    ",
];

// ─── XYRO BLOCK TITLES ───────────────────────────────────────────────────────

/** 7-line bold block title */
export const XYRO_TITLE_7 = [
  "██    ██  ██    ██  ███████    ██████ ",
  " ██  ██    ██  ██   ██    ██  ██    ██",
  "  ████      ████    ██    ██  ██    ██",
  "   ██        ██     ███████   ██    ██",
  "  ████       ██     ██   ██   ██    ██",
  " ██  ██      ██     ██    ██  ██    ██",
  "██    ██     ██     ██    ██   ██████ ",
];

/** 5-line block title (compact for narrower viewports <95 cols) */
export const XYRO_TITLE_5 = [
  "█   █ █   █ ████   ███",
  " █ █   █ █  █   █ █   █",
  "  █     █   ████  █   █",
  " █ █    █   █  █  █   █",
  "█   █   █   █   █  ███",
];

export const INTRO_MS = 600;
const REVEAL_MS = 480; // linear column reveal, then hold

export interface LogoOptions {
  tick?: number;
  mood?: MascotMood;
  /** ms since the logo was first shown; omit to render the final artwork */
  introElapsed?: number;
  reducedMotion?: boolean;
}

export function isReducedMotion(): boolean {
  return Boolean(process.env.XYRO_REDUCED_MOTION || process.env.NO_MOTION);
}

/**
 * Right block: X-cursor symbol (gradient bands) + gap + title (text colour),
 * vertically centred against each other, with an optional reveal sweep.
 */
function brandBlock(symbol: string[], title: string[], gap: number, introElapsed?: number): RenderLine[] {
  const t = currentTheme();
  const titleColor = tint(t.text, 0.98);
  const edge = tint(t.text, 0.98);
  const symW = Math.max(...symbol.map((r) => visualWidth(r)));
  const titleW = Math.max(...title.map((r) => visualWidth(r)));
  const totalW = symW + gap + titleW;
  const h = Math.max(symbol.length, title.length);
  const symTop = Math.floor((h - symbol.length) / 2);
  const titleTop = Math.floor((h - title.length) / 2);

  const revealCols =
    introElapsed === undefined || introElapsed >= REVEAL_MS
      ? totalW
      : Math.floor((introElapsed / REVEAL_MS) * totalW);
  const sweeping = revealCols < totalW;

  const rows: RenderLine[] = [];
  for (let r = 0; r < h; r++) {
    const sym = Array.from((symbol[r - symTop] ?? "").padEnd(symW));
    const ttl = Array.from((title[r - titleTop] ?? "").padEnd(titleW));
    const chars = [...sym, ...Array(gap).fill(" "), ...ttl];
    const spans: StyledSpan[] = [];
    chars.forEach((raw, c) => {
      const ch = c < revealCols ? raw : " ";
      let fg = c < symW ? GRADIENT[Math.floor((c * 4) / symW)] : titleColor;
      if (sweeping && c === revealCols - 1) fg = edge;
      const prev = spans[spans.length - 1];
      if (prev && prev.fg === fg) prev.text += ch;
      else spans.push({ text: ch, fg });
    });
    rows.push(line(...spans));
  }
  return rows;
}

interface Layout {
  art: MascotArt | null;
  brand: RenderLine[];
  /** gap between mascot and brand block */
  g: number;
}

/** Largest mascot that fits beside the brand block; wide brand preferred. */
function chooseLayout(termWidth: number, termHeight: number, intro?: number): Layout {
  const wide = brandBlock(XCURSOR_7, XYRO_TITLE_7, 3, intro);
  const compact = brandBlock(XCURSOR_6, XYRO_TITLE_5, 2, intro);

  // Home screen needs ~19 rows for prompt, hints, tip and footer
  const maxRows = Math.max(0, termHeight - 19);
  const layouts: [RenderLine[], number, boolean][] = [
    [wide, 4, termWidth >= 92],
    [compact, 3, termWidth >= 75],
  ];
  for (const [brand, g, allowed] of layouts) {
    if (!allowed) continue;
    const art = pickMascot(termWidth - 4 - lineWidth(brand) - g, maxRows);
    if (art) return { art, brand, g };
  }
  return { art: null, brand: termWidth >= 92 ? wide : compact, g: 0 };
}

function lineWidth(rows: RenderLine[]): number {
  return Math.max(...rows.map((r) => r.spans.reduce((w, s) => w + visualWidth(s.text), 0)));
}

export function logoRows(termWidth = 80, termHeight = 24, _gap = 4, opts: LogoOptions = {}): RenderLine[] {
  const reduced = opts.reducedMotion ?? isReducedMotion();
  const { art, brand, g } = chooseLayout(termWidth, termHeight, reduced ? undefined : opts.introElapsed);
  if (!art) return brand;
  return sideBySide(mascotRows(art, opts.tick ?? 0, opts.mood ?? "idle", reduced), art.cols, brand, g);
}

// ─── FIRST-LAUNCH INTRO ──────────────────────────────────────────────────────
// 1. 0–900ms     the mascot materialises dot by dot in the centre
// 2. 900–1800ms  it blinks and smiles at the user
// 3. 1800ms→     it glides to its place on the left while X▌ XYRO types itself
// The last frame is exactly the normal home logo, so nothing jumps at the end.

const T_MATERIALISE = 900;
const T_SMILE_END = 1800;
const T_SLIDE = 900;
const T_TYPE_START = 1950;
const T_TYPE_STEP = 140;
const T_HOLD = 350;

type Cell = { ch: string; fg?: string; bold?: boolean };

function toCells(row: RenderLine | undefined, width: number): Cell[] {
  const cells: Cell[] = [];
  for (const s of row?.spans ?? []) for (const ch of Array.from(s.text)) cells.push({ ch, fg: s.fg, bold: s.bold });
  while (cells.length < width) cells.push({ ch: " " });
  return cells.slice(0, width);
}

function fromCells(cells: Cell[]): RenderLine {
  const spans: StyledSpan[] = [];
  for (const c of cells) {
    const prev = spans[spans.length - 1];
    if (prev && prev.fg === c.fg && prev.bold === c.bold) prev.text += c.ch;
    else spans.push({ text: c.ch, fg: c.fg, bold: c.bold });
  }
  return line(...spans);
}

/** Column ranges of the brand block separated by fully blank columns (X, ▌, X, Y, R, O). */
function typingSegments(grid: Cell[][], width: number): [number, number][] {
  const segs: [number, number][] = [];
  let start = -1;
  for (let c = 0; c <= width; c++) {
    const filled = c < width && grid.some((row) => row[c].ch !== " ");
    if (filled && start < 0) start = c;
    if (!filled && start >= 0) {
      segs.push([start, c]);
      start = -1;
    }
  }
  return segs;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export interface IntroFrame {
  rows: RenderLine[];
  done: boolean;
}

export function introRows(termWidth: number, termHeight: number, elapsed: number, tick = 0): IntroFrame {
  const { art, brand, g } = chooseLayout(termWidth, termHeight);
  const brandW = lineWidth(brand);
  const artW = art?.cols ?? 0;
  const offset = art ? artW + g : 0;
  const totalW = offset + brandW;
  const h = Math.max(art?.rows ?? 0, brand.length);
  const brandTop = Math.floor((h - brand.length) / 2);

  const brandGrid = Array.from({ length: h }, (_, r) => toCells(brand[r - brandTop], brandW));
  const segs = typingSegments(brandGrid, brandW);
  const typeStart = art ? T_TYPE_START : 0;
  const typed = Math.max(0, Math.min(segs.length, Math.floor((elapsed - typeStart) / T_TYPE_STEP) + 1));
  const typedCols = typed > 0 ? segs[typed - 1][1] : 0;
  const end = typeStart + segs.length * T_TYPE_STEP + T_HOLD;
  const done = elapsed >= Math.max(end, art ? T_SMILE_END + T_SLIDE + T_HOLD : 0);

  // Mascot position: centred over the whole logo, then glide to column 0
  let mascotX = 0;
  let mascot: RenderLine[] = [];
  if (art) {
    const centreX = Math.floor((totalW - artW) / 2);
    const slide = easeInOutCubic(clamp01((elapsed - T_SMILE_END) / T_SLIDE));
    mascotX = Math.round(centreX * (1 - slide));
    const reveal = easeOutCubic(clamp01(elapsed / T_MATERIALISE));
    // Smile beat: blink twice, then glow happily while gliding
    const inSmile = elapsed >= T_MATERIALISE && elapsed < T_SMILE_END;
    const blink = inSmile && ((elapsed > 1050 && elapsed < 1170) || (elapsed > 1300 && elapsed < 1420));
    mascot = mascotRows(art, tick, elapsed >= T_MATERIALISE ? "happy" : "idle", false, { reveal, blink });
  }
  const mascotTop = Math.floor((h - mascot.length) / 2);

  const rows: RenderLine[] = [];
  for (let r = 0; r < h; r++) {
    const cells: Cell[] = Array.from({ length: totalW }, () => ({ ch: " " }));
    // Brand block: typed segments only, never under the moving mascot
    brandGrid[r].forEach((cell, c) => {
      const x = offset + c;
      if (c < typedCols && (!art || x >= mascotX + artW + 1)) cells[x] = cell;
    });
    // Blinking typing cursor right after the last typed segment
    if (typed < segs.length && typed > 0 && Math.floor(elapsed / 260) % 2 === 0 && r === brandTop + brand.length - 1) {
      const x = offset + typedCols + 1;
      if (x < totalW) cells[x] = { ch: "▌", fg: "#C6F135" };
    }
    if (art) {
      const mrow = toCells(mascot[r - mascotTop], artW);
      mrow.forEach((cell, c) => {
        if (mascotX + c < totalW) cells[mascotX + c] = cell;
      });
    }
    rows.push(fromCells(cells));
  }
  return { rows, done };
}

function sideBySide(left: RenderLine[], leftW: number, right: RenderLine[], g: number): RenderLine[] {
  const total = Math.max(left.length, right.length);
  const leftTop = Math.floor((total - left.length) / 2);
  const rightTop = Math.floor((total - right.length) / 2);
  const rows: RenderLine[] = [];
  for (let r = 0; r < total; r++) {
    const m = left[r - leftTop];
    const b = right[r - rightTop];
    rows.push(line(...(m ? m.spans : [span(" ".repeat(leftW))]), span(" ".repeat(g)), ...(b ? b.spans : [])));
  }
  return rows;
}
