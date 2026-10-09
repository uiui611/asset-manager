import { defineConfig, devices } from "@playwright/test";

process.env.PLAYWRIGHT_BROWSERS_PATH = new URL(
  "./.cache/playwright",
  import.meta.url,
).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // Avoid competing WebKit page launches on the shared CI runner.
  workers: process.env.CI ? 1 : 3,
  timeout: 30000,
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "bun run dev --port 5174 --mode e2e",
    url: "http://localhost:5174",
    reuseExistingServer: false,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
