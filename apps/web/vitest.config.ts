import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { pointerDrag } from "./vitest.commands";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.tsx"],
          setupFiles: ["./src/test/browserSetup.ts"],
          browser: {
            commands: { pointerDrag },
            enabled: true,
            headless: true,
            provider: playwright(),
            screenshotFailures: false,
            viewport: { width: 1280, height: 900 },
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
