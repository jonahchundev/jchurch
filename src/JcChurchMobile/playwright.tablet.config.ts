import { defineConfig } from "@playwright/test";

// Tablet-viewport config for capturing user-guide screenshots.
// Run: npx playwright test -c playwright.tablet.config.ts
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "screenshots.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:8081",
    // iPad (10th gen) portrait, 2x for crisp images.
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
  },
  projects: [{ name: "tablet", use: {} }],
});
