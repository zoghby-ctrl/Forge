import { defineConfig, devices } from "@playwright/test";

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "3003";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${playwrightPort}`;
const isCI = Boolean(process.env.CI);
const runGitHubMock = process.env.FORGE_E2E_GITHUB_MOCK === "1";
const nextServer = {
  command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${playwrightPort}`,
  url: `${baseURL}/api/health`,
  reuseExistingServer: !isCI,
  timeout: 120_000,
};
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : runGitHubMock
    ? [
        {
          command: "node tests/e2e/github-mock-server.mjs",
          url: "http://127.0.0.1:4010/health",
          reuseExistingServer: !isCI,
          timeout: 30_000,
        },
        nextServer,
      ]
    : nextServer;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? "github" : "list",
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer,
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "tablet",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], browserName: "chromium" },
    },
  ],
});
