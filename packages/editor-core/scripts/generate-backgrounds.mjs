import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(packageRoot, "vendor", "backgrounds");
const distRoot = join(packageRoot, "dist", "backgrounds");

if (!existsSync(join(vendorRoot, "textures"))) {
  throw new Error("Missing vendor/backgrounds/textures; run scripts/vendor-background-textures.py");
}

rmSync(distRoot, { force: true, recursive: true });
mkdirSync(distRoot, { recursive: true });
cpSync(join(vendorRoot, "textures"), join(distRoot, "textures"), { recursive: true });
writeFileSync(
  join(distRoot, "LICENSE.md"),
  readFileSync(join(vendorRoot, "LICENSE.md"), "utf8"),
);

console.log("Copied background textures to dist/backgrounds.");
