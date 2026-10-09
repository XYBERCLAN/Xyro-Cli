import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// XYRO theme token schema — dark/light values
export interface Theme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  text: string;
  textMuted: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  backgroundMenu: string;
  borderSubtle: string;
  border: string;
  borderActive: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  thinkingOpacity: number;
  light?: boolean;
}

// XYRO core dark palette
// Brand ramp cyan → deep blue, lemon accent, amber for warnings, layered navy
// surfaces (each step ~6% lighter) so cards and panels read without borders.
const XYRO_DARK = {
  primary: "#38BDF8", secondary: "#3B82F6", accent: "#C6F135",
  error: "#F47174", warning: "#F59E0B", success: "#22C55E", info: "#4FC3E0",
  text: "#E6EDF3", textMuted: "#8592AD",
  background: "#0B1018", backgroundPanel: "#111823", backgroundElement: "#18212E",
  backgroundMenu: "#1F2A3A",
  borderSubtle: "#243145", border: "#33445C", borderActive: "#38BDF8",
  diffAdded: "#22C55E", diffRemoved: "#E5534B",
};

// XYRO light palette
const XYRO_LIGHT = {
  primary: "#0369A1", secondary: "#2563EB", accent: "#4D7C0F",
  error: "#C8323A", warning: "#B45309", success: "#15803D", info: "#0369A1",
  text: "#0F172A", textMuted: "#64748B",
  background: "#FFFFFF", backgroundPanel: "#F8FAFC", backgroundElement: "#F1F5F9",
  backgroundMenu: "#E2E8F0",
  borderSubtle: "#E2E8F0", border: "#CBD5E1", borderActive: "#0284C7",
  diffAdded: "#16A34A", diffRemoved: "#c53b53",
};

const mk = (name: string, p: typeof XYRO_DARK, light = false): Theme => ({
  name, ...p,
  diffAddedBg: light ? "#e5f2ed" : "#1e3a1e",
  diffRemovedBg: light ? "#f5e3e3" : "#3a1e1e",
  thinkingOpacity: 0.6,
  ...(light ? { light: true } : {}),
});

export const THEMES: Record<string, Theme> = {
  xyro: mk("xyro", XYRO_DARK),
  "xyro-light": mk("xyro-light", XYRO_LIGHT, true),
  midnight: mk("midnight", {
    ...XYRO_DARK,
    primary: "#60A5FA",
    background: "#030712",
    backgroundPanel: "#0B0F19",
    backgroundElement: "#111827",
  }),
  matrix: mk("matrix", {
    primary: "#00FF66", secondary: "#10B981", accent: "#34D399",
    error: "#EF4444", warning: "#FBBF24", success: "#00FF66", info: "#34D399",
    text: "#ECFDF5", textMuted: "#059669",
    background: "#050B07", backgroundPanel: "#0A170F", backgroundElement: "#0E2418",
    backgroundMenu: "#133221", borderSubtle: "#103E26", border: "#165937", borderActive: "#00FF66",
    diffAdded: "#00FF66", diffRemoved: "#EF4444",
  }),
  "tokyo-night": mk("tokyo-night", {
    primary: "#7AA2F7", secondary: "#BB9AF7", accent: "#7DCFFF",
    error: "#F7768E", warning: "#E0AF68", success: "#9ECE6A", info: "#7DCFFF",
    text: "#C0CAF5", textMuted: "#7D85B3",
    background: "#1A1B26", backgroundPanel: "#16161E", backgroundElement: "#24283B",
    backgroundMenu: "#2F3549", borderSubtle: "#292E42", border: "#414868", borderActive: "#7AA2F7",
    diffAdded: "#9ECE6A", diffRemoved: "#F7768E",
  }),
  synthwave: mk("synthwave", {
    primary: "#FF7EDB", secondary: "#36F9F6", accent: "#FEFF00",
    error: "#FE4450", warning: "#FEFF00", success: "#72F1B8", info: "#36F9F6",
    text: "#FFFFFF", textMuted: "#848BB2",
    background: "#1B152B", backgroundPanel: "#241B35", backgroundElement: "#2D2240",
    backgroundMenu: "#3A2B52", borderSubtle: "#3F2F59", border: "#5E4685", borderActive: "#FF7EDB",
    diffAdded: "#72F1B8", diffRemoved: "#FE4450",
  }),
  monokai: mk("monokai", {
    primary: "#A9DC76", secondary: "#78DCE8", accent: "#FFD866",
    error: "#FF6188", warning: "#FC9867", success: "#A9DC76", info: "#78DCE8",
    text: "#FCFCFA", textMuted: "#9A989B",
    background: "#221F22", backgroundPanel: "#19181A", backgroundElement: "#2D2A2E",
    backgroundMenu: "#3A363C", borderSubtle: "#403E41", border: "#5B595C", borderActive: "#A9DC76",
    diffAdded: "#A9DC76", diffRemoved: "#FF6188",
  }),
  catppuccin: mk("catppuccin", {
    primary: "#89b4fa", secondary: "#cba6f7", accent: "#f5c2e7",
    error: "#f38ba8", warning: "#fab387", success: "#a6e3a1", info: "#89dceb",
    text: "#cdd6f4", textMuted: "#9399b2",
    background: "#1e1e2e", backgroundPanel: "#181825", backgroundElement: "#313244",
    backgroundMenu: "#45475a", borderSubtle: "#45475a", border: "#585b70", borderActive: "#89b4fa",
    diffAdded: "#a6e3a1", diffRemoved: "#f38ba8",
  }),
  dracula: mk("dracula", {
    primary: "#ff79c6", secondary: "#bd93f9", accent: "#bd93f9",
    error: "#ff5555", warning: "#ffb86c", success: "#50fa7b", info: "#8be9fd",
    text: "#f8f8f2", textMuted: "#929CCB",
    background: "#282a36", backgroundPanel: "#21222c", backgroundElement: "#343746",
    backgroundMenu: "#44475a", borderSubtle: "#44475a", border: "#6272a4", borderActive: "#bd93f9",
    diffAdded: "#50fa7b", diffRemoved: "#ff5555",
  }),
  gruvbox: mk("gruvbox", {
    primary: "#fabd2f", secondary: "#83a598", accent: "#8ec07c",
    error: "#fb4934", warning: "#fe8019", success: "#b8bb26", info: "#83a598",
    text: "#ebdbb2", textMuted: "#a89984",
    background: "#282828", backgroundPanel: "#1d2021", backgroundElement: "#32302f",
    backgroundMenu: "#3c3836", borderSubtle: "#504945", border: "#665c54", borderActive: "#fabd2f",
    diffAdded: "#b8bb26", diffRemoved: "#fb4934",
  }),
  nord: mk("nord", {
    primary: "#88c0d0", secondary: "#81a1c1", accent: "#b48ead",
    error: "#d57780", warning: "#ebcb8b", success: "#a3be8c", info: "#8fbcbb",
    text: "#eceff4", textMuted: "#a3adc2",
    background: "#2e3440", backgroundPanel: "#292e39", backgroundElement: "#3b4252",
    backgroundMenu: "#434c5e", borderSubtle: "#434c5e", border: "#4c566a", borderActive: "#88c0d0",
    diffAdded: "#a3be8c", diffRemoved: "#bf616a",
  }),
  "rose-pine": mk("rose-pine", {
    primary: "#9ccfd8", secondary: "#c4a7e7", accent: "#ebbcba",
    error: "#eb6f92", warning: "#f6c177", success: "#9ccfd8", info: "#31748f",
    text: "#e0def4", textMuted: "#908caa",
    background: "#191724", backgroundPanel: "#1f1d2e", backgroundElement: "#26233a",
    backgroundMenu: "#2a2740", borderSubtle: "#2a2740", border: "#403d52", borderActive: "#c4a7e7",
    diffAdded: "#9ccfd8", diffRemoved: "#eb6f92",
  }),
  light: mk("light", XYRO_LIGHT, true),
};

export interface ThemeInfo {
  id: string;
  name: string;
  category: string;
  desc: string;
  primary: string;
  secondary: string;
  accent: string;
}

export const THEME_CATALOG: ThemeInfo[] = [
  { id: "xyro", name: "XYRO Cyber", category: "CYBER", desc: "Signature Cyber Blue, Lemon Green & Emerald on Onyx", primary: "#38BDF8", secondary: "#3B82F6", accent: "#C6F135" },
  { id: "matrix", name: "Matrix Phosphor", category: "HACKER", desc: "High-contrast phosphor green glow on deep obsidian", primary: "#00FF66", secondary: "#10B981", accent: "#34D399" },
  { id: "tokyo-night", name: "Tokyo Night", category: "NEON", desc: "Tokyo storm indigo with vivid neon violet & cyan accents", primary: "#7AA2F7", secondary: "#BB9AF7", accent: "#7DCFFF" },
  { id: "synthwave", name: "Synthwave '84", category: "RETRO", desc: "80s neon magenta, cyberpunk yellow & electric cyan", primary: "#FF7EDB", secondary: "#36F9F6", accent: "#FEFF00" },
  { id: "monokai", name: "Monokai Pro", category: "PRO", desc: "Classic developer palette with acid green & warm gold", primary: "#A9DC76", secondary: "#78DCE8", accent: "#FFD866" },
  { id: "catppuccin", name: "Catppuccin", category: "PASTEL", desc: "Soothing Mocha pastels: sky blue, mauve & soft pink", primary: "#89B4FA", secondary: "#CBA6F7", accent: "#F5C2E7" },
  { id: "rose-pine", name: "Rosé Pine", category: "SOFT", desc: "Muted foam, iris & rose on a quiet violet night", primary: "#9CCFD8", secondary: "#C4A7E7", accent: "#EBBCBA" },
  { id: "dracula", name: "Dracula Dark", category: "GOTHIC", desc: "Vampire neon purple, bright pink & vibrant mint", primary: "#BD93F9", secondary: "#FF79C6", accent: "#50FA7B" },
  { id: "nord", name: "Nord Frost", category: "CALM", desc: "Arctic glacial blue, polar night slate & aurora teal", primary: "#88C0D0", secondary: "#81A1C1", accent: "#A3BE8C" },
  { id: "gruvbox", name: "Gruvbox Dark", category: "RETRO", desc: "Warm earthy forest tones with amber gold & terracotta", primary: "#FABD2F", secondary: "#83A598", accent: "#B8BB26" },
  { id: "midnight", name: "Midnight Void", category: "DARK", desc: "Ultra-deep OLED abyss black with luminous royal blue", primary: "#60A5FA", secondary: "#3B82F6", accent: "#93C5FD" },
  { id: "xyro-light", name: "XYRO Daylight", category: "LIGHT", desc: "Crisp daylight slate canvas with cyber sky blue accents", primary: "#0369A1", secondary: "#2563EB", accent: "#4D7C0F" },
];

export const THEME_NAMES = Object.keys(THEMES);

let activeTheme: Theme = THEMES.xyro;

/** Apply and save a theme (an explicit user choice). */
export function setTheme(name: string): boolean {
  if (!THEMES[name]) return false;
  activeTheme = THEMES[name];
  persistTheme(name);
  return true;
}

/** Apply a theme for live preview only — never written to disk. */
export function previewTheme(name: string): boolean {
  if (!THEMES[name]) return false;
  activeTheme = THEMES[name];
  return true;
}

/** True once the user has explicitly chosen a theme (saved preference exists). */
export function hasSavedTheme(): boolean {
  try {
    return existsSync(themeFile());
  } catch {
    return false;
  }
}

export function currentTheme(): Theme {
  return activeTheme;
}

// tint(): blend fg toward bg by alpha — XYRO core color primitive
export function tint(hexColor: string, alpha: number): string {
  const t = activeTheme;
  const fg = parseHex(hexColor);
  const bg = parseHex(t.background);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return rgbHex(mix(fg[0], bg[0]), mix(fg[1], bg[1]), mix(fg[2], bg[2]));
}

// withAlpha kept for compatibility — same as tint
export const withAlpha = tint;

function parseHex(h: string): [number, number, number] {
  const m = h.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [255, 255, 255];
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

function themeFile(): string {
  return join(homedir(), ".xyro", "theme");
}

function persistTheme(name: string): void {
  try {
    mkdirSync(join(homedir(), ".xyro"), { recursive: true });
    writeFileSync(themeFile(), name, "utf-8");
  } catch {
    // best effort
  }
}

export function loadPersistedTheme(): void {
  try {
    if (!existsSync(themeFile())) return;
    const name = readFileSync(themeFile(), "utf-8").trim();
    if (THEMES[name]) activeTheme = THEMES[name];
  } catch {
    // keep default
  }
}

export function themeStatusLine(): string {
  const t = currentTheme();
  const sw = (c: string) => `\u001b[48;2;${parseHex(c).join(";")}m  \u001b[0m`;
  return `theme: ${t.name}  ${[t.primary, t.secondary, t.accent, t.success, t.warning, t.error].map(sw).join(" ")}`;
}

export function pcHex(hexColor: string, text: string): string {
  return `\u001b[38;2;${parseHex(hexColor).join(";")}m${text}\u001b[0m`;
}
