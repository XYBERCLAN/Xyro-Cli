// Terminal engine: alt-screen, raw mode, frame renderer, scroll region with
// sticky bottom. XYRO layout primitives.

export interface StyledSpan {
  text: string;
  fg?: string; // "#rrggbb"
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

export interface RenderLine {
  spans: StyledSpan[];
}

const ESC = "\u001b[";
const OSC = "\u001b]";
const OUT = process.stdout;

let initialized = false;
let width = 80;
let height = 24;
let resizeListener: (() => void) | null = null;
let keyHandler: ((key: string) => void) | null = null;

// ── Mouse events (SGR encoding) ─────────────────────────────────────────────

export interface MouseEvt {
  kind: "press" | "drag" | "release" | "wheel" | "motion";
  button: number; // 0 = left, 1 = middle, 2 = right
  x: number; // 1-based cell column
  y: number; // 1-based screen row
}

let mouseHandler: ((e: MouseEvt) => void) | null = null;
let inputBuf = "";

/** Classify a parsed SGR mouse event from its raw cb code + terminator */
export function mouseFromSgr(cb: number, x: number, y: number, isRelease: boolean): MouseEvt {
  if (cb >= 64) return { kind: "wheel", button: cb - 64, x, y };
  if (isRelease) return { kind: "release", button: cb, x, y };
  if (cb >= 32) return { kind: "drag", button: cb - 32, x, y };
  if (cb >= 3) return { kind: "motion", button: cb, x, y };
  return { kind: "press", button: cb, x, y };
}

/**
 * Process buffered stdin: SGR mouse sequences are routed to the mouse
 * handler; everything else is split into keystrokes for the key handler.
 * Incomplete mouse sequences are held back until more data arrives.
 */
function processInputBuffer(): void {
  while (inputBuf.length > 0) {
    // SGR mouse: ESC [ < cb ; x ; y (M|m)
    if (inputBuf.startsWith("\u001b[<")) {
      const full = inputBuf.match(/^\u001b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (full) {
        const evt = mouseFromSgr(
          parseInt(full[1], 10),
          parseInt(full[2], 10),
          parseInt(full[3], 10),
          full[4] === "m"
        );
        inputBuf = inputBuf.slice(full[0].length);
        mouseHandler?.(evt);
        continue;
      }
      // Plausible incomplete mouse sequence — wait for the rest of the chunk
      if (/^\u001b\[<[\d;]*$/.test(inputBuf)) break;
      // Malformed — treat the ESC as a keystroke and move on
      keyHandler?.("\u001b");
      inputBuf = inputBuf.slice(1);
      continue;
    }

    // Take exactly one keystroke off the front of the buffer
    let tok: string;
    const cp = inputBuf.codePointAt(0) || 0;
    if (cp === 27) {
      const m = inputBuf.match(/^\u001b(\[[0-9;?]*[~A-Za-z]|\][^\u0007]*\u0007|O[A-Za-z])?/);
      tok = m ? m[0] : "\u001b";
    } else {
      tok = String.fromCodePoint(cp);
    }
    inputBuf = inputBuf.slice(tok.length);
    keyHandler?.(tok);
  }
}

export function tuiInit(onKey: (key: string) => void, onResize?: () => void, onMouse?: (e: MouseEvt) => void): void {
  if (initialized) return;
  initialized = true;
  // Alt screen + hide cursor + button-event mouse tracking with SGR coordinates
  OUT.write(`${ESC}?1049h${ESC}?25l${ESC}?1002h${ESC}?1006h${ESC}2J`);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  keyHandler = onKey;
  mouseHandler = onMouse ?? null;
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    inputBuf += chunk;
    processInputBuffer();
  });
  resizeListener = () => {
    width = OUT.columns || 80;
    height = OUT.rows || 24;
    onResize?.();
  };
  process.stdout.on("resize", resizeListener);
  width = OUT.columns || 80;
  height = OUT.rows || 24;
}

export function tuiExit(): void {
  if (!initialized) return;
  initialized = false;
  // Disable mouse tracking before leaving the alt screen
  OUT.write(`${ESC}?1006l${ESC}?1002l${ESC}?25h${ESC}?1049l`);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  if (resizeListener) process.stdout.off("resize", resizeListener);
  inputBuf = "";
  mouseHandler = null;
}

export function tuiSize(): { width: number; height: number } {
  return { width, height };
}

// Split a chunk into logical keystrokes (escape sequences stay whole)
function splitKeystrokes(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i) || 0;
    if (cp === 27) {
      const m = s.slice(i).match(/^\u001b(\[[0-9;?]*[~A-Za-z]|\][^\u0007]*\u0007|O[A-Za-z])?/);
      const seq = m ? m[0] : "\u001b";
      out.push(seq);
      i += seq.length;
    } else {
      const ch = String.fromCodePoint(cp);
      out.push(ch);
      i += ch.length;
    }
  }
  return out;
}

export { splitKeystrokes };

// ---- clipboard (OSC 52) ----

/**
 * Copy text to the system clipboard using the OSC 52 escape sequence.
 * Works over SSH/tmux and in most modern terminals (iTerm2, Kitty, WezTerm,
 * Windows Terminal, GNOME Terminal w/ clipboard patch). Base64 caps at ~100KB
 * for compatibility; larger copies are truncated gracefully.
 */
export function copyToClipboard(text: string): boolean {
  const trimmed = text.slice(0, 100_000);
  try {
    const b64 = Buffer.from(trimmed, "utf-8").toString("base64");
    // 76KB base64 limit is a common conservative terminal cutoff
    if (b64.length > 76_665) return false;
    OUT.write(`${OSC}52;c;${b64}${BEL}`);
    return true;
  } catch {
    return false;
  }
}

const BEL = "\u0007";

// ---- renderable text extraction ----

/**
 * Extract the plain text content of a RenderLine, clipped to the terminal
 * width. Used by mouse text-selection to read what is actually on screen.
 */
export function linePlainText(l: RenderLine, w = width): string {
  let out = "";
  let col = 0;
  for (const s of l.spans) {
    if (col >= w) break;
    const text = s.text.replace(/[\r\n]/g, " ");
    const vw = visualWidth(text);
    if (col + vw > w) {
      out += clipToWidth(text, Math.max(0, w - col));
      col = w;
      break;
    }
    out += text;
    col += vw;
  }
  return out;
}

// ---- scroll region with sticky bottom (XYRO scrollbox) ----

export class ScrollRegion {
  private lines: RenderLine[] = [];
  private offset = 0; // lines scrolled up from the bottom

  append(l: RenderLine): void {
    this.lines.push(l);
  }

  appendAll(ls: RenderLine[]): void {
    for (const l of ls) this.lines.push(l);
  }

  /** Replace one line in place (live rows: spinners, streaming text). */
  setLine(index: number, l: RenderLine): void {
    if (index >= 0 && index < this.lines.length) this.lines[index] = l;
  }

  /** Drop every line from `length` onward (re-render a streaming block). */
  truncate(length: number): void {
    if (length >= 0 && length < this.lines.length) this.lines.length = length;
  }

  scrollBy(delta: number): void {
    this.offset = Math.max(0, Math.min(this.lines.length, this.offset + delta));
  }

  scrollToBottom(): void {
    this.offset = 0;
  }

  isSticky(): boolean {
    return this.offset === 0;
  }

  length(): number {
    return this.lines.length;
  }

  visible(viewHeight: number): RenderLine[] {
    const start = Math.max(0, this.lines.length - viewHeight - this.offset);
    return this.lines.slice(start, start + viewHeight);
  }

  // home screen: when content overflows, show the TOP of the content
  // (logo first), not the bottom.
  visibleFromTop(viewHeight: number): RenderLine[] {
    return this.lines.slice(0, Math.min(viewHeight, this.lines.length));
  }
}

// ---- span/line builders ----

export function span(text: string, opts: Omit<StyledSpan, "text"> = {}): StyledSpan {
  return { text, ...opts };
}

export function line(...spans: StyledSpan[]): RenderLine {
  return { spans };
}

export function emptyLine(): RenderLine {
  return { spans: [] };
}

function spanToAnsi(s: StyledSpan): string {
  const attrs: string[] = [];
  if (s.bold) attrs.push("1");
  if (s.dim) attrs.push("2");
  if (s.italic) attrs.push("3");
  if (s.strikethrough) attrs.push("9");
  const reset = attrs.length ? `${ESC}0m` : "";
  const pre = attrs.length ? `${ESC}${attrs.join(";")}m` : "";
  let out = pre;
  if (s.fg) out += `${ESC}38;2;${parseHex(s.fg).join(";")}m`;
  if (s.bg) out += `${ESC}48;2;${parseHex(s.bg).join(";")}m`;
  out += s.text;
  if (s.fg || s.bg || attrs.length) out += `${ESC}0m`;
  void reset;
  return out;
}

function parseHex(h: string): [number, number, number] {
  const m = h.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

// ---- frame painting ----

/**
 * Post-processor applied to every full frame before it is written, e.g. to
 * dim the screen and composite a centred modal on top (see tui/modal.ts).
 */
export type FrameFilter = (rows: RenderLine[], width: number, height: number) => RenderLine[];
let frameFilter: FrameFilter | null = null;

export function setFrameFilter(fn: FrameFilter | null): void {
  frameFilter = fn;
}

export function paintFrame(content: ScrollRegion, bottom: RenderLine[], top: RenderLine[], fromTop = false): void {
  const bottomH = bottom.length;
  const topH = top.length;
  const viewH = Math.max(1, height - bottomH - topH);
  const visible = fromTop ? content.visibleFromTop(viewH) : content.visible(viewH);

  let rows: RenderLine[] = [...top];
  for (let i = 0; i < viewH; i++) rows.push(visible[i] ?? emptyLine());
  rows.push(...bottom);
  if (frameFilter) rows = frameFilter(rows, width, height);

  // Synchronized output (CSI ?2026) so terminals show the frame atomically
  let buf = `${ESC}?2026h${ESC}H`;
  for (const r of rows) buf += rowToAnsi(r, width);
  OUT.write(buf + `${ESC}?2026l`);
}

function rowToAnsi(row: RenderLine, w: number): string {
  const parts: string[] = [];
  let col = 0;
  for (const s of row.spans) {
    const text = s.text.replace(/[\r\n]/g, " ");
    const vw = visualWidth(text);
    if (col + vw > w) {
      parts.push(spanToAnsi({ ...s, text: clipToWidth(text, Math.max(0, w - col)) }));
      col = w;
      break;
    }
    parts.push(spanToAnsi(s));
    col += vw;
  }
  if (col < w) parts.push(" ".repeat(w - col));
  return parts.join("") + "\n";
}

/** Paint a single row at a 1-based screen row position (overlay compositing) */
export function paintRowOverlay(row: RenderLine, screenY: number, w = width): void {
  if (screenY < 1 || screenY > height) return;
  OUT.write(`${ESC}${screenY};1H${rowToAnsi(row, w)}`);
}

export function visualWidth(text: string): number {
  let w = 0;
  for (const ch of text.replace(/\u001b\[[0-9;]*m/g, "")) {
    const cp = ch.codePointAt(0) || 0;
    if (cp >= 0x1100 && cp <= 0x115f) w += 2; // Hangul Jamo
    else if (cp >= 0x2e80 && cp <= 0xa4cf) w += 2; // CJK
    else if (cp >= 0xac00 && cp <= 0xd7a3) w += 2; // Hangul
    else if (cp >= 0xf900 && cp <= 0xfaff) w += 2; // CJK compat
    else if (cp >= 0x1f300 && cp <= 0x1f9ff) w += 2; // emoji
    else w += 1;
  }
  return w;
}

function clipToWidth(text: string, maxWidth: number): string {
  let out = "";
  let w = 0;
  for (const ch of text.replace(/\u001b\[[0-9;]*m/g, "")) {
    if (w >= maxWidth) break;
    out += ch;
    w += visualWidth(ch);
  }
  return out;
}

// wrap styled spans into lines of a max display width
export function wrapSpans(spans: StyledSpan[], maxWidth: number): RenderLine[] {
  const out: RenderLine[] = [];
  let current: StyledSpan[] = [];
  let curW = 0;
  const pushLine = () => {
    out.push({ spans: current });
    current = [];
    curW = 0;
  };
  for (const s of spans) {
    const segments = s.text.split("\n");
    segments.forEach((seg, si) => {
      if (si > 0) pushLine();
      let rest = seg;
      while (rest.length > 0) {
        const space = maxWidth - curW;
        const restW = visualWidth(rest);
        if (restW <= space) {
          current.push({ ...s, text: rest });
          curW += restW;
          rest = "";
        } else {
          // break at word boundary when possible
          let cut = clipToWidth(rest, space);
          if (space > 4) {
            const lastSp = cut.lastIndexOf(" ");
            if (lastSp > space * 0.4) cut = cut.slice(0, lastSp + 1);
          }
          current.push({ ...s, text: cut });
          pushLine();
          rest = rest.slice(cut.length);
        }
      }
    });
  }
  if (current.length || out.length === 0) out.push({ spans: current });
  return out;
}

// XYRO SplitBorder: left vertical ┃ with no other sides
export const SPLIT_VERTICAL = "┃";
// prompt hook: bottom-left corner char
export const PROMPT_HOOK = "╹";
