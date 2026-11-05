import { defineConfig, devices } from "@playwright/test";

// Against the live site: BASE_URL=https://ozenyunus35.github.io/sql-copilot/ npx playwright test
const live = process.env.BASE_URL;
const base = process.env.PAGES_BASE_PATH ?? "/sql-copilot";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: live ?? `http://localhost:4176${base}/`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: live
    ? undefined
    : {
        command: "node scripts/serve.mjs",
        env: { PAGES_BASE_PATH: base },
        url: `http://localhost:4176${base}/`,
        reuseExistingServer: !process.env.CI,
      },
});
