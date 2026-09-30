/** Amendment 04 addendum A and D66 (contracts 5.13.0): pinned domain lists, export, deletion, email change. */
import { describe, expect, it } from "vitest";
import {
  AccountDeletionMachine,
  accountDeletionRefusals,
  DISPOSABLE_EMAIL_DOMAINS,
  deletedContributorPseudonym,
  emailChangeComplete,
  findTransition,
  IDENTITY_POLICY_V1,
  IdentityRoutes,
  isBlockedDomain,
  isDisposableDomain,
  RETENTION_RULES,
} from "../src/index.js";

describe("D66: domain lists are pinned, never fetched live", () => {
  const set = new Set(DISPOSABLE_EMAIL_DOMAINS.domains);
  it("the disposable list is a pinned CC0 commit with its source hash", () => {
    expect(DISPOSABLE_EMAIL_DOMAINS.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(DISPOSABLE_EMAIL_DOMAINS.license).toBe("CC0-1.0");
    expect(DISPOSABLE_EMAIL_DOMAINS.domains.length).toBeGreaterThan(1000);
    expect(IDENTITY_POLICY_V1.lists).toEqual({
      disposable: { file: "disposable-email-domains.v1.json", refreshedBy: "reviewed_pr" },
      publicEmailProviders: { source: "curated", refreshedBy: "reviewed_pr" },
    });
  });
  it("flags disposable domains and their subdomains, never a public provider or a company", () => {
    expect(isDisposableDomain("mailinator.com", set)).toBe(true);
    expect(isDisposableDomain("x.mailinator.com", set)).toBe(true);
    expect(isDisposableDomain("gmail.com", set)).toBe(false);
    expect(isDisposableDomain("acme.test", set, ["acme.test"])).toBe(true);
    expect(isDisposableDomain("acme.example", set)).toBe(false);
    expect(isBlockedDomain("gmail.com", IDENTITY_POLICY_V1.domains.publicEmailDomains)).toBe(true);
  });
  it("SSO break-glass: a second owner, else a public maintainer AdminAction", () => {
    expect(IDENTITY_POLICY_V1.ssoBreakGlass).toEqual({
      rule: "email_code_and_second_owner",
      singleOwnerFallback: "maintainer_admin_action_public_label",
    });
  });
});

describe("addendum A: deletion, export, email change", () => {
  it("deletion is confirmed, waits 14 days, can be cancelled, and is blocked by what would orphan others", () => {
    expect(findTransition(AccountDeletionMachine, "requested", "confirm")?.to).toBe("scheduled");
    expect(findTransition(AccountDeletionMachine, "scheduled", "cancel")?.to).toBe("cancelled");
    expect(findTransition(AccountDeletionMachine, "scheduled", "complete")?.actor).toEqual(["system"]);
    expect(findTransition(AccountDeletionMachine, "completed", "cancel")).toBeUndefined();
    expect(accountDeletionRefusals({ soleOwnerOfTeamOrgsWithOtherMembers: 0, activeLeases: 0, maintainer: false })).toEqual([]);
    expect(accountDeletionRefusals({ soleOwnerOfTeamOrgsWithOtherMembers: 1, activeLeases: 2, maintainer: true })).toHaveLength(3);
  });
  it("keeps public ledger and contribution records under a pseudonym, deletes personal data", () => {
    expect(RETENTION_RULES.email.action).toBe("delete");
    expect(RETENTION_RULES.memberships.action).toBe("delete");
    expect(RETENTION_RULES.contributions.action).toBe("pseudonymise");
    expect(RETENTION_RULES.ledger_and_receipts.action).toBe("pseudonymise");
    expect(deletedContributorPseudonym("0123456789abcdef")).toBe("former-contributor-0123456789");
  });
  it("an email change needs the new address and one of the old address or the linked GitHub", () => {
    expect(emailChangeComplete({ newAddress: true, oldAddress: true, github: false })).toBe(true);
    expect(emailChangeComplete({ newAddress: true, oldAddress: false, github: true })).toBe(true);
    expect(emailChangeComplete({ newAddress: true, oldAddress: false, github: false })).toBe(false);
    expect(emailChangeComplete({ newAddress: false, oldAddress: true, github: true })).toBe(false);
    expect(IdentityRoutes.confirmEmailChange.path).toBe("/v1/me/email/:id/confirm");
    expect(IdentityRoutes.requestAccountDeletion.errors).toContain("DELETION_BLOCKED");
  });
});
