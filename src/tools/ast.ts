import { Project } from "ts-morph";
import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import fg from "fast-glob";
import { IGNORED_DIRS } from "../config/constants.js";
import { isWindows } from "../config/platform.js";
import { resolveProjectPath } from "./safety.js";

function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
  });
}

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export async function astInspectFile(args: { path: string }): Promise<string> {
  const resolved = resolveProjectPath(args.path, "read");
  if (!resolved.ok) return resolved.message;
  const filePath = resolved.path;
  if (!existsSync(filePath)) {
    return `❌ File not found: ${filePath}`;
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) {
    return `ℹ️ AST inspection is only supported for TypeScript and JavaScript files (${Array.from(SUPPORTED_EXTS).join(", ")}).`;
  }

  try {
    const code = readFileSync(filePath, "utf-8");
    const project = createProject();
    const sf = project.createSourceFile(filePath, code);

    const sections: string[] = [];
    sections.push(`📁 AST Outline: ${filePath}`);

    const imports = sf.getImportDeclarations();
    if (imports.length > 0) {
      const moduleList = imports
        .map((i) => i.getModuleSpecifierValue())
        .slice(0, 10)
        .join(", ");
      const more = imports.length > 10 ? ` (+${imports.length - 10} more)` : "";
      sections.push(`\n📦 Imports (${imports.length}): ${moduleList}${more}`);
    }

    const classes = sf.getClasses();
    if (classes.length > 0) {
      sections.push(`\n🏛️ Classes (${classes.length}):`);
      for (const cls of classes) {
        const isExp = cls.isExported() ? "export " : "";
        const name = cls.getName() || "(anonymous)";
        const methods = cls.getMethods().map((m) => m.getName()).join(", ") || "none";
        const props = cls.getProperties().map((p) => p.getName()).join(", ") || "none";
        sections.push(`  • ${isExp}class ${name}`);
        sections.push(`    - Properties: ${props}`);
        sections.push(`    - Methods: ${methods}`);
      }
    }

    const interfaces = sf.getInterfaces();
    if (interfaces.length > 0) {
      sections.push(`\n📝 Interfaces (${interfaces.length}):`);
      for (const iface of interfaces) {
        const isExp = iface.isExported() ? "export " : "";
        const name = iface.getName();
        const members = iface.getMembers().map((m) => m.getText()).slice(0, 5).join("; ");
        const more = iface.getMembers().length > 5 ? ` (+${iface.getMembers().length - 5} more)` : "";
        sections.push(`  • ${isExp}interface ${name} { ${members}${more} }`);
      }
    }

    const typeAliases = sf.getTypeAliases();
    if (typeAliases.length > 0) {
      sections.push(`\n🏷️ Type Aliases (${typeAliases.length}):`);
      for (const ta of typeAliases) {
        const isExp = ta.isExported() ? "export " : "";
        sections.push(`  • ${isExp}type ${ta.getName()}`);
      }
    }

    const functions = sf.getFunctions();
    if (functions.length > 0) {
      sections.push(`\n⚡ Functions (${functions.length}):`);
      for (const fn of functions) {
        const isExp = fn.isExported() ? "export " : "";
        const isAsync = fn.isAsync() ? "async " : "";
        const name = fn.getName() || "(anonymous)";
        const params = fn.getParameters().map((p) => p.getText()).join(", ");
        const ret = fn.getReturnTypeNode()?.getText() || "";
        const retStr = ret ? `: ${ret}` : "";
        sections.push(`  • ${isExp}${isAsync}function ${name}(${params})${retStr}`);
      }
    }

    const enums = sf.getEnums();
    if (enums.length > 0) {
      sections.push(`\n🔢 Enums (${enums.length}):`);
      for (const en of enums) {
        const isExp = en.isExported() ? "export " : "";
        const members = en.getMembers().map((m) => m.getName()).join(", ");
        sections.push(`  • ${isExp}enum ${en.getName()} { ${members} }`);
      }
    }

    const varStatements = sf.getVariableStatements().filter((v) => v.isExported());
    if (varStatements.length > 0) {
      sections.push(`\n📌 Exported Constants/Variables:`);
      for (const vs of varStatements) {
        for (const decl of vs.getDeclarations()) {
          sections.push(`  • export const ${decl.getName()}`);
        }
      }
    }

    return sections.join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ AST parse error for ${filePath}: ${msg}`;
  }
}

export async function astFindSymbol(args: { symbol: string; path?: string }): Promise<string> {
  const symbol = args.symbol.trim();
  if (!symbol) return "❌ Symbol name is required";

  const resolved = resolveProjectPath(args.path || ".", "read");
  if (!resolved.ok) return resolved.message;
  const dir = resolved.path;
  const ignorePatterns = Array.from(IGNORED_DIRS).flatMap((d) => [`**/${d}/**`, `**/${d}`]);
  ignorePatterns.push("**/.*/**");

  const files = await fg("**/*.{ts,tsx,js,jsx}", {
    cwd: dir,
    dot: false,
    onlyFiles: true,
    ignore: ignorePatterns,
    followSymbolicLinks: false,
  });

  files.sort();

  const matches: string[] = [];
  const project = createProject();

  for (const rel of files) {
    if (matches.length >= 25) break;
    const fullPath = join(dir, rel);
    try {
      const code = readFileSync(fullPath, "utf-8");
      if (!code.includes(symbol)) continue;

      const sf = project.createSourceFile(fullPath, code, { overwrite: true });
      const displayPath = isWindows ? fullPath.replace(/\\/g, "/") : fullPath;

      for (const fn of sf.getFunctions()) {
        if (fn.getName() === symbol) {
          const lineNum = fn.getStartLineNumber();
          matches.push(`⚡ [function] ${displayPath}:${lineNum} - ${fn.getText().split("\n")[0]}`);
        }
      }

      for (const cls of sf.getClasses()) {
        if (cls.getName() === symbol) {
          const lineNum = cls.getStartLineNumber();
          matches.push(`🏛️ [class] ${displayPath}:${lineNum} - class ${symbol}`);
        }
        for (const m of cls.getMethods()) {
          if (m.getName() === symbol) {
            const lineNum = m.getStartLineNumber();
            matches.push(`🔧 [method] ${displayPath}:${lineNum} - ${cls.getName()}.${symbol}()`);
          }
        }
      }

      for (const iface of sf.getInterfaces()) {
        if (iface.getName() === symbol) {
          const lineNum = iface.getStartLineNumber();
          matches.push(`📝 [interface] ${displayPath}:${lineNum} - interface ${symbol}`);
        }
      }

      for (const ta of sf.getTypeAliases()) {
        if (ta.getName() === symbol) {
          const lineNum = ta.getStartLineNumber();
          matches.push(`🏷️ [type] ${displayPath}:${lineNum} - type ${symbol}`);
        }
      }

      for (const vs of sf.getVariableStatements()) {
        for (const decl of vs.getDeclarations()) {
          if (decl.getName() === symbol) {
            const lineNum = decl.getStartLineNumber();
            matches.push(`📌 [variable] ${displayPath}:${lineNum} - const ${symbol}`);
          }
        }
      }
    } catch {
      // skip unparseable
    }
  }

  return matches.length > 0
    ? `🔍 Symbol '${symbol}' found in ${matches.length} declaration(s):\n\n` + matches.join("\n")
    : `No symbol declaration found for '${symbol}'`;
}
