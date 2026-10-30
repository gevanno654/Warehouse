import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    // Database-backed files share one PostgreSQL test database and truncate
    // between cases, so they must not run in parallel with each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
