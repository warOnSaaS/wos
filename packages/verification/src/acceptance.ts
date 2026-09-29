/**
 * Per-surface acceptance (D13) for the product repo's CI: which browsers and platforms a suite must run,
 * how each Browser maps to a Playwright project, and how a run's report proves every one of them ran.
 * Pure: the CI runner (templates/product/.github/wos) parses reports and calls these.
 *
 * The matrix is never under the suite's control: wOS sets the projects (playwright.wos.config.mjs reads
 * WOS_BROWSERS) and then checks the report, so a suite that skips a browser, or a run that never loads the
 * wOS config, fails the check run.
 */
import { type Browser, MINIMUM_BROWSERS, type RepoManifest, type SurfaceAcceptance } from "@waronsaas/contracts";

/**
 * Browser -> Playwright project (device descriptor name in `@playwright/test` `devices`, optional channel).
 * Desktop viewports for the four desktop browsers, phone viewports for iPhone Safari and Android Chrome.
 * Playwright's WebKit is the automatable engine behind Safari; it runs on Linux (macOS runners are only for
 * native iOS, D13).
 */
export const PLAYWRIGHT_PROJECTS: Record<Browser, { device: string; channel?: string; viewport: "desktop" | "phone" }> = {
  chromium: { device: "Desktop Chrome", viewport: "desktop" },
  edge: { device: "Desktop Edge", channel: "msedge", viewport: "desktop" },
  webkit: { device: "Desktop Safari", viewport: "desktop" },
  firefox: { device: "Desktop Firefox", viewport: "desktop" },
  mobile_safari: { device: "iPhone 15", viewport: "phone" },
  mobile_chrome: { device: "Pixel 7", viewport: "phone" },
};

/** Playwright browser engines to install for a matrix (`npx playwright install --with-deps ...`). */
export function playwrightEngines(browsers: readonly Browser[]): string[] {
  const engine = (b: Browser) => (b === "edge" ? "msedge" : b === "mobile_safari" ? "webkit" : b === "mobile_chrome" ? "chromium" : b);
  return [...new Set(browsers.map(engine))].sort();
}

/** The browsers a web suite must run: the suite's list, the repo's list and the D13 minimum, deduplicated. */
export function requiredBrowsers(suite: Pick<SurfaceAcceptance, "browsers">, manifest: Pick<RepoManifest, "browsers">): Browser[] {
  const order = Object.keys(PLAYWRIGHT_PROJECTS) as Browser[];
  const all = new Set<Browser>([...MINIMUM_BROWSERS, ...(manifest.browsers ?? []), ...suite.browsers]);
  return order.filter((b) => all.has(b));
}

/**
 * Where a suite may run. macOS runners (expensive) only for native iOS; iOS needs macOS (Simulator + Xcode).
 * Returns the problems, empty when the suite is placed correctly.
 */
export function runnerProblems(suite: Pick<SurfaceAcceptance, "surface" | "runner">): string[] {
  if (suite.surface === "ios" && suite.runner !== "macos") return ["ios acceptance needs a macos runner (Simulator and Xcode)"];
  if (suite.surface !== "ios" && suite.runner === "macos")
    return [`${suite.surface} acceptance may not use a macos runner (macOS only for native iOS)`];
  return [];
}

export interface ReportCheck {
  ok: boolean;
  problems: string[];
}

interface PwTest {
  projectName?: string;
  status?: string;
}
interface PwSuite {
  specs?: { tests?: PwTest[] }[];
  suites?: PwSuite[];
}

/**
 * Checks a Playwright JSON report: every required browser has a project, every project ran at least one
 * test that was not skipped, and nothing failed. Flaky (passed on retry) counts as a failure: the wOS
 * config sets retries 0, so "flaky" means someone changed it.
 */
export function checkPlaywrightReport(report: unknown, browsers: readonly Browser[]): ReportCheck {
  const problems: string[] = [];
  const r = report as { config?: { projects?: { name?: string }[] }; suites?: PwSuite[] } | null;
  if (!r || !Array.isArray(r.suites)) return { ok: false, problems: ["not a Playwright JSON report"] };
  const projects = new Set((r.config?.projects ?? []).map((p) => p.name));
  const ran = new Map<string, { run: number; skipped: number; bad: number }>();
  const walk = (s: PwSuite) => {
    for (const spec of s.specs ?? [])
      for (const t of spec.tests ?? []) {
        const k = t.projectName ?? "";
        const c = ran.get(k) ?? { run: 0, skipped: 0, bad: 0 };
        if (t.status === "skipped") c.skipped++;
        else if (t.status === "expected") c.run++;
        else c.bad++;
        ran.set(k, c);
      }
    for (const child of s.suites ?? []) walk(child);
  };
  for (const s of r.suites) walk(s);
  for (const b of browsers) {
    const c = ran.get(b);
    if (!projects.has(b) && !c) problems.push(`browser ${b} did not run (no project in the report)`);
    else if (!c || c.run + c.bad === 0) problems.push(`browser ${b} ran no test (${c?.skipped ?? 0} skipped)`);
    if (c && c.bad > 0) problems.push(`browser ${b}: ${c.bad} test(s) failed, timed out or were flaky`);
  }
  for (const name of ran.keys()) if (!browsers.includes(name as Browser)) problems.push(`unexpected project ${JSON.stringify(name)}`);
  return { ok: problems.length === 0, problems };
}

/**
 * Checks a Maestro JUnit report (iOS or Android): at least one test case, none failed or errored, and not
 * every case skipped. Text-level parsing, enough for the JUnit Maestro writes; no XML dependency.
 */
export function checkJUnitReport(xml: string): ReportCheck {
  const problems: string[] = [];
  if (!/<testsuites?[\s>]/.test(xml)) return { ok: false, problems: ["not a JUnit report"] };
  const cases = xml.match(/<testcase[\s>]/g)?.length ?? 0;
  const failures = (xml.match(/<failure[\s>/]/g)?.length ?? 0) + (xml.match(/<error[\s>/]/g)?.length ?? 0);
  const skipped = xml.match(/<skipped[\s>/]/g)?.length ?? 0;
  if (cases === 0) problems.push("no test case ran");
  else if (skipped >= cases) problems.push(`every test case was skipped (${skipped})`);
  if (failures > 0) problems.push(`${failures} test case(s) failed`);
  return { ok: problems.length === 0, problems };
}
