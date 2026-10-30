import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3102",
    screenshot: "only-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: "bun run dev:app",
    cwd: "../..",
    url: "http://127.0.0.1:3102/apps/workspace/",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
  },
});
