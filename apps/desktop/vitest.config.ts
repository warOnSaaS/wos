import { defineConfig } from "vitest/config";

// Desktop's own suite (root vitest.config.ts does not include apps/desktop yet: blocker B-0001-desktop).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
