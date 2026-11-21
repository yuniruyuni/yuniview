import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  // Snapshot configuration
  snapshotDir: "./__snapshots__",
  snapshotPathTemplate:
    "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}-{platform}{ext}",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: {
      mode: "only-on-failure",
      fullPage: true,
    },
    // VRT固有の設定を統合
    ignoreHTTPSErrors: true,
    colorScheme: "light",
    timezoneId: "Asia/Tokyo",
    locale: "en-US",
  },

  projects: process.env.CI
    ? [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },

        {
          name: "firefox",
          use: { ...devices["Desktop Firefox"] },
        },

        {
          name: "webkit",
          use: { ...devices["Desktop Safari"] },
        },
      ],

  webServer: {
    command: "bun run check:e2e:start",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    env: {
      E2E_TEST: "true",
      YUNIVIEW_ADMIN_AUTH: "local",
      INGEST_PORT: "0",
      // e2e は DB を要求しないシナリオなので、起動時の SELECT 1 検証で
      // fail-early させない。production では常に未設定にする。
      SKIP_DB_VERIFY: "1",
    },
    timeout: 120 * 1000,
  },
});
