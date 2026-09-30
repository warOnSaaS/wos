/**
 * Adversarial suite, D13 surfaces and D15 models (security-hardening): a web suite missing a browser, a
 * native ABU claimed from Linux, a Sol builder in a reviewer slot, and S-36 (no vendor trade dress).
 * The end-to-end runs of the CI runner live in packages/verification/test/templates.test.ts; the API-level
 * claim attack lives in api.adversarial.test.ts (pending the control-plane harness).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkEligibility, ELIGIBILITY_REASONS, type EligibilityInput } from "@waronsaas/agent-policy";
import {
  AGENT_POLICY,
  type Browser,
  MINIMUM_BROWSERS,
  type ProviderAttestation,
  RepoManifest,
  RequirementProfile,
  ToolchainAttestation,
} from "@waronsaas/contracts";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";
import { checkPlaywrightReport, requiredBrowsers } from "../../packages/verification/src/index.js";
import { REPO_ROOT } from "../../packages/verification/test/support/git-fixture.js";

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const template = RepoManifest.parse(JSON.parse(readFileSync(join(REPO_ROOT, "templates/product/wos.json"), "utf8")));

// ---- a web suite missing a browser -------------------------------------------------------------------
describe("D13: a web suite missing a browser is refused at every layer", () => {
  const web = (browsers: string[]) => ({
    target: "salesforce",
    requirements: ["R-001"],
    acceptance: [
      { surface: "web", dir: "features/contacts/acceptance/salesforce/web", run: ["npx", "playwright", "test"], browsers, runner: "linux" },
    ],
  });

  it.each(MINIMUM_BROWSERS.map((b) => [b]))("the Feature Contract profile refuses web acceptance without %s", (missing) => {
    expect(RequirementProfile.safeParse(web(MINIMUM_BROWSERS.filter((b) => b !== missing))).success).toBe(false);
  });
  it("the profile accepts the full minimum", () => expect(RequirementProfile.safeParse(web([...MINIMUM_BROWSERS])).success).toBe(true));

  it("wos.json refuses a browser list without Firefox", () => {
    expect(RepoManifest.safeParse({ ...template, browsers: MINIMUM_BROWSERS.filter((b) => b !== "firefox") }).success).toBe(false);
  });

  it("the CI matrix always includes the D13 minimum, even if suite and repo lists were narrowed", () => {
    expect(requiredBrowsers({ browsers: ["chromium"] }, { browsers: ["chromium"] as Browser[] })).toEqual([...MINIMUM_BROWSERS]);
  });

  const report = (tests: { projectName: string; status: string }[], projects = tests.map((t) => t.projectName)) => ({
    config: { projects: [...new Set(projects)].map((name) => ({ name })) },
    suites: [{ title: "journey", specs: [{ tests }], suites: [] }],
  });
  const all = MINIMUM_BROWSERS.map((b) => ({ projectName: b, status: "expected" }));

  it("a report covering every browser passes", () => expect(checkPlaywrightReport(report(all), [...MINIMUM_BROWSERS]).ok).toBe(true));
  it.each([
    ["a browser dropped from the report", report(all.filter((t) => t.projectName !== "mobile_safari")), /mobile_safari did not run/],
    [
      "a browser whose tests were all skipped (test.skip(browserName === 'webkit'))",
      report(all.map((t) => (t.projectName === "webkit" ? { ...t, status: "skipped" } : t))),
      /webkit ran no test/,
    ],
    [
      "a flaky pass on one browser (retries re-enabled)",
      report(all.map((t) => (t.projectName === "edge" ? { ...t, status: "flaky" } : t))),
      /edge: 1 test/,
    ],
    [
      "an extra project the wOS config did not define",
      report([...all, { projectName: "chromium-no-js", status: "expected" }]),
      /unexpected project/,
    ],
    ["a report that is not Playwright's", { stats: {} }, /not a Playwright JSON report/],
  ])("the CI runner fails %s", (_, r, message) => {
    const check = checkPlaywrightReport(r, [...MINIMUM_BROWSERS]);
    expect(check.ok).toBe(false);
    expect(check.problems.join("; ")).toMatch(message);
  });
});

// ---- a native ABU claimed from Linux ------------------------------------------------------------------
describe("D13 / S-34: a native ABU needs a macOS toolchain; a JS-only mobile ABU does not", () => {
  const requirementsFor = (path: string) => template.toolchainRequirements.filter((r) => picomatch(r.paths, { dot: true })(path));

  it.each([
    ["apps/mobile/ios/App/AppDelegate.swift", "ios-native"],
    ["modules/calls/native/ios/CallKitBridge.swift", "ios-native"],
    ["apps/mobile/app.config.ts", "expo-native-config"],
    ["apps/mobile/plugins/with-callkit.js", "expo-native-config"],
  ])("the product template requires macOS for %s (%s)", (path, id) => {
    const reqs = requirementsFor(path);
    expect(reqs.map((r) => r.id)).toContain(id);
    for (const r of reqs.filter((x) => x.id === id)) expect(r.os).toEqual(["macos"]);
  });
  it("android native code needs the Android SDK on any OS", () => {
    const [r] = requirementsFor("apps/mobile/android/app/src/main/AndroidManifest.xml");
    expect(r?.id).toBe("android-native");
    expect(r?.os).toContain("linux");
    expect(r?.tools.map((t) => t.name)).toContain("android-sdk");
  });
  it.each(["apps/mobile/src/screens/Contacts.tsx", "modules/contacts/api.ts", "apps/web/src/app/page.tsx"])(
    "JS/TS-only %s needs no native toolchain",
    (path) => {
      expect(requirementsFor(path)).toEqual([]);
    },
  );
  it("an attestation is only os, version and tools: it cannot claim a CI result or a signature (S-34)", () => {
    const linux = { os: "linux", osVersion: "Ubuntu 24.04", tools: [{ name: "node", version: "22.12.0" }], checkedAt: iso(0) };
    expect(ToolchainAttestation.safeParse(linux).success).toBe(true);
    expect(ToolchainAttestation.safeParse({ ...linux, os: "ios" }).success).toBe(false);
    expect(ToolchainAttestation.safeParse({ ...linux, tools: [{ name: "xcode-but-trust-me", version: "99" }] }).success).toBe(false);
  });

  // context-policy's toolchain step (AGENT-POLICY.md "Toolchain eligibility (D13)"), fed the real input fields.
  it("the toolchain step exists in the policy engine", () => {
    expect(ELIGIBILITY_REASONS as readonly string[]).toContain("TOOLCHAIN_UNSATISFIED");
  });
  const linuxDevice = ToolchainAttestation.parse({
    os: "linux",
    osVersion: "Ubuntu 24.04",
    tools: [{ name: "node", version: "22.12.0" }],
    checkedAt: iso(0),
  });
  it("a Linux device is not eligible for a builder claim on an ABU under apps/mobile/ios/**", () => {
    const r = checkEligibility({
      ...builderInput(["astra"]),
      toolchain: { writeScopes: ["apps/mobile/ios/**"], requirements: template.toolchainRequirements, attestation: linuxDevice },
    });
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reasons.join(" ")).toMatch(/TOOLCHAIN_UNSATISFIED: ios-native/);
  });
  it.each(["apps/mobile/src/**", "modules/contacts/src/**", "apps/web/**"])(
    "the same Linux device is eligible for a JS-only ABU scoped %s",
    (scope) => {
      const r = checkEligibility({
        ...builderInput(["astra"]),
        toolchain: { writeScopes: [scope], requirements: template.toolchainRequirements, attestation: linuxDevice },
      });
      expect(r.eligible, JSON.stringify(r)).toBe(true);
    },
  );
});

// ---- D15: Sol builds, never reviews -----------------------------------------------------------------
const codex = (models: string[]): ProviderAttestation => ({
  provider: "codex_cli",
  installed: true,
  cliVersion: "9.9.9",
  signedIn: true,
  authMethod: "chatgpt",
  models: models as ProviderAttestation["models"],
  checkedAt: iso(0),
});
function builderInput(models: string[], role: EligibilityInput["role"] = "builder"): EligibilityInput {
  return {
    now: iso(0),
    role,
    attestations: [codex(models)],
    subjectAuthorIds: ["author"],
    otherSlotReviewerId: null,
    reviewsOfSameAuthorLast7d: 0,
    activeLeasesOfKind: 0,
    bootstrapMode: false,
    taskOpenHours: 0,
    account: { id: "me", githubAccountCreatedAt: iso(400 * DAY), acceptedContributions: 5, isMaintainer: false, suspended: false },
    // Builder facts (4.2.0 / D13): no build leases held, a JS-only scope, no native requirement in play.
    ...(role === "builder"
      ? { activeBuildLeasesByProvider: {}, toolchain: { writeScopes: ["modules/contacts/src/**"], requirements: [], attestation: null } }
      : {}),
  };
}

describe("D15: a Sol builder can never take a reviewer slot or rule", () => {
  it("no reviewer or resolver role lists Sol in the policy data", () => {
    for (const role of AGENT_POLICY.roles.filter((r) => r.reviewerSlot || r.role === "conflict_resolver")) {
      expect(role.allowedModels, role.role).not.toContain("sol");
    }
    expect(AGENT_POLICY.roles.find((r) => r.role === "builder")?.allowedModels).toContain("sol");
  });
  it.each(["implementation_reviewer_astra", "roadmap_reviewer_astra", "feature_reviewer_astra"] as const)(
    "a contributor attesting only Sol is not eligible for %s",
    (role) => {
      const r = checkEligibility(builderInput(["sol"], role));
      expect(r.eligible).toBe(false);
    },
  );
  it("positive control: the same Sol-only contributor is eligible to BUILD, on Sol", () => {
    const r = checkEligibility(builderInput(["sol"]));
    expect(r.eligible, JSON.stringify(r)).toBe(true);
    if (r.eligible) expect(r.model.ref).toBe("sol");
  });
});

// ---- S-36: no vendor trade dress ---------------------------------------------------------------------
describe("S-36: every roadmap, contract and implementation reviewer treats vendor trade dress as material", () => {
  const reviewers = AGENT_POLICY.roles.filter((r) => r.reviewerSlot);
  it("covers all six reviewer roles", () => expect(reviewers).toHaveLength(6));
  it.each(reviewers.map((r) => [r.role]))("%s has a trade-dress material finding rule", (role) => {
    const r = AGENT_POLICY.roles.find((x) => x.role === role)!;
    expect(r.materialFindingRules.some((x) => /trade dress/i.test(x) && /logo|icon|visual/i.test(x))).toBe(true);
  });
});
