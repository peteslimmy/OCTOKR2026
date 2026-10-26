import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

// Playwright starts the web server BEFORE its global setup, so refuse here, before anything starts, unless this is the test stack (or CI).
// The full check (ports, database marker) follows in tests/e2e/global-guard.ts.
if (process.env.CI !== "true" && process.env.OKR_TEST_STACK !== "1") {
  throw new Error("REFUSING TO RUN BROWSER TESTS: they must run against the test stack, never your real database. Use: npm run test:e2e");
}

/**
 * End-to-end tests drive the real application in a real browser against the local Supabase stack:
 *   npm run test:e2e          resets the local database, seeds it, starts the app and runs the suite
 *   E2E_CHANNEL=msedge        use an installed browser instead of the downloaded Chromium (default in CI: bundled Chromium)
 *   E2E_PROD=1                run against `npm run build && npm run start` (the production server) instead of the dev server
 *   E2E_BROWSER=firefox|webkit  run in another engine (default chromium); CI runs all three, the last two as informational
 *   E2E_NO_SERVER=1           reuse an app you already started on E2E_BASE_URL (default http://localhost:3000)
 * The specs share one database and move its development clock forward, so they run in order, in a single worker.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";   // never the real app on 3000

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-guard.ts",   // refuses to run unless this is the test stack (tests/guard.ts)
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    browserName: (process.env.E2E_BROWSER as "chromium" | "firefox" | "webkit" | undefined) ?? "chromium",
    channel: process.env.E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",   // deterministic tests; the animated paths are covered by the 3D/step-form specs, which switch it off
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : { command: process.env.CI || process.env.E2E_PROD ? `npm run start -- --port ${new URL(baseURL).port}` : `npm run dev -- --port ${new URL(baseURL).port}`, url: `${baseURL}/login`, reuseExistingServer: !process.env.CI, timeout: 180_000, env: { ...(process.env as Record<string, string>), RATE_LIMIT_STORE: "memory", INTEGRATIONS_ALLOW_PRIVATE_HOSTS: "true" } },
});
