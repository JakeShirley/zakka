// Wraps the vendored map data in TypeScript modules so the lazily imported map entry points
// can bundle it in both the browser and Node without JSON import attributes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorRoot = join(packageRoot, "vendor/maps");
const generatedRoot = join(packageRoot, "src/generated");

const modules = [
  ["mapWorld50m.ts", "mapWorld50mTopology", "world-50m.topojson"],
  ["mapWorld10m.ts", "mapWorld10mTopology", "world-10m.topojson"],
  ["mapPlaces.ts", "mapPlacesTsv", "places.tsv"],
];

mkdirSync(generatedRoot, { recursive: true });

for (const [fileName, exportName, vendorFile] of modules) {
  const contents = readFileSync(join(vendorRoot, vendorFile), "utf8");

  writeFileSync(
    join(generatedRoot, fileName),
    `export const ${exportName} = ${JSON.stringify(contents)};\n`,
  );
}

console.log(`Generated ${modules.length} bundled map data modules.`);
