// src/cli/banner.ts
import pc from "picocolors";

export function printBanner() {
  console.log();
  console.log(`  ${pc.dim("terminal-native . ai coding agent")}`);
  console.log(`  ${pc.dim("-".repeat(50))}`);
  console.log();
}
