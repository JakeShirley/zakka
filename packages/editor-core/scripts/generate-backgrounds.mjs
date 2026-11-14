import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(packageRoot, "vendor", "backgrounds");
const distRoot = join(packageRoot, "dist", "backgrounds");
const vendorTextures = join(vendorRoot, "textures");
const distTextures = join(distRoot, "textures");

if (!existsSync(vendorTextures)) {
  throw new Error("Missing vendor/backgrounds/textures; run scripts/vendor-background-textures.py");
}

// Sync in place instead of wiping the directory: turbo can run `build` and
// `test` concurrently, and both invoke this script.
mkdirSync(distTextures, { recursive: true });
const vendorFiles = new Set(readdirSync(vendorTextures));
for (const name of vendorFiles) {
  const source = join(vendorTextures, name);
  const target = join(distTextures, name);
  if (existsSync(target)) {
    const sourceStat = statSync(source);
    const targetStat = statSync(target);
    if (sourceStat.size === targetStat.size && targetStat.mtimeMs >= sourceStat.mtimeMs) continue;
  }
  copyFileSync(source, target);
}
for (const name of readdirSync(distTextures)) {
  if (!vendorFiles.has(name)) rmSync(join(distTextures, name), { force: true, recursive: true });
}
writeFileSync(join(distRoot, "LICENSE.md"), readFileSync(join(vendorRoot, "LICENSE.md"), "utf8"));

console.log("Copied background textures to dist/backgrounds.");
