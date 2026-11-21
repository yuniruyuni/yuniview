import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./console",
  testMatch: "live.ts",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: process.env.CONSOLE_URL,
    actionTimeout: 10000,
    browserName: "chromium",
    locale: "ja-JP",
    trace: "retain-on-failure",
  },
});
