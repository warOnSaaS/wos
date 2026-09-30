/**
 * mobile-runtime (WORKSTREAMS 12.1): runs the product template's wOS Mobile runtime tests in the workspace run, the way
 * tests/suite-shell.test.ts runs wOS Core's and wOS Web's. They live in templates/product/apps/mobile (the product repo
 * runs them with its own vitest config); importing them here registers their suites, so `npm test` and
 * `npm run typecheck` at the root cover them. They need no simulator: the runtime has no React Native import.
 */
import "../templates/product/apps/mobile/test/renderer.test.js";
import "../templates/product/apps/mobile/test/session.test.js";
import "../templates/product/apps/mobile/test/navigation.test.js";
import "../templates/product/apps/mobile/test/core-proof.test.js";
