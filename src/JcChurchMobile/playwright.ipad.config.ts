import { defineConfig } from "@playwright/test";

// iPad-viewport config for the duplicate-review comparison screenshot.
// Run: npx playwright test -c playwright.ipad.config.ts
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "screenshots.spec.ts",
  grep: /guide screenshots: duplicate members/,
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:8081",
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
  },
  projects: [{ name: "ipad", use: {} }],
});