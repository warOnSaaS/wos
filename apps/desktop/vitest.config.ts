import { defineConfig } from "vitest/config";

// Desktop's own suite. The root vitest.config.ts includes apps/desktop too (B-0001-desktop, ruled at 4.4.0).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
