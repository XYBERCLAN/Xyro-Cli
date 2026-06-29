// src/cli/banner.ts
import pc from "picocolors";
import gradient from "gradient-string";

const xyberGradient = gradient(["#4FC3E0", "#4F8FCC", "#4A5F94"]);

const ART = `
▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜
▌ X Y B E R C L A N                              ▐
▙▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟
`;

export function printBanner() {
  console.log();
  console.log(`  ${pc.dim("┈").repeat(55)}`);
  console.log(xyberGradient.multiline(ART));
  console.log(`  ${pc.dim("red team lead · ai agent cli")}`);
  console.log(`  ${pc.dim("┈").repeat(55)}`);
  console.log();
}
