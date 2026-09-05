// src/cli/banner.ts
import pc from "picocolors";

export function printBanner() {
  console.log();
  console.log(`  ${pc.cyan("◆")} ${pc.bold("XYRO")} ${pc.dim("— terminal-native ai coding agent")}`);
  console.log();
}
