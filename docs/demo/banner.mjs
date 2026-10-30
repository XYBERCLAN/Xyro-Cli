// Draws the README header from the same block art the TUI logo uses
// (src/tui/logo.ts), so the two never drift apart.
//
//   npm run build && node docs/demo/banner.mjs   # writes docs/assets/banner-{dark,light}.svg

import { writeFileSync, mkdirSync } from "node:fs";
import { XCURSOR_7, XYRO_TITLE_7 } from "../../dist/tui/logo.js";

const PX = 12; // one half-block cell = PX × PX, so the art keeps its terminal proportions
const GAP_COLS = 4;
const PAD_X = 48;
const PAD_Y = 40;

/** Turn half-block rows into run-length rectangles: [x, y, w] on a PX grid. */
function pixels(rows, offsetCols) {
  const runs = [];
  rows.forEach((row, r) => {
    const top = [], bottom = [];
    Array.from(row).forEach((ch, c) => {
      top[c] = ch === "█" || ch === "▀";
      bottom[c] = ch === "█" || ch === "▄";
    });
    for (const [half, filled] of [[0, top], [1, bottom]]) {
      let start = -1;
      for (let c = 0; c <= filled.length; c++) {
        if (filled[c] && start < 0) start = c;
        if (!filled[c] && start >= 0) {
          runs.push([offsetCols + start, r * 2 + half, c - start]);
          start = -1;
        }
      }
    }
  });
  return runs;
}

const width = (rows) => Math.max(...rows.map((r) => Array.from(r).length));
const symCols = width(XCURSOR_7);
const titleCols = width(XYRO_TITLE_7);
const totalCols = symCols + GAP_COLS + titleCols + 2; // + cursor and its gap
const halfRows = XCURSOR_7.length * 2;
const W = totalCols * PX + PAD_X * 2;
const H = halfRows * PX + PAD_Y * 2;

const rects = (runs, fill) =>
  runs.map(([x, y, w]) => `<rect x="${PAD_X + x * PX}" y="${PAD_Y + y * PX}" width="${w * PX}" height="${PX}"${fill ? ` fill="${fill}"` : ""}/>`).join("");

function svg({ title, cursor }) {
  const symbol = pixels(XCURSOR_7, 0);
  const word = pixels(XYRO_TITLE_7, symCols + GAP_COLS);
  const cursorX = PAD_X + (symCols + GAP_COLS + titleCols + 1) * PX;
  const cursorY = PAD_Y + (halfRows - 2) * PX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">XYRO</title>
<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${PAD_X}" y1="0" x2="${PAD_X + symCols * PX}" y2="0">
<stop offset="0" stop-color="#4FC3E0"/><stop offset=".35" stop-color="#38BDF8"/><stop offset=".7" stop-color="#3B82F6"/><stop offset="1" stop-color="#2563EB"/>
</linearGradient></defs>
<g fill="url(#g)">${rects(symbol)}</g>
<g fill="${title}">${rects(word)}</g>
<rect x="${cursorX}" y="${cursorY}" width="${PX}" height="${PX * 2}" fill="${cursor}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.5;.5;1" dur="1.1s" repeatCount="indefinite"/></rect>
</svg>
`;
}

mkdirSync("docs/assets", { recursive: true });
writeFileSync("docs/assets/banner-dark.svg", svg({ title: "#E6EDF3", cursor: "#C6F135" }));
writeFileSync("docs/assets/banner-light.svg", svg({ title: "#0F172A", cursor: "#4D7C0F" }));
console.log(`banner ${W}×${H}`);
