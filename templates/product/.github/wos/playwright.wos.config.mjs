// wOS browser matrix for web acceptance (D13). Owned by the verification workstream; lives under .github/,
// which no submission can change. A web suite runs `npx playwright test --config .github/wos/playwright.wos.config.mjs`
// (or $WOS_PLAYWRIGHT_CONFIG); wos-ci.mjs then checks the JSON report proves every browser ran and passed.
// Projects come from WOS_BROWSERS (set by wos-ci.mjs from wos.json `browsers`, the suite and MINIMUM_BROWSERS),
// never from the suite. Retries 0 and forbidOnly, so a flaky or focused test cannot pass the gate.
// Requires `@playwright/test` as a devDependency of the product repo.
import { defineConfig, devices } from "@playwright/test";
import { PLAYWRIGHT_PROJECTS } from "./wos-ci-lib.mjs";

const browsers = (process.env.WOS_BROWSERS ?? "").split(",").filter(Boolean);
if (browsers.length === 0) throw new Error("WOS_BROWSERS is empty: run web acceptance through .github/wos/wos-ci.mjs");
if (!process.env.WOS_REPORT) throw new Error("WOS_REPORT is not set: run web acceptance through .github/wos/wos-ci.mjs");

const projects = browsers.map((name) => {
  const p = PLAYWRIGHT_PROJECTS[name];
  if (!p) throw new Error(`unknown browser ${name}`);
  const device = devices[p.device];
  if (!device) throw new Error(`Playwright has no device descriptor "${p.device}" (browser ${name})`);
  return { name, use: { ...device, ...(p.channel ? { channel: p.channel } : {}) } };
});

export default defineConfig({
  testDir: process.env.WOS_SUITE_DIR,
  forbidOnly: true,
  retries: 0,
  fullyParallel: true,
  reporter: [["list"], ["json", { outputFile: process.env.WOS_REPORT }]],
  projects,
});
