import { AGENT_POLICY_V1, type AgentRole, type ProviderAttestation } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { checkEligibility, compareVersions, type EligibilityInput, parseVersion, resolveReasoning } from "../src/index.js";

const policy = AGENT_POLICY_V1;
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
