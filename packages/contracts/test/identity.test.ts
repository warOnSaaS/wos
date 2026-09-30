/** Amendment 04 "Identity and organizations" (D65, contracts 5.12.0). */
import { describe, expect, it } from "vitest";
import {
  domainJoinOutcome,
  domainVerificationRecord,
  EnvironmentTokenClaims,
  effectiveGrants,
  emailDomain,
  findTransition,
  githubSignInFlowFor,
  IDENTITY_POLICY_V1,
  IdentityRoutes,
  isBlockedDomain,
  memberActionRefusals,
  OrgDomainMachine,
  OrgInviteMachine,
  OrgSsoConnection,
  quotaRefusal,
  resolveGithubSignIn,
  WosAppManifest,
} from "../src/index.js";

describe("sign in with GitHub: account resolution (never auto-merge)", () => {
  const accounts = new Map([
    ["ada@acme.test", { id: "acct-ada", suspended: false }],
    ["sus@acme.test", { id: "acct-sus", suspended: true }],
  ]);
  const base = {
    githubUserId: 7,
    linkedAccount: null,
    reservedBy: null,
    emails: [{ email: "new@acme.test", primary: true, verified: true }],
    accountByEmail: (e: string) => accounts.get(e) ?? null,
  };
  it("signs in to the linked account, whatever its email", () => {
    expect(resolveGithubSignIn({ ...base, linkedAccount: { id: "acct-x", suspended: false } })).toEqual({
      kind: "sign_in",
      accountId: "acct-x",
    });
  });
  it("refuses a reserved GitHub user and a suspended account", () => {
    expect(resolveGithubSignIn({ ...base, reservedBy: "acct-old" })).toEqual({ kind: "refuse", code: "GITHUB_RESERVED" });
    expect(resolveGithubSignIn({ ...base, linkedAccount: { id: "acct-x", suspended: true } })).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });
  it("asks for proof of the mailbox when a verified GitHub email belongs to an account (primary first)", () => {
    const r = resolveGithubSignIn({
      ...base,
      emails: [
        { email: "other@x.test", primary: false, verified: true },
        { email: " ADA@acme.test ", primary: true, verified: true },
      ],
    });
    expect(r).toEqual({ kind: "email_proof_required", accountId: "acct-ada", email: " ADA@acme.test " });
  });
  it("ignores unverified emails entirely", () => {
    expect(
      resolveGithubSignIn({
        ...base,
        emails: [
          { email: "ada@acme.test", primary: true, verified: false },
          { email: "fresh@x.test", primary: false, verified: true },
        ],
      }),
    ).toEqual({ kind: "create", email: "fresh@x.test" });
    expect(resolveGithubSignIn({ ...base, emails: [{ email: "ada@acme.test", primary: true, verified: false }] })).toEqual({
      kind: "refuse",
      code: "GITHUB_EMAIL_UNVERIFIED",
    });
  });
  it("creates an account with the primary verified email otherwise; web clients redirect, the others use the device flow", () => {
    expect(resolveGithubSignIn(base)).toEqual({ kind: "create", email: "new@acme.test" });
    expect(["web", "web_app", "desktop", "cli", "mobile"].map((k) => githubSignInFlowFor(k as never))).toEqual([
      "web",
      "web",
      "device",
      "device",
      "device",
    ]);
  });
});

describe("members", () => {
  const team = { kind: "team" as const, self: false, owners: 2 };
  it.each([
    ["an admin invites a member", { ...team, action: "invite", actor: "admin", target: "member" }, 0],
    ["an admin invites an owner", { ...team, action: "invite", actor: "admin", target: "owner" }, 1],
    ["a member invites", { ...team, action: "invite", actor: "member", target: "member" }, 1],
    ["an admin promotes a member to admin", { ...team, action: "change_role", actor: "admin", target: "member", to: "admin" }, 0],
    ["an admin promotes to owner", { ...team, action: "change_role", actor: "admin", target: "admin", to: "owner" }, 1],
    ["an admin removes an admin", { ...team, action: "remove", actor: "admin", target: "admin" }, 1],
    ["an owner removes an owner (two owners)", { ...team, action: "remove", actor: "owner", target: "owner" }, 0],
    ["the last owner leaves", { ...team, action: "leave", actor: "owner", target: "owner", self: true, owners: 1 }, 1],
    ["the last owner is demoted", { ...team, action: "change_role", actor: "owner", target: "owner", to: "admin", owners: 1 }, 1],
    ["a member leaves", { ...team, action: "leave", actor: "member", target: "member", self: true }, 0],
    ["anything in a personal organization", { ...team, kind: "personal", action: "invite", actor: "owner", target: "member" }, 1],
  ])("%s", (_n, x, refusals) => expect(memberActionRefusals(x as never)).toHaveLength(refusals as number));
  it("says LAST_OWNER for the last owner", () =>
    expect(memberActionRefusals({ ...team, action: "leave", actor: "owner", target: "owner", self: true, owners: 1 })[0]).toMatch(
      /^LAST_OWNER/,
    ));
});

describe("verified domains and join policy", () => {
  const domains = [
    { organizationId: "org-a", domain: "acme.test", state: "verified" as const, joinPolicy: "auto_join" as const },
    { organizationId: "org-b", domain: "acme.test", state: "pending" as const, joinPolicy: "auto_join" as const },
    { organizationId: "org-c", domain: "beta.test", state: "verified" as const, joinPolicy: "request" as const },
    { organizationId: "org-d", domain: "off.test", state: "verified" as const, joinPolicy: "off" as const },
  ];
  const none = new Set<string>();
  it("auto-joins on a verified domain only, never twice after leaving, never with an unverified email", () => {
    expect(domainJoinOutcome({ email: "ada@ACME.test", emailVerified: true, domains, memberOf: none, excludedFrom: none })).toEqual({
      autoJoin: ["org-a"],
      joinable: [],
    });
    expect(
      domainJoinOutcome({ email: "ada@acme.test", emailVerified: true, domains, memberOf: none, excludedFrom: new Set(["org-a"]) }),
    ).toEqual({
      autoJoin: [],
      joinable: ["org-a"],
    });
    expect(domainJoinOutcome({ email: "ada@acme.test", emailVerified: false, domains, memberOf: none, excludedFrom: none })).toEqual({
      autoJoin: [],
      joinable: [],
    });
    expect(
      domainJoinOutcome({ email: "ada@acme.test", emailVerified: true, domains, memberOf: new Set(["org-a"]), excludedFrom: none })
        .autoJoin,
    ).toEqual([]);
  });
  it("request makes the organization joinable; off and subdomains do nothing", () => {
    expect(domainJoinOutcome({ email: "bo@beta.test", emailVerified: true, domains, memberOf: none, excludedFrom: none })).toEqual({
      autoJoin: [],
      joinable: ["org-c"],
    });
    expect(domainJoinOutcome({ email: "x@off.test", emailVerified: true, domains, memberOf: none, excludedFrom: none })).toEqual({
      autoJoin: [],
      joinable: [],
    });
    expect(domainJoinOutcome({ email: "x@eu.acme.test", emailVerified: true, domains, memberOf: none, excludedFrom: none })).toEqual({
      autoJoin: [],
      joinable: [],
    });
  });
  it("blocks public email domains (and their subdomains) and names the TXT record", () => {
    const list = IDENTITY_POLICY_V1.domains.publicEmailDomains;
    expect(isBlockedDomain("gmail.com", list)).toBe(true);
    expect(isBlockedDomain("mail.proton.me", list)).toBe(true);
    expect(isBlockedDomain("acme.test", list)).toBe(false);
    expect(domainVerificationRecord("acme.test", "t0k")).toEqual({
      name: "_wos-verification.acme.test",
      value: "wos-domain-verification=t0k",
    });
    expect(emailDomain("ada@Acme.Test")).toBe("acme.test");
    expect(emailDomain("not an email")).toBeNull();
  });
});

describe("per-app permissions", () => {
  const manifest = WosAppManifest.parse({
    protocol: "wos-app/v1",
    app: { id: "crm", name: "wOS CRM", version: "0.1.0", kind: "app", billing: "addon", summary: "Accounts and pipelines." },
    requires: { wos: ">=0.1.0", apps: [] },
    surfaces: {
      web: { supported: true, entry: "./web" },
      desktop: { supported: false },
      ios: { supported: false },
      android: { supported: false },
      api: { supported: true },
    },
    data: { schema: "app_crm", migrations: null },
    permissions: [
      { key: "crm.deals.read", description: "Read deals", grantedTo: ["owner", "admin", "member"] },
      { key: "crm.deals.delete", description: "Delete deals", grantedTo: ["owner", "admin"] },
    ],
    events: {},
    routes: { ui: "/crm", api: "/apps/crm" },
    hosting: { selfHost: { supported: true }, hosted: { supported: true } },
  });
  it("starts from the manifest, applies overrides, ignores undeclared or foreign ones", () => {
    expect(effectiveGrants(manifest, [], "member")).toEqual(["crm.deals.read"]);
    const overrides = [
      { app: "crm", permission: "crm.deals.delete", role: "member" as const, granted: true },
      { app: "crm", permission: "crm.deals.delete", role: "admin" as const, granted: false },
      { app: "crm", permission: "crm.made.up", role: "member" as const, granted: true },
      { app: "chat", permission: "crm.deals.read", role: "member" as const, granted: false },
    ];
    expect(effectiveGrants(manifest, overrides, "member")).toEqual(["crm.deals.delete", "crm.deals.read"]);
    expect(effectiveGrants(manifest, overrides, "admin")).toEqual(["crm.deals.read"]);
  });
  it("travels to hosted Core in the optional permissions claim", () => {
    const claims = {
      iss: "https://api.waronsaas.com",
      aud: "0192f000-0000-7000-8000-00000000c10d",
      sub: "0192f000-0000-7000-8000-000000000001",
      org: "0192f000-0000-7000-8000-000000000002",
      role: "member",
      apps: ["core", "crm"],
      iat: 1,
      exp: 901,
    };
    expect(EnvironmentTokenClaims.safeParse(claims).success).toBe(true);
    expect(EnvironmentTokenClaims.safeParse({ ...claims, permissions: ["crm.deals.read"] }).success).toBe(true);
  });
});

describe("policy, machines, routes, dormant modules", () => {
  it("quotas are policy data on plan free", () => {
    expect(quotaRefusal(IDENTITY_POLICY_V1, "free", "membersPerOrg", 24)).toBeNull();
    expect(quotaRefusal(IDENTITY_POLICY_V1, "free", "membersPerOrg", 25)).toMatch(/^QUOTA_EXCEEDED/);
    expect(IDENTITY_POLICY_V1.plans.free.teamOrgsOwnedPerAccount).toBe(10);
  });
  it("SSO, SCIM and audit export are dormant until an enterprise pays", () => {
    for (const m of ["sso", "scim", "audit_export"] as const) {
      expect(IDENTITY_POLICY_V1.modules[m]!.status).toBe("dormant");
      expect(IDENTITY_POLICY_V1.modules[m]!.activatedBy).toBeNull();
    }
    for (const r of [IdentityRoutes.getSsoConnection, IdentityRoutes.createScimToken, IdentityRoutes.requestAuditExport])
      expect(r.errors).toContain("MODULE_DORMANT");
    expect(
      OrgSsoConnection.safeParse({
        id: "0192f000-0000-7000-8000-000000000003",
        organizationId: "0192f000-0000-7000-8000-000000000002",
        protocol: "oidc",
        domainIds: ["0192f000-0000-7000-8000-000000000004"],
        enforcement: "required",
        oidc: null,
        saml: null,
        maxSessionAgeHours: 12,
        state: "draft",
      }).success,
    ).toBe(false);
  });
  it("invites end once; a domain verifies, lapses and re-verifies", () => {
    expect(findTransition(OrgInviteMachine, "pending", "accept")?.to).toBe("accepted");
    expect(findTransition(OrgInviteMachine, "accepted", "revoke")).toBeUndefined();
    expect(findTransition(OrgDomainMachine, "verified", "lapse")?.to).toBe("lapsed");
    expect(findTransition(OrgDomainMachine, "lapsed", "reverify")?.to).toBe("verified");
  });
  it("routes: GitHub sign-in is public and bound by pollSecret; member routes are account-scoped", () => {
    expect(IdentityRoutes.startGithubSignIn.auth).toBe("public");
    expect(IdentityRoutes.pollGithubSignIn.body.shape.pollSecret).toBeDefined();
    expect(IdentityRoutes.leaveOrganization.errors).toContain("LAST_OWNER");
    expect(IdentityRoutes.respondToInvite.errors).toContain("INVITE_EMAIL_MISMATCH");
  });
});
