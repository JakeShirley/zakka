import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { env } from "node:process";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The web bundle inlines editor-core's fonts, so ship their licenses with it.
const fontLicenses = (): Plugin => ({
  name: "zakka-font-licenses",
  apply: "build",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "font-licenses.txt",
      source: readFileSync(
        createRequire(import.meta.url).resolve("@zakka/editor-core/font-licenses.txt"),
      ),
    });
  },
});

export default defineConfig({
  plugins: [react(), fontLicenses()],
  server: {
    port: 5173,
    proxy: {
      "/api": env.ZAKKA_API_PROXY_TARGET ?? "http://127.0.0.1:4000",
    },
  },
});
