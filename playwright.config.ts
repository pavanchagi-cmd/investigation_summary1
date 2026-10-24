import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
// Cloud sandboxes ship a Chromium at this path; elsewhere run `npx playwright install chromium`.
const preinstalled = process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    // Fresh embedded database and Gemini fixtures; nothing leaves the machine.
    command: `rm -rf .data/e2e && npm run db:migrate && npm run db:seed && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PGLITE_DIR: ".data/e2e/pglite",
      LOCAL_UPLOAD_DIR: ".data/e2e/uploads",
      GEMINI_MOCK: "1",
      AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
      SEED_USER_PASSWORD: "e2e-password",
      DATABASE_URL: "",
      BLOB_READ_WRITE_TOKEN: "",
    },
  },
});
