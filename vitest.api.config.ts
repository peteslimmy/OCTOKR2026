import { defineConfig } from "vitest/config";
import path from "node:path";

// HTTP-level tests: require `npm run dev` (or a deployed URL via API_BASE) and a seeded database.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/api/**/*.test.ts"], testTimeout: 30000, fileParallelism: false },
});
