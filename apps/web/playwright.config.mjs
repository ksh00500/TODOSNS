import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    serviceWorkers: "block",
    baseURL: "http://localhost:3100",
    viewport: { width: 390, height: 700 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm exec -w @mungsil/web -- next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: "http://localhost:3100/api/v1",
      NEXT_PUBLIC_SOCKET_URL: "http://127.0.0.1:4998",
      NEXT_PUBLIC_ENABLE_DEMO: "false",
    },
  },
});
