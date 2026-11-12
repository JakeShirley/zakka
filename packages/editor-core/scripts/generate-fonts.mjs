import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const generatedRoot = join(packageRoot, "src/generated");

const chunkBase64 = (fontBase64) => fontBase64.match(/.{1,100}/g) ?? [""];

const fontFileBase64 = (relativeFontPath) =>
  readFileSync(join(packageRoot, relativeFontPath)).toString("base64");

const googleFontsSource = readFileSync(join(packageRoot, "src/google-fonts.ts"), "utf8");
const googleFontBlocks = googleFontsSource.match(/ {2}\{[\s\S]*?\n {2}\},/g) ?? [];
const googleFonts = googleFontBlocks.map((block) => {
  const id = block.match(/id:\s*"([^"]+)"/)?.[1];
  const vendorPath = block.match(/vendorPath:\s*"([^"]+)"/)?.[1];

  if (!id || !vendorPath) {
    throw new Error(`Could not parse Google font block: ${block}`);
  }

  return { id, vendorPath };
});
const declaredFontCount = googleFontsSource.match(/^\s+id:\s*"/gm)?.length ?? 0;

if (googleFonts.length === 0 || googleFonts.length !== declaredFontCount) {
  throw new Error(
    `Parsed ${googleFonts.length} Google Fonts entries but found ${declaredFontCount} ids`,
  );
}

const vendorPaths = [...new Set(googleFonts.map(({ vendorPath }) => vendorPath))].sort();

mkdirSync(generatedRoot, { recursive: true });

const fontFileEntries = vendorPaths.map((vendorPath) => {
  const chunks = chunkBase64(fontFileBase64(vendorPath))
    .map((chunk) => `    ${JSON.stringify(chunk)},`)
    .join("\n");

  return `  ${JSON.stringify(vendorPath)}: [\n${chunks}\n  ].join(""),`;
});

writeFileSync(
  join(generatedRoot, "googleFonts.ts"),
  `export const googleFontBase64ByVendorPath: Readonly<Record<string, string>> = {\n${fontFileEntries.join("\n")}\n};\n`,
);

console.log(
  `Generated bundled font module for ${googleFonts.length} Google Fonts entries from ${vendorPaths.length} files.`,
);
