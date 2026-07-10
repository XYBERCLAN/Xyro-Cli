// src/cli/banner.ts
import pc from "picocolors";
import gradient from "gradient-string";

const xyroGradient = gradient(["#4FC3E0", "#4F8FCC", "#4A5F94"]);

const ART = `
▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜
▌   X   Y   R   O                               ▐
▙▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟
`;

export function printBanner() {
  console.log();
  console.log(`  ${pc.dim("┈").repeat(55)}`);
  console.log(xyroGradient.multiline(ART));
  console.log(`  ${pc.dim("terminal-native · ai coding agent")}`);
  console.log(`  ${pc.dim("┈").repeat(55)}`);
  console.log();
}
