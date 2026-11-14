import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const generatedRoot = join(packageRoot, "src/generated");
const distRoot = join(packageRoot, "dist");

const chunkBase64 = (fontBase64) => fontBase64.match(/.{1,100}/g) ?? [""];

const fontFileBase64 = (relativeFontPath) =>
  readFileSync(join(packageRoot, relativeFontPath)).toString("base64");

// Mirrors license_path in scripts/vendor-google-fonts.py.
const googleFontLicensePath = (googleFamily) =>
  `vendor/fonts/google-fonts/licenses/${googleFamily
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.txt`;

const googleFontsSource = readFileSync(join(packageRoot, "src/google-fonts.ts"), "utf8");
const googleFontBlocks = googleFontsSource.match(/ {2}\{[\s\S]*?\n {2}\},/g) ?? [];
const googleFonts = googleFontBlocks.map((block) => {
  const id = block.match(/id:\s*"([^"]+)"/)?.[1];
  const family = block.match(/\bfamily:\s*"([^"]+)"/)?.[1];
  const googleFamily = block.match(/googleFamily:\s*"([^"]+)"/)?.[1];
  const vendorPath = block.match(/vendorPath:\s*"([^"]+)"/)?.[1];

  if (!id || !family || !googleFamily || !vendorPath) {
    throw new Error(`Could not parse Google font block: ${block}`);
  }

  return { id, family, googleFamily, vendorPath };
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

const familiesByGoogleFamily = new Map();

for (const { family, googleFamily } of googleFonts) {
  familiesByGoogleFamily.set(googleFamily, [
    ...(familiesByGoogleFamily.get(googleFamily) ?? []),
    family,
  ]);
}

const licenseSections = [...familiesByGoogleFamily]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([googleFamily, families]) => {
    const heading = `${googleFamily} (used for ${families.join(", ")})`;
    const licenseText = readFileSync(
      join(packageRoot, googleFontLicensePath(googleFamily)),
      "utf8",
    ).trim();

    return `${"=".repeat(80)}\n${heading}\n${"=".repeat(80)}\n\n${licenseText}\n`;
  });

mkdirSync(distRoot, { recursive: true });
writeFileSync(
  join(distRoot, "font-licenses.txt"),
  `Zakka bundles the following Google Fonts families, subset and converted to WOFF.\n\n${licenseSections.join("\n")}`,
);

console.log(
  `Generated bundled font module for ${googleFonts.length} Google Fonts entries from ${vendorPaths.length} files.`,
);
