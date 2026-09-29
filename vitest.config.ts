import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "apps/cli/test/**/*.test.ts",
      "apps/desktop/test/**/*.test.ts",
      "apps/desktop/test/**/*.test.tsx",
      "tests/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
