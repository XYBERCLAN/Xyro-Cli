// Team configuration: which model each expert uses and how many tokens it may
// spend per task.
//
//   ~/.config/xyro/experts.json   (yours)   ·   .xyro/experts.json   (project overrides)
//
//   {
//     "models":  { "scout": { "model": "llama-3.1-8b-instant", "providerId": "groq" },
//                  "architect": { "model": "deepseek/deepseek-r1:free", "providerId": "openrouter" } },
//     "budgets": { "default": 60000, "builder": 150000 }
//   }
//
// A model on another provider uses that provider's saved key — so a cheap fast
// model can scout while a strong one designs (mix providers freely).

import * as fs from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/platform.js";

export interface ExpertModel {
  model: string;
  providerId?: string;
}

export interface TeamConfig {
  models: Record<string, ExpertModel>;
  budgets: Record<string, number>;
}

export const DEFAULT_TOKEN_BUDGET = 60_000;

function userPath(): string {
  return join(getConfigDir(), "experts.json");
}

function read(path: string): Partial<TeamConfig> {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8")) as Partial<TeamConfig>;
  } catch {
    return {};
  }
}

export function loadTeamConfig(root = process.cwd()): TeamConfig {
  const user = read(userPath());
  const project = read(join(root, ".xyro", "experts.json"));
  return {
    models: { ...(user.models ?? {}), ...(project.models ?? {}) },
    budgets: { ...(user.budgets ?? {}), ...(project.budgets ?? {}) },
  };
}

/** Assign (or clear, with null) the model an expert uses — saved to your config. */
export function setExpertModel(expert: string, value: ExpertModel | null): void {
  const cfg = read(userPath());
  const models = { ...(cfg.models ?? {}) };
  if (value) models[expert] = value;
  else delete models[expert];
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(userPath(), JSON.stringify({ ...cfg, models }, null, 2));
  } catch {
    // best effort
  }
}

export function expertModel(expert: string): ExpertModel | undefined {
  return loadTeamConfig().models[expert];
}

export function expertBudget(expert: string): number {
  const b = loadTeamConfig().budgets;
  const v = b[expert] ?? b.default ?? DEFAULT_TOKEN_BUDGET;
  return Number.isFinite(v) && v > 1000 ? v : DEFAULT_TOKEN_BUDGET;
}
