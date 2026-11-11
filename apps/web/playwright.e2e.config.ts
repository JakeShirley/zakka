import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const apiPort = 4310;
const webPort = 5310;
const webDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(webDir, "../api");

// Workers re-load this config, so keep one data directory for the whole run via the environment.
process.env.ZAKKA_E2E_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "zakka-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "./test-results/e2e",
  globalTeardown: "./e2e/globalTeardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 960 },
  },
  webServer: [
    {
      command: "pnpm exec tsx src/index.ts",
      cwd: apiDir,
      env: {
        API_HOST: "127.0.0.1",
        API_PORT: String(apiPort),
        NODE_ENV: "test",
        WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
        ZAKKA_DATA_DIR: process.env.ZAKKA_E2E_DATA_DIR,
      },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: webDir,
      env: { ZAKKA_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      url: `http://127.0.0.1:${webPort}`,
    },
  ],
});
