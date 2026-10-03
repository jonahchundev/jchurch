import { defineConfig } from "@playwright/test";

// iPhone Pro Max viewport config for capturing user-guide screenshots.
// Run: npx playwright test -c playwright.tablet.config.ts
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "screenshots.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:8081",
    // iPhone Pro Max portrait, 3x for crisp images.
    viewport: { width: 430, height: 932 },
    isMobile: true,
    deviceScaleFactor: 3,
  },
  projects: [{ name: "iphone-pro-max", use: {} }],
});
