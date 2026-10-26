import { defineConfig } from "vitest/config";

// Multi-connection tests that COMMIT data: run only against a freshly reset local database.
export default defineConfig({
  test: { setupFiles: ["tests/guard-setup.ts"], include: ["tests/concurrency/**/*.test.ts"], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false },
});
