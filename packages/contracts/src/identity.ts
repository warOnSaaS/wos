/**
 * Amendment 04 "Identity and organizations" (D65, contracts 5.12.0). Prose: docs/AMENDMENT-04-IDENTITY-AND-ORGANIZATIONS.md.
 *
 * V1-active: GitHub sign-in (resolveGithubSignIn), invites, member management (memberActionRefusals), verified domains
 * and join policy (domainJoinOutcome), per-app permission overrides (effectiveGrants), rate limits and quotas
 * (IdentityPolicy, data/identity-policy.v1.json). DORMANT until an enterprise pays (D50): OrgSsoConnection, ScimToken,
 * AuditExportRequest, whose routes answer MODULE_DORMANT until a public AdminAction activates the module.
 *
 * Node-free: wOS Web, wOS Mobile and self-hosted Core import it.
 */
import { z } from "zod";
import { Timestamp, Uuid } from "./primitives.js";
import { AppId, OrgRole, PermissionKey, type WosAppManifest } from "./wos-app.js";

// ---------------------------------------------------------------------------------------------
// Sign in with GitHub (section 2)
// ---------------------------------------------------------------------------------------------

/** device: desktop, cli, mobile (the user enters a code at github.com). web: the site and wOS Web's server. */
export const GithubSignInFlow = z.enum(["device", "web"]);
export const SignInClientKind = z.enum(["web", "desktop", "cli", "web_app", "mobile"]);
export type SignInClientKind = z.infer<typeof SignInClientKind>;

/** The flow each client kind uses (web and web_app redirect; the others use the device flow). */
export const githubSignInFlowFor = (k: SignInClientKind): "device" | "web" => (k === "web" || k === "web_app" ? "web" : "device");

/** Where the web flow lands after the App's callback, on the client's own origin (S-5, S-43). */
export const GITHUB_SIGNIN_LANDING = { web: "/auth/github", web_app: "/sign-in/github" } as const;

export const GithubSignInStartBody = z.object({
  clientKind: SignInClientKind,
  deviceName: z.string().max(100).nullable(),
  /** desktop and cli only (C-5), as for email sign-in; null for web, web_app and mobile. */
  devicePublicKey: z.string().max(100).nullable(),
});
export const GithubSignInStartResponse = z.discriminatedUnion("flow", [
  z.object({
    flow: z.literal("device"),
    signInId: Uuid,
    pollSecret: z.string().min(32),
    userCode: z.string(),
    verificationUri: z.url(),
    intervalSeconds: z.number().int().positive(),
    expiresAt: Timestamp,
  }),
  /** web: pollSecret null (in the wos_signin cookie); web_app: in the body, sealed by wOS Web (S-43). */
  z.object({
    flow: z.literal("web"),
    signInId: Uuid,
    pollSecret: z.string().min(32).nullable(),
    authorizeUrl: z.url(),
    expiresAt: Timestamp,
  }),
]);

/** A verified GitHub email as GitHub reports it; unverified emails are dropped before anything else. */
export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * The account a GitHub sign-in resolves to (section 2), deterministic:
 *   linked -> sign in; reserved -> refuse; a verified email owned by an account -> email proof required (never merge);
 *   else create with the primary verified email; no verified email -> refuse.
 */
export type GithubSignInResolution =
  | { kind: "sign_in"; accountId: string }
  | { kind: "refuse"; code: "GITHUB_RESERVED" | "GITHUB_EMAIL_UNVERIFIED" | "ACCOUNT_SUSPENDED" }
  | { kind: "email_proof_required"; accountId: string; email: string }
  | { kind: "create"; email: string };

export function resolveGithubSignIn(x: {
  githubUserId: number;
  /** The account this GitHub user is linked to, if any, with its status. */
  linkedAccount: { id: string; suspended: boolean } | null;
  /** The account that reserved this GitHub user after unlinking it within 90 days, if any. */
  reservedBy: string | null;
  emails: readonly GithubEmail[];
  /** Existing accounts by normalized email. */
  accountByEmail: (normalized: string) => { id: string; suspended: boolean } | null;
}): GithubSignInResolution {
  if (x.linkedAccount)
    return x.linkedAccount.suspended ? { kind: "refuse", code: "ACCOUNT_SUSPENDED" } : { kind: "sign_in", accountId: x.linkedAccount.id };
  if (x.reservedBy) return { kind: "refuse", code: "GITHUB_RESERVED" };
  const verified = x.emails.filter((e) => e.verified).sort((a, b) => Number(b.primary) - Number(a.primary));
  if (verified.length === 0) return { kind: "refuse", code: "GITHUB_EMAIL_UNVERIFIED" };
  for (const e of verified) {
    const owner = x.accountByEmail(normalizeEmail(e.email));
    if (owner)
      return owner.suspended
        ? { kind: "refuse", code: "ACCOUNT_SUSPENDED" }
        : { kind: "email_proof_required", accountId: owner.id, email: e.email };
  }
  return { kind: "create", email: verified[0]!.email };
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
/** The domain of an email address, lowercased; null when it is not an address. */
export function emailDomain(email: string): string | null {
  const m = /^[^@\s]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec(email.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export const GithubSignInPollBody = z.object({
  signInId: Uuid,
  /** Every client but web sends it; web sends it in the wos_signin cookie. */
  pollSecret: z.string().nullable(),
  /** Only after `email_proof_required`: the code emailed to the matching account's address. */
  emailProofCode: z
    .string()
    .regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    .nullable(),
});

// ---------------------------------------------------------------------------------------------
// Invites and members (section 3)
// ---------------------------------------------------------------------------------------------

export const OrgInviteState = z.enum(["pending", "accepted", "declined", "revoked", "expired"]);
export const OrgInvite = z.object({
  id: Uuid,
  organizationId: Uuid,
  email: z.email(),
  role: OrgRole,
  invitedBy: Uuid,
  state: OrgInviteState,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  rowVersion: z.number().int().min(0),
});
export type OrgInvite = z.infer<typeof OrgInvite>;
export const INVITE_TTL_DAYS = 7 as const;

export const OrgMemberView = z.object({
  accountId: Uuid,
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.email(),
  role: OrgRole,
  /** How the member joined. */
  via: z.enum(["created", "invite", "domain_auto_join", "join_request", "scim"]),
  joinedAt: Timestamp,
  rowVersion: z.number().int().min(0),
});
export type OrgMemberView = z.infer<typeof OrgMemberView>;

export type MemberAction = "invite" | "change_role" | "remove" | "leave";

/**
 * Who may do what (section 3). `actor` is the caller's role; `target` the member's current role (for invite: the role
 * invited); `to` the new role for change_role. Personal organizations refuse all four. The last owner cannot leave or
 * be demoted or removed (the database also refuses it).
 */
export function memberActionRefusals(x: {
  kind: "personal" | "team";
  action: MemberAction;
  actor: z.infer<typeof OrgRole> | null;
  target: z.infer<typeof OrgRole>;
  to?: z.infer<typeof OrgRole>;
  self: boolean;
  owners: number;
}): string[] {
  const r: string[] = [];
  if (x.kind === "personal") return ["a personal organization has no other members"];
  if (x.actor === null) return ["not a member"];
  const lastOwner = x.target === "owner" && x.owners <= 1;
  switch (x.action) {
    case "leave":
      if (!x.self) r.push("only the member themselves can leave");
      if (lastOwner) r.push("LAST_OWNER: promote another owner first");
      break;
    case "invite":
      if (x.actor === "member") r.push("members cannot invite");
      if (x.target === "owner" && x.actor !== "owner") r.push("only owners invite owners");
      break;
    case "change_role":
    case "remove":
      if (x.actor === "member") r.push("members cannot manage members");
      if (x.actor === "admin" && (x.target === "owner" || (x.action === "change_role" && x.to === "owner")))
        r.push("admins cannot change or remove owners");
      if (x.actor === "admin" && x.action === "remove" && x.target === "admin") r.push("admins remove members only");
      if (lastOwner && (x.action === "remove" || x.to !== "owner")) r.push("LAST_OWNER: an organization keeps an owner");
      break;
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Verified domains and join policy (section 4)
// ---------------------------------------------------------------------------------------------

export const DomainName = z
  .string()
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "a lowercase DNS name");
export const JoinPolicy = z.enum(["off", "request", "auto_join"]);
export type JoinPolicy = z.infer<typeof JoinPolicy>;
export const OrgDomainState = z.enum(["pending", "verified", "failed", "lapsed", "removed"]);

export const OrgDomain = z.object({
  id: Uuid,
  organizationId: Uuid,
  domain: DomainName,
  state: OrgDomainState,
  joinPolicy: JoinPolicy,
  /** The TXT record the owner publishes (domainVerificationRecord). */
  txt: z.object({ name: z.string(), value: z.string() }),
  verifiedAt: Timestamp.nullable(),
  lastCheckedAt: Timestamp.nullable(),
  rowVersion: z.number().int().min(0),
});
export type OrgDomain = z.infer<typeof OrgDomain>;

export const domainVerificationRecord = (domain: string, token: string) => ({
  name: `_wos-verification.${domain}`,
  value: `wos-domain-verification=${token}`,
});

/** A public email domain (or a subdomain of one) can never be verified by an organization. */
export function isBlockedDomain(domain: string, blocklist: readonly string[]): boolean {
  const d = domain.toLowerCase();
  return blocklist.some((b) => d === b || d.endsWith(`.${b}`));
}

/**
 * What a sign-in does for an account whose verified email is on a verified domain (section 4): auto_join adds a
 * membership (unless the account left or was removed before: an exclusion), request makes the organization joinable.
 * Only verified domains count; an existing membership is left alone.
 */
export function domainJoinOutcome(x: {
  email: string;
  emailVerified: boolean;
  domains: ReadonlyArray<{ organizationId: string; domain: string; state: z.infer<typeof OrgDomainState>; joinPolicy: JoinPolicy }>;
  memberOf: ReadonlySet<string>;
  excludedFrom: ReadonlySet<string>;
}): { autoJoin: string[]; joinable: string[] } {
  const d = emailDomain(x.email);
  if (!x.emailVerified || d === null) return { autoJoin: [], joinable: [] };
  const hits = x.domains.filter((v) => v.state === "verified" && v.domain === d && !x.memberOf.has(v.organizationId));
  return {
    autoJoin: hits
      .filter((v) => v.joinPolicy === "auto_join" && !x.excludedFrom.has(v.organizationId))
      .map((v) => v.organizationId)
      .sort(),
    joinable: hits
      .filter((v) => v.joinPolicy === "request" || (v.joinPolicy === "auto_join" && x.excludedFrom.has(v.organizationId)))
      .map((v) => v.organizationId)
      .sort(),
  };
}

export const OrgJoinRequestState = z.enum(["pending", "approved", "denied", "withdrawn"]);
export const OrgJoinRequest = z.object({
  id: Uuid,
  organizationId: Uuid,
  accountId: Uuid,
  email: z.email(),
  state: OrgJoinRequestState,
  createdAt: Timestamp,
  rowVersion: z.number().int().min(0),
});

// ---------------------------------------------------------------------------------------------
// Per-app permissions (section 5)
// ---------------------------------------------------------------------------------------------

export const PermissionOverride = z.object({
  app: AppId,
  permission: PermissionKey,
  role: OrgRole,
  /** true grants it to the role although the manifest does not; false withholds a manifest grant. */
  granted: z.boolean(),
});
export type PermissionOverride = z.infer<typeof PermissionOverride>;

/** The permission keys a role holds in an app: the manifest's grants, then the organization's overrides. */
export function effectiveGrants(
  manifest: Pick<WosAppManifest, "app" | "permissions">,
  overrides: readonly PermissionOverride[],
  role: z.infer<typeof OrgRole>,
): string[] {
  const out = new Set(manifest.permissions.filter((p) => p.grantedTo.includes(role)).map((p) => p.key));
  const declared = new Set(manifest.permissions.map((p) => p.key));
  for (const o of overrides) {
    if (o.app !== manifest.app.id || o.role !== role || !declared.has(o.permission)) continue;
    // core.* permissions are never withheld from owners (section 5).
    if (!o.granted && role === "owner" && o.permission.startsWith("core.")) continue;
    if (o.granted) out.add(o.permission);
    else out.delete(o.permission);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------
// Policy: rate limits, quotas, abuse guards, dormant modules (sections 6, 7)
// ---------------------------------------------------------------------------------------------

const PosInt = z.number().int().positive();
export const DormantModuleName = z.enum(["sso", "scim", "audit_export"]);
export type DormantModuleName = z.infer<typeof DormantModuleName>;

export const IdentityPolicy = z.object({
  schema: z.literal("wos-identity-policy.v1"),
  rateLimits: z.object({
    perAccount: z.object({ requestsPerMinute: PosInt, signInStartsPerHour: PosInt, invitesPerHour: PosInt }),
    perOrg: z.object({ requestsPerMinute: PosInt }),
    perIp: z.object({ signInStartsPerHour: PosInt }),
  }),
  plans: z.object({
    free: z.object({
      membersPerOrg: PosInt,
      pendingInvitesPerOrg: PosInt,
      verifiedDomainsPerOrg: PosInt,
      teamOrgsOwnedPerAccount: PosInt,
      invitesPerDayPerOrg: PosInt,
    }),
  }),
  abuse: z.object({
    newOrgInviteCap: z.object({ hours: PosInt, invites: PosInt }),
    removedMemberReinviteCooldownHours: PosInt,
    disposableDomains: z.array(DomainName),
  }),
  domains: z.object({
    publicEmailDomains: z.array(DomainName).min(1),
    verifyWindowDays: PosInt,
    recheckHours: PosInt,
    lapseAfterFailingDays: PosInt,
  }),
  invites: z.object({ ttlDays: z.literal(INVITE_TTL_DAYS) }),
  /**
   * D66 (5.13.0): where the domain lists come from. Disposable: a pinned maintained list
   * (data/disposable-email-domains.v1.json) plus `abuse.disposableDomains`. Public mail providers: the curated,
   * committed `domains.publicEmailDomains`. Never fetched live; refreshed by a reviewed PR.
   */
  lists: z
    .object({
      disposable: z.object({ file: z.literal("disposable-email-domains.v1.json"), refreshedBy: z.literal("reviewed_pr") }),
      publicEmailProviders: z.object({ source: z.literal("curated"), refreshedBy: z.literal("reviewed_pr") }),
    })
    .optional(),
  /** D66: SSO break-glass (dormant with SSO): email code + a second owner's approval; with one owner, a maintainer AdminAction with a public label. */
  ssoBreakGlass: z
    .object({ rule: z.literal("email_code_and_second_owner"), singleOwnerFallback: z.literal("maintainer_admin_action_public_label") })
    .optional(),
  /** D50: hosted modules dormant until a paying enterprise's order; activated by a public AdminAction. */
  modules: z.record(
    DormantModuleName,
    z.object({ status: z.enum(["dormant", "active"]), trigger: z.string().min(20), activatedBy: z.string().nullable() }),
  ),
});
export type IdentityPolicy = z.infer<typeof IdentityPolicy>;

/** A request that would exceed a quota; null when within it. */
export function quotaRefusal(
  policy: IdentityPolicy,
  plan: "free",
  quota: keyof IdentityPolicy["plans"]["free"],
  used: number,
): string | null {
  const limit = policy.plans[plan][quota];
  return used >= limit ? `QUOTA_EXCEEDED: ${quota} is ${limit} on plan ${plan}` : null;
}

// ---------------------------------------------------------------------------------------------
// Dormant (section 7): contracts shape only; routes answer MODULE_DORMANT until activated
// ---------------------------------------------------------------------------------------------

export const OrgSsoConnection = z
  .object({
    id: Uuid,
    organizationId: Uuid,
    protocol: z.enum(["oidc", "saml"]),
    /** Verified domains of this organization the connection covers. */
    domainIds: z.array(Uuid).min(1),
    enforcement: z.enum(["optional", "required"]),
    oidc: z.object({ issuer: z.url(), clientId: z.string().min(1), clientSecretRef: z.string().min(1) }).nullable(),
    saml: z.object({ entityId: z.string().min(1), ssoUrl: z.url(), certificatePem: z.string().min(100) }).nullable(),
    /** Fresh SSO session required for org access when enforcement is required (hours). */
    maxSessionAgeHours: z.number().int().positive().max(12),
    state: z.enum(["draft", "testing", "active", "disabled"]),
  })
  .superRefine((c, ctx) => {
    if ((c.protocol === "oidc") !== (c.oidc !== null) || (c.protocol === "saml") !== (c.saml !== null))
      ctx.addIssue({ code: "custom", path: ["protocol"], message: "exactly the chosen protocol's settings" });
  });
export type OrgSsoConnection = z.infer<typeof OrgSsoConnection>;

export const ScimToken = z.object({
  id: Uuid,
  organizationId: Uuid,
  /** The first 8 characters, for display; the token itself is stored only as an HMAC. */
  prefix: z.string().length(8),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
});

export const AuditExportRequest = z.object({
  id: Uuid,
  organizationId: Uuid,
  from: Timestamp,
  to: Timestamp,
  format: z.literal("jsonl"),
  state: z.enum(["queued", "ready", "expired", "failed"]),
  /** A signed URL valid for 24 hours once ready. */
  downloadUrl: z.url().nullable(),
});

/** The events an audit export contains (section 7). */
export const AUDIT_EVENT_TYPES = [
  "organization.created",
  "organization.member_changed",
  "organization.invite_changed",
  "organization.domain_changed",
  "organization.join_request_changed",
  "organization.permission_override_changed",
  "entitlement.changed",
] as const;

// ---------------------------------------------------------------------------------------------
// D66 (contracts 5.13.0): pinned domain lists (never fetched live)
// ---------------------------------------------------------------------------------------------

/** A maintained open list, committed at a pinned source commit and refreshed only by a reviewed PR. */
export const DomainList = z.object({
  schema: z.literal("wos-domain-list.v1"),
  name: z.string().min(1),
  source: z.url(),
  path: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  sourceSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  license: z.string().min(1),
  domains: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1),
});
export type DomainList = z.infer<typeof DomainList>;

/** A disposable address (the pinned list plus the policy's own additions); subdomains of a listed domain count. */
export function isDisposableDomain(domain: string, list: ReadonlySet<string>, extra: readonly string[] = []): boolean {
  const d = domain.toLowerCase();
  const parts = d.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (list.has(parts.slice(i).join("."))) return true;
  return extra.some((e) => d === e || d.endsWith(`.${e}`));
}

// ---------------------------------------------------------------------------------------------
// Amendment 04 addendum A (D66, contracts 5.13.0): data export, account deletion, email change
// ---------------------------------------------------------------------------------------------

/** GDPR access and portability: one JSON document of everything wOS holds about the account. */
export const DataExportRequest = z.object({
  id: Uuid,
  state: z.enum(["requested", "confirmed", "ready", "expired", "failed"]),
  requestedAt: Timestamp,
  /** A signed URL valid for 24 hours once ready. */
  downloadUrl: z.url().nullable(),
  expiresAt: Timestamp.nullable(),
});
export type DataExportRequest = z.infer<typeof DataExportRequest>;

/** The sections of an export (`wos-account-export.v1`), each a JSON array or object. */
export const DATA_EXPORT_SECTIONS = [
  "account",
  "email",
  "github",
  "devices",
  "sessions",
  "organizations",
  "invites",
  "join_requests",
  "entitlements_changed",
  "tasks_and_leases",
  "attempts",
  "reviews",
  "documents_authored",
  "contributions",
  "ledger",
  "bug_reports",
  "events_as_actor",
] as const;

/** Deletion: requested, confirmed by an email code, a 14-day grace (cancelable), then carried out. */
export const ACCOUNT_DELETION_GRACE_DAYS = 14 as const;

export const AccountDeletionRequest = z.object({
  id: Uuid,
  state: z.enum(["requested", "scheduled", "cancelled", "completed", "blocked"]),
  requestedAt: Timestamp,
  /** When deletion is carried out (confirmation + 14 days); null until confirmed. */
  scheduledFor: Timestamp.nullable(),
  /** Why it cannot proceed yet (DELETION_BLOCKED): e.g. sole owner of a team organization with other members. */
  blockers: z.array(z.string()),
});
export type AccountDeletionRequest = z.infer<typeof AccountDeletionRequest>;

/**
 * What deletion does to each kind of record (the retention exceptions are the lawful ones: public ledger and receipt
 * integrity, abuse prevention, legal obligations). `pseudonymise` keeps the record and replaces every personal field
 * with the account's pseudonym (`deletedContributorPseudonym`); the account id is a random UUID with no personal data.
 */
export const RETENTION_RULES = {
  account_profile: { action: "delete", note: "display name, avatar, handle, preferences" },
  email: { action: "delete", note: "account_emails row; sign-in requests" },
  sessions_devices: { action: "delete", note: "sessions, devices, attestations" },
  memberships: { action: "delete", note: "every organization membership; join requests; pending invites to the address" },
  github_identity: {
    action: "retain_hashed",
    note: "an HMAC of the GitHub user id for 90 days (the existing reservation), then deleted: stops link-reset abuse",
  },
  contributions: {
    action: "pseudonymise",
    note: "attempts, reviews, documents, PR provenance: public, reviewed history of the codebase; the author becomes the pseudonym",
  },
  ledger_and_receipts: {
    action: "pseudonymise",
    note: "ledger entries and protocol receipts are append-only and hashed; kept for integrity, shown under the pseudonym; balances with no cash value (D3) are forfeited by a ledger entry",
  },
  git_history: {
    action: "retain",
    note: "commits in public repositories are authored by the wOS GitHub App (D9); co-author trailers name the GitHub login, which wOS cannot rewrite in published history",
  },
  events: { action: "pseudonymise", note: "actor ids in the event log stay; personal payload fields are removed" },
  outbound_emails: { action: "retain", note: "already hashed recipients (to_hash), no address" },
  security_logs: { action: "retain", note: "rate-limit buckets and abuse records hold hashes only; they expire on their own schedule" },
} as const satisfies Record<string, { action: "delete" | "retain" | "retain_hashed" | "pseudonymise"; note: string }>;

/** The public name a deleted account's retained records show: stable per account, not reversible without the secret. */
export const deletedContributorPseudonym = (hmacHex: string): string => `former-contributor-${hmacHex.slice(0, 10)}`;

/** Why a deletion cannot be scheduled yet; empty when it can. */
export function accountDeletionRefusals(x: {
  soleOwnerOfTeamOrgsWithOtherMembers: number;
  activeLeases: number;
  maintainer: boolean;
}): string[] {
  const r: string[] = [];
  if (x.soleOwnerOfTeamOrgsWithOtherMembers > 0)
    r.push("DELETION_BLOCKED: transfer ownership of (or delete) every team organization you solely own that has other members");
  if (x.activeLeases > 0) r.push("DELETION_BLOCKED: release or finish your active leases first");
  if (x.maintainer) r.push("DELETION_BLOCKED: a maintainer's role must be removed by another maintainer first");
  return r;
}

/**
 * Email change: the new address proves itself with a code, and the old address confirms with its own code. If the old
 * mailbox is unreachable, a fresh GitHub sign-in of the linked GitHub account replaces the old address's code; without
 * a linked GitHub, a maintainer AdminAction with a public label after a 7-day wait is the only path.
 */
export const EmailChangeRequest = z.object({
  id: Uuid,
  newEmail: z.email(),
  state: z.enum(["pending", "completed", "cancelled", "expired"]),
  /** Which proofs are in: both the new address and one of (old address, GitHub) are needed. */
  proofs: z.object({ newAddress: z.boolean(), oldAddress: z.boolean(), github: z.boolean() }),
  expiresAt: Timestamp,
});
export type EmailChangeRequest = z.infer<typeof EmailChangeRequest>;

export function emailChangeComplete(p: { newAddress: boolean; oldAddress: boolean; github: boolean }): boolean {
  return p.newAddress && (p.oldAddress || p.github);
}
