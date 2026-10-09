// Logo: balanced dual-column layout
// XYRO agent head on the left, XYRO block title on the right.
// Proportionate heights and adaptive sizing for standard and large terminals.

import gradient from "gradient-string";
import { currentTheme, tint } from "../ui/theme.js";
import { RenderLine, span, line, visualWidth } from "./core.js";

// Xyro mascot gradient: Light Blue → Sky Blue → Electric Blue → Deep Blue
const xyroGradient = gradient(["#4FC3E0", "#38BDF8", "#3B82F6", "#2563EB"]);

// ─── THE AGENT HEAD ─────────────────────────────────────────────────────────
const RAW_HEAD = [
  "                      ...:..--::::.::..",
  "                   ..       ..         ...",
  "                :.          - :.           ..",
  "              .:            .= :.=:. -.     :=",
  "             :.              .  -=...         :",
  "              :              .=:.:...            ..",
  "             .             -===  -. .             .",
  "                  ...             -#=.      ...    :",
  "            -: :  .... .-:..         ..:: ....  :. .:",
  "         ::.=:: :      .:.::. :::.. .:...      ...:.::::",
  "        -+ .+- -              .....             ..::=. -:",
  "       : = .+= +      ..                 ..      : :-  - .",
  "       : = .=- +    %+ .+*            :%= .%-    : :-. : :",
  "       : = .+- +   .%.  .%-           =+   :%    : :-  : :",
  "        := .+- =    .    .            ..    .    :::-  :-",
  "         .=.*:=.=            .     -            = :.-.-.",
  "            ::.: .           .+**#:            . = ..",
  "             :  -  ::..                   : .. .: ..",
  "               .. .::   ......:::.:-. ..    ... :.",
  "                  .::   ..-+:.:...::::..    :..",
  "                        :-=--      .---..",
];

const HEAD_INDENT = Math.min(...RAW_HEAD.map((l) => l.match(/^ */)![0].length));
const TRIMMED_HEAD = RAW_HEAD.map((l) => l.slice(HEAD_INDENT).trimEnd());

/** Full 21-line head for large viewports (>=36 rows) */
export const XYRO_HEAD_FULL = TRIMMED_HEAD;

/**
 * Balanced 11-line compact head preserving all iconic features:
 * hair peaks, bangs, eyes (%+ .+* and :%= .%-), mouth (.+**#:), and chin.
 */
export const XYRO_HEAD_COMPACT = [
  TRIMMED_HEAD[0],
  TRIMMED_HEAD[2],
  TRIMMED_HEAD[4],
  TRIMMED_HEAD[7],
  TRIMMED_HEAD[9],
  TRIMMED_HEAD[11],
  TRIMMED_HEAD[12], // Eyes
  TRIMMED_HEAD[14],
  TRIMMED_HEAD[16], // Mouth
  TRIMMED_HEAD[18],
  TRIMMED_HEAD[20], // Chin
];

// ─── XYRO BLOCK TITLES ───────────────────────────────────────────────────────

/** 7-line bold block title (pairs proportionally with 11-line compact head) */
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


/**
 * 30-column narrow head — horizontally resampled from XYRO_HEAD_COMPACT.
 * Samples from col 0 so the left helmet wall (`: = .+= +`) and the
 * smiling mouth (`.+**#:`) are fully preserved.
 */
function buildNarrowHead(): string[] {
  const targetW = 30;
  const maxW = Math.max(...XYRO_HEAD_COMPACT.map((r) => r.length));
  return XYRO_HEAD_COMPACT.map((r) => {
    let out = "";
    for (let c = 0; c < targetW; c++) {
      const origStart = Math.floor((c / targetW) * maxW);
      const origEnd = Math.floor(((c + 1) / targetW) * maxW);
      const slice = r.slice(origStart, Math.max(origStart + 1, origEnd));
      const nonSpace = slice.replace(/\s/g, "");
      out += nonSpace.length > 0 ? nonSpace[0] : " ";
    }
    return out;
  });
}

export const XYRO_HEAD_NARROW = buildNarrowHead();

export function logoRows(termWidth = 80, termHeight = 24, gap = 4): RenderLine[] {
  const t = currentTheme();

  // Select appropriate head and title size based on viewport
  let leftRows: string[];
  let rightRows: string[];
  let effectiveGap = gap;

  if (termWidth >= 92) {
    // Wide display: narrow 11-line head with 7-line bold title
    leftRows = XYRO_HEAD_NARROW;
    rightRows = XYRO_TITLE_7;
    effectiveGap = 5;
  } else if (termWidth >= 75) {
    // 80-column standard terminal: narrow 11-line head with 5-line title
    leftRows = XYRO_HEAD_NARROW;
    rightRows = XYRO_TITLE_5;
    effectiveGap = 3;
  } else {
    // Narrow terminal (<75 cols): title only to prevent wrapping
    leftRows = [];
    rightRows = XYRO_TITLE_5;
  }

  const textColor = tint(t.text, 0.98);

  if (leftRows.length === 0) {
    // Single column centered
    const rows: RenderLine[] = [];
    for (const text of rightRows) {
      rows.push(line(span(text, { fg: textColor })));
    }
    return rows;
  }

  // Apply gradient across all head rows (top-to-bottom flow, exactly like printXyroHead)
  const coloredHead = xyroGradient.multiline(leftRows.join("\n")).split("\n");

  // Width calculation uses plain rows (visualWidth strips embedded ANSI codes)
  const leftW = Math.max(...leftRows.map((l) => visualWidth(l)));
  const total = Math.max(leftRows.length, rightRows.length);
  const rightStart = Math.floor((total - rightRows.length) / 2);

  const rows: RenderLine[] = [];
  for (let r = 0; r < total; r++) {
    const plainText = leftRows[r] || "";
    const coloredText = coloredHead[r] || "";
    const leftPad = leftW - visualWidth(plainText);
    const ri = r - rightStart;
    const rightText = ri >= 0 && ri < rightRows.length ? rightRows[ri] : "";

    rows.push(
      line(
        // Raw gradient text — no fg set so embedded ANSI codes pass through.
        // Explicit reset before padding prevents color bleeding into spaces.
        span(coloredText + "\u001b[0m" + " ".repeat(Math.max(0, leftPad))),
        span(" ".repeat(effectiveGap)),
        span(rightText, { fg: textColor })
      )
    );
  }

  return rows;
}
