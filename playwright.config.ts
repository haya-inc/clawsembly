import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CLAWSEMBLY_TEST_PORT ?? "5173");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError("CLAWSEMBLY_TEST_PORT must be a valid TCP port");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  preserveOutput: "always",
  timeout: 4 * 60_000,
  expect: { timeout: 90_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  // Desktop Chromium is the first declared browser baseline. Firefox/WebKit
  // belong in the BrowserPod provider matrix after owner-authorized evidence,
  // not in this provider-free page and browser-host test suite.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --config apps/web/vite.config.js --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
