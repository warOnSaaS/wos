import { defineConfig } from "vitest/config";

// The runtime (src/runtime, src/modules) has no React Native import, so its tests run in plain Node: no simulator,
// no emulator, no react-native mocks. The React Native views in src/ui are covered by the typecheck and `expo export`.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 30_000 } });
