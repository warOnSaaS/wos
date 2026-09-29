/** Test-side entry: the harness lives in src/testing so it can be exported to other suites. */
import { vi } from "vitest";

export * from "../../src/testing/harness.js";

// Database scenarios run many requests; under a loaded full-suite run the 5 s default is too tight.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
