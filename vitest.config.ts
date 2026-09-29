import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "services/*/test/**/*.test.ts", "apps/cli/test/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
