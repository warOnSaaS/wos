import { AGENT_POLICY, type AgentRole, type ProviderAttestation, type ToolchainAttestation } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  compareVersions,
  effectiveBudget,
  eligibilityRouteError,
  type EligibilityInput,
  parseToolVersion,
  parseVersion,
  resolveReasoning,
  scopeCanTouchGlob,
} from "../src/index.js";

const policy = AGENT_POLICY;
// Fixture times are relative to one fixed instant passed as `now` (D7: never pin dates that pass "now").
const NOW = "2026-10-01T12:00:00Z";
const daysBefore = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const ME = "0190f000-0000-7000-8000-00000000000a";
const OTHER = "0190f000-0000-7000-8000-00000000000b";

const claudeOk: ProviderAttestation = {
  provider: "claude_cli",
  installed: true,
  cliVersion: "2.1.284 (Claude Code)",
  signedIn: true,
  authMethod: "claude.ai",
  models: ["fable", "opus"],
  checkedAt: daysBefore(0),
};
const codexOk: ProviderAttestation = {
  provider: "codex_cli",
  installed: true,
  cliVersion: "codex-cli 0.155.0",
  signedIn: true,
  authMethod: "chatgpt",
  models: ["astra"],
  checkedAt: daysBefore(0),
};

function input(
  role: AgentRole,
  over: Partial<EligibilityInput> = {},
  account: Partial<EligibilityInput["account"]> = {},
): EligibilityInput {
  return {
    role,
    account: {
      id: ME,
      githubAccountCreatedAt: daysBefore(365),
      acceptedContributions: 5,
      isMaintainer: false,
      suspended: false,
      ...account,
    },
    attestations: [claudeOk, codexOk],
    subjectAuthorIds: [OTHER],
    otherSlotReviewerId: null,
    reviewsOfSameAuthorLast7d: 0,
    activeLeasesOfKind: 0,
    bootstrapMode: false,
    taskOpenHours: 0,
    now: NOW,
    // Builder facts (D13, D15): no leases held, a scope with no toolchain requirement.
    ...(role === "builder"
      ? { activeBuildLeasesByProvider: {}, toolchain: { writeScopes: ["modules/contacts/src/**"], requirements: [], attestation: null } }
      : {}),
    ...over,
  };
}

const codes = (r: ReturnType<typeof checkEligibility>) => (r.eligible ? [] : r.reasons.map((x) => x.split(":")[0]));

type Row = {
  name: string;
  role: AgentRole;
  over?: Partial<EligibilityInput>;
  account?: Partial<EligibilityInput["account"]>;
  expect: { eligible: true; independence: string; model: string; reasoning: string } | { eligible: false; codes: string[] };
};

const rows: Row[] = [
  // Happy paths, one per model family.
  {
    name: "independent Fable reviewer",
    role: "roadmap_reviewer_fable",
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "independent Astra reviewer resolves max, never ultra",
    role: "implementation_reviewer_astra",
    expect: { eligible: true, independence: "independent", model: "astra", reasoning: "max" },
  },
  {
    name: "builder runs Opus at its high floor",
    role: "builder",
    expect: { eligible: true, independence: "independent", model: "opus", reasoning: "high" },
  },
  {
    name: "roadmap author prefers Fable",
    role: "roadmap_author",
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  // Step 1 and 2.
  { name: "suspended account", role: "builder", account: { suspended: true }, expect: { eligible: false, codes: ["ACCOUNT_SUSPENDED"] } },
  // Step 3: GitHub age threshold at the boundary.
  {
    name: "GitHub account 89 days old",
    role: "builder",
    account: { githubAccountCreatedAt: daysBefore(89) },
    expect: { eligible: false, codes: ["GITHUB_ACCOUNT_TOO_NEW"] },
  },
  {
    name: "GitHub account exactly 90 days old",
    role: "builder",
    account: { githubAccountCreatedAt: daysBefore(90) },
    expect: { eligible: true, independence: "independent", model: "opus", reasoning: "high" },
  },
  {
    name: "no clock passed fails closed",
    role: "builder",
    over: { now: undefined as unknown as string },
    expect: { eligible: false, codes: ["CLOCK_REQUIRED"] },
  },
  {
    name: "no clock fails closed even for an exempt maintainer",
    role: "roadmap_reviewer_fable",
    over: { now: "" },
    account: { isMaintainer: true },
    expect: { eligible: false, codes: ["CLOCK_REQUIRED"] },
  },
  {
    name: "maintainer exempt from GitHub age",
    role: "builder",
    account: { isMaintainer: true, githubAccountCreatedAt: daysBefore(1) },
    expect: { eligible: true, independence: "independent", model: "opus", reasoning: "high" },
  },
  // Step 3: accepted contributions.
  {
    name: "reviewer with 0 accepted contributions",
    role: "feature_reviewer_fable",
    account: { acceptedContributions: 0 },
    expect: { eligible: false, codes: ["NOT_ENOUGH_ACCEPTED_CONTRIBUTIONS"] },
  },
  {
    name: "reviewer with exactly 1 accepted contribution",
    role: "feature_reviewer_fable",
    account: { acceptedContributions: 1 },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "resolver with 2 accepted contributions",
    role: "conflict_resolver",
    account: { acceptedContributions: 2 },
    expect: { eligible: false, codes: ["NOT_ENOUGH_ACCEPTED_CONTRIBUTIONS"] },
  },
  {
    name: "resolver with 3 accepted contributions",
    role: "conflict_resolver",
    account: { acceptedContributions: 3 },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "bootstrap waives contributions for non-maintainers",
    role: "roadmap_reviewer_astra",
    over: { bootstrapMode: true },
    account: { acceptedContributions: 0 },
    expect: { eligible: true, independence: "independent", model: "astra", reasoning: "max" },
  },
  {
    name: "maintainer exempt from contributions outside bootstrap",
    role: "conflict_resolver",
    account: { isMaintainer: true, acceptedContributions: 0 },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  // Step 4: lease limits (2 build, 2 review); authors have none.
  {
    name: "third concurrent build lease",
    role: "builder",
    over: { activeLeasesOfKind: 2 },
    expect: { eligible: false, codes: ["TOO_MANY_ACTIVE_LEASES"] },
  },
  {
    name: "second concurrent build lease",
    role: "builder",
    over: { activeLeasesOfKind: 1 },
    expect: { eligible: true, independence: "independent", model: "opus", reasoning: "high" },
  },
  {
    name: "author family: second concurrent author lease refused (limit 1)",
    role: "roadmap_author",
    over: { activeLeasesOfKind: 1 },
    expect: { eligible: false, codes: ["TOO_MANY_ACTIVE_LEASES"] },
  },
  {
    name: "author family: feature author with no other author lease",
    role: "feature_author",
    over: { activeLeasesOfKind: 0 },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "author family: resolver counts in the author family",
    role: "conflict_resolver",
    over: { activeLeasesOfKind: 1 },
    expect: { eligible: false, codes: ["TOO_MANY_ACTIVE_LEASES"] },
  },
  {
    name: "third concurrent review lease",
    role: "roadmap_reviewer_fable",
    over: { activeLeasesOfKind: 2 },
    expect: { eligible: false, codes: ["TOO_MANY_ACTIVE_LEASES"] },
  },
  // Step 5: model choice from attestations.
  {
    name: "Astra slot without codex",
    role: "feature_reviewer_astra",
    over: { attestations: [claudeOk] },
    expect: { eligible: false, codes: ["NO_ATTESTED_MODEL"] },
  },
  {
    name: "codex not signed in",
    role: "feature_reviewer_astra",
    over: { attestations: [claudeOk, { ...codexOk, signedIn: false }] },
    expect: { eligible: false, codes: ["NO_ATTESTED_MODEL"] },
  },
  {
    name: "codex below minVersion",
    role: "feature_reviewer_astra",
    over: { attestations: [{ ...codexOk, cliVersion: "codex-cli 0.154.9" }] },
    expect: { eligible: false, codes: ["NO_ATTESTED_MODEL"] },
  },
  {
    name: "claude not installed",
    role: "builder",
    over: { attestations: [{ ...claudeOk, installed: false, cliVersion: null }] },
    expect: { eligible: false, codes: ["NO_ATTESTED_MODEL"] },
  },
  {
    name: "author falls back to Opus when Fable is not attested",
    role: "feature_author",
    over: { attestations: [{ ...claudeOk, models: ["opus"] }] },
    expect: { eligible: true, independence: "independent", model: "opus", reasoning: "max" },
  },
  {
    name: "latest attestation wins (signed out since)",
    role: "builder",
    over: { attestations: [claudeOk, { ...claudeOk, signedIn: false, checkedAt: daysBefore(-0.01) }] },
    expect: { eligible: false, codes: ["NO_ATTESTED_MODEL"] },
  },
  // Step 7: independence.
  {
    name: "author of the subject may not review",
    role: "roadmap_reviewer_fable",
    over: { subjectAuthorIds: [ME] },
    expect: { eligible: false, codes: ["SUBJECT_AUTHOR"] },
  },
  {
    name: "builder of the attempt may not review it",
    role: "implementation_reviewer_astra",
    over: { subjectAuthorIds: [ME, OTHER] },
    expect: { eligible: false, codes: ["SUBJECT_AUTHOR"] },
  },
  {
    name: "the other slot's reviewer may not take this slot",
    role: "roadmap_reviewer_astra",
    over: { otherSlotReviewerId: ME },
    expect: { eligible: false, codes: ["SAME_REVIEWER_BOTH_SLOTS"] },
  },
  {
    name: "fifth review of the same author in 7 days",
    role: "roadmap_reviewer_fable",
    over: { reviewsOfSameAuthorLast7d: 4 },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "sixth review of the same author in 7 days (S-25)",
    role: "roadmap_reviewer_fable",
    over: { reviewsOfSameAuthorLast7d: 5 },
    expect: { eligible: false, codes: ["SAME_AUTHOR_REVIEW_LIMIT"] },
  },
  {
    name: "resolver has no same-author cap (0 = none)",
    role: "conflict_resolver",
    over: { reviewsOfSameAuthorLast7d: 50 },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "resolver who authored the subject",
    role: "conflict_resolver",
    over: { subjectAuthorIds: [ME] },
    expect: { eligible: false, codes: ["SUBJECT_AUTHOR"] },
  },
  {
    name: "excluded from the task (let a lease expire)",
    role: "roadmap_reviewer_fable",
    over: { excludedAccountIds: [ME] },
    expect: { eligible: false, codes: ["EXCLUDED_FROM_TASK"] },
  },
  {
    name: "task restricted to another account",
    role: "builder",
    over: { restrictedToAccountId: OTHER },
    expect: { eligible: false, codes: ["TASK_RESTRICTED_TO_OTHER_ACCOUNT"] },
  },
  {
    name: "task restricted to this account",
    role: "builder",
    over: { restrictedToAccountId: ME },
    expect: { eligible: true, independence: "independent", model: "opus", reasoning: "high" },
  },
  // Step 8: bootstrap labels.
  {
    name: "bootstrap: maintainer reviewing someone else's work",
    role: "roadmap_reviewer_fable",
    over: { bootstrapMode: true },
    account: { isMaintainer: true },
    expect: { eligible: true, independence: "bootstrap_maintainer", model: "fable", reasoning: "max" },
  },
  {
    name: "bootstrap: maintainer self-review before 24 h",
    role: "roadmap_reviewer_fable",
    over: { bootstrapMode: true, subjectAuthorIds: [ME], taskOpenHours: 23.9 },
    account: { isMaintainer: true },
    expect: { eligible: false, codes: ["BOOTSTRAP_SELF_REVIEW_TOO_EARLY"] },
  },
  {
    name: "bootstrap: maintainer self-review after 24 h",
    role: "roadmap_reviewer_fable",
    over: { bootstrapMode: true, subjectAuthorIds: [ME], taskOpenHours: 24 },
    account: { isMaintainer: true },
    expect: { eligible: true, independence: "bootstrap_self", model: "fable", reasoning: "max" },
  },
  {
    name: "bootstrap: solo founder takes the second slot too (both bootstrap_self)",
    role: "roadmap_reviewer_astra",
    over: { bootstrapMode: true, subjectAuthorIds: [ME], otherSlotReviewerId: ME, taskOpenHours: 30 },
    account: { isMaintainer: true },
    expect: { eligible: true, independence: "bootstrap_self", model: "astra", reasoning: "max" },
  },
  {
    name: "bootstrap: non-author maintainer still may not hold both slots",
    role: "roadmap_reviewer_astra",
    over: { bootstrapMode: true, otherSlotReviewerId: ME, taskOpenHours: 30 },
    account: { isMaintainer: true },
    expect: { eligible: false, codes: ["SAME_REVIEWER_BOTH_SLOTS"] },
  },
  {
    name: "bootstrap: non-maintainer author may never self-review",
    role: "roadmap_reviewer_fable",
    over: { bootstrapMode: true, subjectAuthorIds: [ME], taskOpenHours: 100 },
    expect: { eligible: false, codes: ["SUBJECT_AUTHOR"] },
  },
  {
    name: "bootstrap off: maintainer author may never self-review",
    role: "roadmap_reviewer_fable",
    over: { subjectAuthorIds: [ME], taskOpenHours: 100 },
    account: { isMaintainer: true },
    expect: { eligible: false, codes: ["SUBJECT_AUTHOR"] },
  },
  {
    name: "bootstrap: self-review beyond 5 a week is allowed (exemptSelfReviewFromSameAuthorCap)",
    role: "implementation_reviewer_fable",
    over: { bootstrapMode: true, subjectAuthorIds: [ME], taskOpenHours: 30, reviewsOfSameAuthorLast7d: 12 },
    account: { isMaintainer: true },
    expect: { eligible: true, independence: "bootstrap_self", model: "fable", reasoning: "max" },
  },
  {
    name: "bootstrap: a maintainer reviewing someone else is still capped",
    role: "implementation_reviewer_fable",
    over: { bootstrapMode: true, reviewsOfSameAuthorLast7d: 5 },
    account: { isMaintainer: true },
    expect: { eligible: false, codes: ["SAME_AUTHOR_REVIEW_LIMIT"] },
  },
  {
    name: "bootstrap: self-review before 24 h is not rescued by the cap exemption",
    role: "implementation_reviewer_fable",
    over: { bootstrapMode: true, subjectAuthorIds: [ME], taskOpenHours: 2, reviewsOfSameAuthorLast7d: 12 },
    account: { isMaintainer: true },
    expect: { eligible: false, codes: ["BOOTSTRAP_SELF_REVIEW_TOO_EARLY"] },
  },
  {
    name: "maintainer waiver: new GitHub account and zero contributions on a resolver",
    role: "conflict_resolver",
    account: { isMaintainer: true, acceptedContributions: 0, githubAccountCreatedAt: daysBefore(2) },
    expect: { eligible: true, independence: "independent", model: "fable", reasoning: "max" },
  },
  {
    name: "bootstrap waiver does not waive GitHub age for non-maintainers",
    role: "roadmap_reviewer_astra",
    over: { bootstrapMode: true },
    account: { acceptedContributions: 0, githubAccountCreatedAt: daysBefore(10) },
    expect: { eligible: false, codes: ["GITHUB_ACCOUNT_TOO_NEW"] },
  },
  {
    name: "bootstrap: non-maintainer independent reviewer stays independent",
    role: "feature_reviewer_astra",
    over: { bootstrapMode: true },
    expect: { eligible: true, independence: "independent", model: "astra", reasoning: "max" },
  },
  // Reasons accumulate.
  {
    name: "every failing step is reported",
    role: "roadmap_reviewer_fable",
    over: { subjectAuthorIds: [ME], activeLeasesOfKind: 3, attestations: [] },
    account: { suspended: true, acceptedContributions: 0, githubAccountCreatedAt: daysBefore(3) },
    expect: {
      eligible: false,
      codes: [
        "ACCOUNT_SUSPENDED",
        "GITHUB_ACCOUNT_TOO_NEW",
        "NOT_ENOUGH_ACCEPTED_CONTRIBUTIONS",
        "TOO_MANY_ACTIVE_LEASES",
        "NO_ATTESTED_MODEL",
        "SUBJECT_AUTHOR",
      ],
    },
  },
];

describe("agent-policy checkEligibility table (AGENT-POLICY.md section 5)", () => {
  for (const row of rows) {
    it(`agent-policy eligibility: ${row.name}`, () => {
      const result = checkEligibility(input(row.role, row.over, row.account));
      if (row.expect.eligible) {
        expect(result, JSON.stringify(result)).toMatchObject({
          eligible: true,
          independence: row.expect.independence,
          reasoning: row.expect.reasoning,
        });
        expect(result.eligible && result.model.ref).toBe(row.expect.model);
      } else {
        expect(codes(result)).toEqual(row.expect.codes);
      }
    });
  }

  it("never resolves ultra for any role and model", () => {
    for (const role of policy.roles) {
      for (const ref of role.allowedModels) {
        const model = policy.models.find((m) => m.ref === ref)!;
        expect(resolveReasoning(role, model)).not.toBe("ultra");
      }
    }
  });

  it("parses CLI version strings", () => {
    expect(parseVersion("2.1.284 (Claude Code)")).toEqual([2, 1, 284]);
    expect(parseVersion("codex-cli 0.155.0")).toEqual([0, 155, 0]);
    expect(parseVersion("unknown")).toBeNull();
    expect(compareVersions([0, 155, 0], [0, 99, 9])).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// D15 (contracts 4.1.0): per-provider build leases, a claimed model, effective budgets.
// ---------------------------------------------------------------------------------------------

const codexBoth: ProviderAttestation = { ...codexOk, models: ["astra", "sol"] };

describe("agent-policy checkEligibility: two agents per contributor (D15)", () => {
  const builder = (over: Partial<EligibilityInput>) => checkEligibility(input("builder", { attestations: [claudeOk, codexBoth], ...over }));

  it("agent-policy eligibility: with no claim the first attested allowed model is chosen (Opus)", () => {
    expect(builder({})).toMatchObject({ eligible: true, model: { ref: "opus" }, reasoning: "high" });
  });

  it("agent-policy eligibility: one Opus build lease held and no model named -> LIMIT_REACHED, never a silent switch to Astra", () => {
    const r = builder({ activeLeasesOfKind: 1, activeBuildLeasesByProvider: { claude_cli: 1 } });
    expect(codes(r)).toEqual(["PROVIDER_LEASE_LIMIT"]);
    expect(eligibilityRouteError(r)).toBe("LIMIT_REACHED");
    const named = builder({ requestedModel: "astra", activeLeasesOfKind: 1, activeBuildLeasesByProvider: { claude_cli: 1 } });
    expect(named).toMatchObject({ eligible: true, model: { ref: "astra", provider: "codex_cli" }, reasoning: "high" });
  });

  it("agent-policy eligibility: claimed Sol builder is honoured", () => {
    expect(builder({ requestedModel: "sol" })).toMatchObject({ eligible: true, model: { ref: "sol", modelId: "gpt-6-sol" } });
  });

  it("agent-policy eligibility: claimed model on a provider already at its build-lease limit is refused", () => {
    const r = builder({ requestedModel: "astra", activeLeasesOfKind: 1, activeBuildLeasesByProvider: { codex_cli: 1 } });
    expect(codes(r)).toEqual(["PROVIDER_LEASE_LIMIT"]);
  });

  it("agent-policy eligibility: both providers busy is refused, and the per-contributor total still applies", () => {
    expect(
      codes(builder({ activeLeasesOfKind: 1, activeBuildLeasesByProvider: { claude_cli: 1, codex_cli: 0 }, attestations: [claudeOk] })),
    ).toEqual(["PROVIDER_LEASE_LIMIT"]);
    expect(codes(builder({ activeLeasesOfKind: 2, activeBuildLeasesByProvider: { claude_cli: 1, codex_cli: 1 } }))).toEqual([
      "TOO_MANY_ACTIVE_LEASES",
      "PROVIDER_LEASE_LIMIT",
    ]);
  });

  it("agent-policy eligibility: a claimed model the role does not allow, or the device does not attest, is refused", () => {
    expect(codes(builder({ requestedModel: "fable" }))).toEqual(["REQUESTED_MODEL_NOT_ALLOWED"]);
    expect(codes(builder({ requestedModel: "sol", attestations: [claudeOk, codexOk] }))).toEqual(["REQUESTED_MODEL_NOT_ATTESTED"]);
    expect(codes(checkEligibility(input("implementation_reviewer_fable", { requestedModel: "sol" })))).toEqual([
      "REQUESTED_MODEL_NOT_ALLOWED",
    ]);
    expect(codes(checkEligibility(input("conflict_resolver", { requestedModel: "astra" })))).toEqual(["REQUESTED_MODEL_NOT_ALLOWED"]);
  });

  it("agent-policy eligibility: an Astra author gets the Astra budget override", () => {
    const r = checkEligibility(input("roadmap_author", { requestedModel: "astra" }));
    expect(r).toMatchObject({ eligible: true, model: { ref: "astra" }, reasoning: "max" });
    const role = (x: string) => policy.roles.find((y) => y.role === x)!;
    expect(effectiveBudget(role("roadmap_author"), "astra").contextBudgetTokens).toBe(140_000);
    expect(effectiveBudget(role("roadmap_author"), "fable").contextBudgetTokens).toBe(350_000);
    expect(effectiveBudget(role("builder"), "sol")).toEqual({ contextBudgetTokens: 120_000, workingReserveTokens: 130_000 });
  });

  it("agent-policy eligibility: a builder evaluated without per-provider lease facts fails closed", () => {
    expect(codes(builder({ activeBuildLeasesByProvider: undefined }))).toEqual(["LEASE_FACTS_REQUIRED"]);
  });

  it("agent-policy eligibility: every effective budget plus reserve fits its model's window", () => {
    for (const role of policy.roles) {
      for (const ref of role.allowedModels) {
        const m = policy.models.find((x) => x.ref === ref)!;
        const o = role.budgetOverrides.find((x) => x.model === ref);
        const total = (o?.contextBudgetTokens ?? role.contextBudgetTokens) + (o?.workingReserveTokens ?? role.workingReserveTokens);
        expect(total, `${role.role}/${ref}`).toBeLessThanOrEqual(m.contextWindowTokens);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// D13: toolchain eligibility (AGENT-POLICY.md "Toolchain eligibility").
// ---------------------------------------------------------------------------------------------

const REQUIREMENTS = [
  {
    id: "ios-native",
    paths: ["apps/mobile/ios/**", "apps/mobile/app.config.*", "apps/mobile/plugins/**", "modules/*/native/ios/**"],
    os: ["macos" as const],
    tools: [
      { name: "xcode" as const, minVersion: "16.0" },
      { name: "node" as const, minVersion: "22.12.0" },
    ],
  },
  {
    id: "android-native",
    paths: ["apps/mobile/android/**"],
    os: ["macos" as const, "linux" as const],
    tools: [{ name: "android-sdk" as const, minVersion: "35" }],
  },
];
const mac = (xcode: string | null): ToolchainAttestation => ({
  os: "macos",
  osVersion: "15.4",
  tools: [...(xcode ? [{ name: "xcode" as const, version: xcode }] : []), { name: "node" as const, version: "v22.12.0" }],
  checkedAt: daysBefore(0),
});
const linux: ToolchainAttestation = {
  os: "linux",
  osVersion: "Ubuntu 24.04",
  tools: [
    { name: "node", version: "v22.12.0" },
    { name: "android-sdk", version: "35.0.0" },
  ],
  checkedAt: daysBefore(0),
};

describe("agent-policy checkEligibility: toolchain (D13)", () => {
  const claim = (writeScopes: string[], attestation: ToolchainAttestation | null) =>
    checkEligibility(input("builder", { toolchain: { writeScopes, requirements: REQUIREMENTS, attestation } }));

  it("agent-policy eligibility: native iOS ABU on macOS with Xcode 16.2 is eligible", () => {
    expect(claim(["apps/mobile/ios/**"], mac("Xcode 16.2\nBuild version 16C5032a"))).toMatchObject({
      eligible: true,
      model: { ref: "opus" },
    });
  });

  it("agent-policy eligibility: native iOS ABU on macOS without Xcode is refused with the requirement id", () => {
    const r = claim(["apps/mobile/ios/**"], mac(null));
    expect(codes(r)).toEqual(["TOOLCHAIN_UNSATISFIED"]);
    expect(!r.eligible && r.reasons[0]).toMatch(/ios-native: xcode >= 16.0 is missing/);
  });

  it("agent-policy eligibility: native iOS ABU with Xcode 15.4 (too old) is refused", () => {
    const r = claim(["apps/mobile/ios/**"], mac("Xcode 15.4"));
    expect(!r.eligible && r.reasons).toEqual(["TOOLCHAIN_UNSATISFIED: ios-native: xcode Xcode 15.4 is older than 16.0"]);
  });

  it("agent-policy eligibility: native iOS ABU on Linux is refused (os and tool)", () => {
    const r = claim(["apps/mobile/ios/**"], linux);
    expect(codes(r)).toEqual(["TOOLCHAIN_UNSATISFIED", "TOOLCHAIN_UNSATISFIED"]);
    expect(!r.eligible && r.reasons[0]).toMatch(/ios-native: needs macos, device is linux/);
  });

  it("agent-policy eligibility: a config-plugin edit counts as native", () => {
    expect(codes(claim(["apps/mobile/app.config.ts"], linux))[0]).toBe("TOOLCHAIN_UNSATISFIED");
    expect(codes(claim(["apps/mobile/plugins/**"], linux))[0]).toBe("TOOLCHAIN_UNSATISFIED");
  });

  it("agent-policy eligibility: a JS-only mobile ABU is eligible on Linux", () => {
    expect(claim(["apps/mobile/src/**", "modules/contacts/mobile/**"], linux)).toMatchObject({ eligible: true });
    expect(claim(["apps/mobile/src/screens/Contacts.tsx"], linux)).toMatchObject({ eligible: true });
  });

  it("agent-policy eligibility: an Android native ABU is eligible on Linux with the SDK, refused without it", () => {
    expect(claim(["apps/mobile/android/**"], linux)).toMatchObject({ eligible: true });
    expect(codes(claim(["apps/mobile/android/**"], mac("Xcode 16.2")))).toEqual(["TOOLCHAIN_UNSATISFIED"]);
  });

  it("agent-policy eligibility: a broad scope that can reach native paths needs the toolchain", () => {
    expect(codes(claim(["apps/mobile/**"], linux))[0]).toBe("TOOLCHAIN_UNSATISFIED");
  });

  it("agent-policy eligibility: a native ABU on a device with no toolchain attestation is refused; no facts at all fails closed", () => {
    expect(codes(claim(["apps/mobile/ios/**"], null))).toEqual(["TOOLCHAIN_UNSATISFIED"]);
    expect(codes(checkEligibility(input("builder", { toolchain: undefined })))).toEqual(["TOOLCHAIN_FACTS_REQUIRED"]);
  });

  it("agent-policy eligibility: reviewers need no toolchain", () => {
    expect(checkEligibility(input("implementation_reviewer_fable"))).toMatchObject({ eligible: true });
  });

  it("scope/glob intersection and tool versions", () => {
    expect(scopeCanTouchGlob("apps/mobile/src/**", "apps/mobile/ios/**")).toBe(false);
    expect(scopeCanTouchGlob("apps/mobile/src/**", "apps/mobile/app.config.*")).toBe(false);
    expect(scopeCanTouchGlob("apps/mobile/**", "apps/mobile/app.config.*")).toBe(true);
    expect(scopeCanTouchGlob("modules/contacts/**", "modules/*/native/ios/**")).toBe(true);
    expect(scopeCanTouchGlob("modules/contacts/src/**", "modules/*/native/ios/**")).toBe(false);
    expect(scopeCanTouchGlob("apps/web/**", "**/*.podspec")).toBe(true);
    expect(parseToolVersion("Xcode 16.2\nBuild version 16C5032a")).toEqual([16, 2, 0]);
    expect(parseToolVersion("v22.12.0")).toEqual([22, 12, 0]);
    expect(parseToolVersion("35")).toEqual([35, 0, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
// B-0010-github-build (contracts 4.3.0): the claim body's requested model.
// ---------------------------------------------------------------------------------------------

type ModelRow = {
  name: string;
  role: AgentRole;
  over: Partial<EligibilityInput>;
  expect: { model: string } | { codes: string[]; error: "NOT_ELIGIBLE" | "LIMIT_REACHED" };
};
const both: ProviderAttestation = { ...codexOk, models: ["astra", "sol"] };
const codexHeld = { activeLeasesOfKind: 1, activeBuildLeasesByProvider: { codex_cli: 1 } };
const modelRows: ModelRow[] = [
  { name: "omitted: builder first-fit is Opus", role: "builder", over: {}, expect: { model: "opus" } },
  { name: "omitted: author first-fit is Fable", role: "feature_author", over: {}, expect: { model: "fable" } },
  { name: "opus requested for a builder", role: "builder", over: { requestedModel: "opus" }, expect: { model: "opus" } },
  { name: "astra requested for a builder", role: "builder", over: { requestedModel: "astra" }, expect: { model: "astra" } },
  { name: "sol requested for a builder", role: "builder", over: { requestedModel: "sol" }, expect: { model: "sol" } },
  { name: "astra requested for an author", role: "roadmap_author", over: { requestedModel: "astra" }, expect: { model: "astra" } },
  {
    name: "fable requested for its reviewer slot",
    role: "roadmap_reviewer_fable",
    over: { requestedModel: "fable" },
    expect: { model: "fable" },
  },
  {
    name: "fable requested for a builder",
    role: "builder",
    over: { requestedModel: "fable" },
    expect: { codes: ["REQUESTED_MODEL_NOT_ALLOWED"], error: "NOT_ELIGIBLE" },
  },
  {
    name: "sol requested for an author",
    role: "feature_author",
    over: { requestedModel: "sol" },
    expect: { codes: ["REQUESTED_MODEL_NOT_ALLOWED"], error: "NOT_ELIGIBLE" },
  },
  {
    name: "astra requested for the Fable slot",
    role: "feature_reviewer_fable",
    over: { requestedModel: "astra" },
    expect: { codes: ["REQUESTED_MODEL_NOT_ALLOWED"], error: "NOT_ELIGIBLE" },
  },
  {
    name: "sol requested for the resolver",
    role: "conflict_resolver",
    over: { requestedModel: "sol" },
    expect: { codes: ["REQUESTED_MODEL_NOT_ALLOWED"], error: "NOT_ELIGIBLE" },
  },
  {
    name: "sol requested, device attests only astra",
    role: "builder",
    over: { requestedModel: "sol", attestations: [claudeOk, codexOk] },
    expect: { codes: ["REQUESTED_MODEL_NOT_ATTESTED"], error: "NOT_ELIGIBLE" },
  },
  {
    name: "astra requested, codex signed out",
    role: "builder",
    over: { requestedModel: "astra", attestations: [claudeOk, { ...both, signedIn: false }] },
    expect: { codes: ["REQUESTED_MODEL_NOT_ATTESTED"], error: "NOT_ELIGIBLE" },
  },
  {
    name: "astra requested, codex build lease already held",
    role: "builder",
    over: { requestedModel: "astra", ...codexHeld },
    expect: { codes: ["PROVIDER_LEASE_LIMIT"], error: "LIMIT_REACHED" },
  },
  {
    name: "sol requested while astra holds the codex slot",
    role: "builder",
    over: { requestedModel: "sol", ...codexHeld },
    expect: { codes: ["PROVIDER_LEASE_LIMIT"], error: "LIMIT_REACHED" },
  },
  {
    name: "opus requested while an astra build runs",
    role: "builder",
    over: { requestedModel: "opus", ...codexHeld },
    expect: { model: "opus" },
  },
];

describe("agent-policy checkEligibility: requestedModel (contracts 4.3.0, B-0010-github-build)", () => {
  for (const row of modelRows) {
    it(`agent-policy requestedModel: ${row.name}`, () => {
      const r = checkEligibility(input(row.role, { attestations: [claudeOk, both], ...row.over }));
      if ("model" in row.expect) {
        expect(r, JSON.stringify(r)).toMatchObject({ eligible: true, model: { ref: row.expect.model } });
        expect(eligibilityRouteError(r)).toBeNull();
      } else {
        expect(codes(r)).toEqual(row.expect.codes);
        expect(eligibilityRouteError(r)).toBe(row.expect.error);
      }
    });
  }
});
