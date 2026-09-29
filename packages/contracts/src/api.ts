import { z } from "zod";
import { ReviewerSlot } from "./agent-policy.js";
import {
  AgentRunRecord,
  Changeset,
  ChangesetValidation,
  ContextManifest,
  ContextPlan,
  ProviderAttestation,
  ReviewVerdict,
  Ruling,
  TaskKind,
} from "./agent-io.js";
import {
  AttemptView,
  ContributionView,
  ContributorPublic,
  AppFeatureDetail,
  CatalogFeatureDetail,
  LeaderboardRow,
  LeaseView,
  LedgerEntryView,
  Me,
  PlatformStatus,
  Progress,
  ReviewView,
  TargetDetail,
  TargetSummary,
  TaskView,
  AbuSummary,
  Handle,
} from "./domain.js";
import { DomainEvent } from "./events.js";
import { AbuKey, Cursor, FeatureKey, GitSha, Page, Sha256, TargetSlug, Timestamp, Uuid } from "./primitives.js";

/**
 * The control-plane HTTP API, as a typed route map. Base URL: https://api.waronsaas.com
 * (Vercel project `waronsaas-api`, region pdx1). All bodies are JSON. All times are ISO-8601 UTC.
 *
 * Auth modes:
 *   public          no credentials; cacheable (s-maxage=30, stale-while-revalidate=300)
 *   account         any signed-in account (D8: email magic link). Desktop/CLI send
 *                   `Authorization: Bearer <wOS access token>` (opaque, 1h); the web sends the
 *                   HttpOnly cookie `wos_session` (Domain=waronsaas.com, Secure, SameSite=Lax)
 *                   and, for state-changing requests, header `X-wOS-Csrf` matching cookie `wos_csrf`.
 *   contributor     an account with a linked GitHub identity, not suspended. Otherwise 403 GITHUB_REQUIRED.
 *   maintainer      contributor whose account has the maintainer role
 *   github_webhook  `X-Hub-Signature-256` HMAC with GITHUB_WEBHOOK_SECRET
 *   cron            `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron)
 *
 * Idempotency: routes with `idempotent: true` REQUIRE header `Idempotency-Key: <uuid>`.
 * The server stores (key, contributor, route, sha256(body)) -> response for 24h. Same key +
 * same body replays the stored response; same key + different body -> 422 IDEMPOTENCY_MISMATCH.
 *
 * Concurrency: state-changing routes return 409 CONFLICT when a guarded transition lost a race;
 * clients re-read and decide. They never blind-retry a 409.
 */

export const ApiErrorCode = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "NOT_ELIGIBLE",
  "LEASE_NOT_HELD",
  "LEASE_EXPIRED",
  "RESOURCE_LOCKED",
  "LIMIT_REACHED",
  "VALIDATION_FAILED",
  "SCOPE_VIOLATION",
  "MANIFEST_REJECTED",
  "IDEMPOTENCY_MISMATCH",
  "RATE_LIMITED",
  "GITHUB_REQUIRED",
  "GITHUB_LINKED_ELSEWHERE",
  "GITHUB_RESERVED",
  "UPSTREAM_GITHUB",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({ code: ApiErrorCode, message: z.string(), details: z.unknown().optional(), requestId: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

export type AuthMode = "public" | "account" | "contributor" | "maintainer" | "github_webhook" | "cron";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteDef<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  readonly method: HttpMethod;
  readonly path: `/v1/${string}`;
  readonly auth: AuthMode;
  readonly idempotent: boolean;
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly response: R;
  /** Error codes this route may return besides UNAUTHENTICATED/RATE_LIMITED/INTERNAL. */
  readonly errors: readonly ApiErrorCode[];
  readonly summary: string;
}

const None = z.object({}).strict();
const Ok = z.object({ ok: z.literal(true) });

function route<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType, R extends z.ZodType>(
  def: RouteDef<P, Q, B, R>,
): RouteDef<P, Q, B, R> {
  return def;
}

const SlugParams = z.object({ slug: TargetSlug });
const IdParams = z.object({ id: Uuid });

/** Returned by every claim: the lease, the task, and the exact context the agent must receive. */
export const ClaimResponse = z.object({
  task: TaskView,
  lease: LeaseView,
  contextPlan: ContextPlan,
  attempt: AttemptView.nullable(),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const Routes = {
  // ------------------------------------------------------------------ public (web reads these)
  getPlatformStatus: route({
    method: "GET",
    path: "/v1/public/status",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: PlatformStatus,
    errors: [],
    summary: "Bootstrap flag and active contract/policy/schedule versions.",
  }),
  listTargets: route({
    method: "GET",
    path: "/v1/public/targets",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ items: z.array(TargetSummary) }),
    errors: [],
    summary: "The Sniper List in rank order with real progress (0 when nothing exists).",
  }),
  getTarget: route({
    method: "GET",
    path: "/v1/public/targets/:slug",
    auth: "public",
    idempotent: false,
    params: SlugParams,
    query: None,
    body: None,
    response: TargetDetail,
    errors: ["NOT_FOUND"],
    summary: "Application drilldown: capabilities, features, exclusions, roadmap workflow.",
  }),
  getProgressHistory: route({
    method: "GET",
    path: "/v1/public/targets/:slug/progress",
    auth: "public",
    idempotent: false,
    params: SlugParams,
    query: z.object({ cursor: Cursor.optional() }),
    body: None,
    response: Page(Progress),
    errors: ["NOT_FOUND"],
    summary: "Append-only app-level progress snapshots, newest first; each states its roadmap version.",
  }),
  getFeature: route({
    method: "GET",
    path: "/v1/public/targets/:slug/features/:feature",
    auth: "public",
    idempotent: false,
    params: z.object({ slug: TargetSlug, feature: FeatureKey }),
    query: None,
    body: None,
    response: AppFeatureDetail,
    errors: ["NOT_FOUND"],
    summary: "App feature drilldown: this app's profile requirements -> relevant ABUs -> PRs, with weights and the numbers behind the %.",
  }),
  listCatalog: route({
    method: "GET",
    path: "/v1/public/catalog",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({
      items: z.array(CatalogFeatureDetail.pick({ key: true, title: true, summary: true, state: true, aliasOf: true, referencedBy: true })),
    }),
    errors: [],
    summary: "The global Feature Catalog (D10) with the apps referencing each feature.",
  }),
  getCatalogFeature: route({
    method: "GET",
    path: "/v1/public/catalog/:feature",
    auth: "public",
    idempotent: false,
    params: z.object({ feature: FeatureKey }),
    query: None,
    body: None,
    response: CatalogFeatureDetail,
    errors: ["NOT_FOUND"],
    summary: "One catalog feature: contract, all requirements with their app profiles, all ABUs.",
  }),
  getAbu: route({
    method: "GET",
    path: "/v1/public/abus/:id",
    auth: "public",
    idempotent: false,
    params: IdParams,
    query: None,
    body: None,
    response: AbuSummary.extend({ attempts: z.array(AttemptView), reviews: z.array(ReviewView) }),
    errors: ["NOT_FOUND"],
    summary: "ABU drilldown with attempts, revealed reviews and PR.",
  }),
  listActivity: route({
    method: "GET",
    path: "/v1/public/activity",
    auth: "public",
    idempotent: false,
    params: None,
    query: z.object({ cursor: Cursor.optional(), target: TargetSlug.optional() }),
    body: None,
    response: Page(DomainEvent),
    errors: [],
    summary: "Public events only, newest first.",
  }),
  getContributor: route({
    method: "GET",
    path: "/v1/public/contributors/:handle",
    auth: "public",
    idempotent: false,
    params: z.object({ handle: Handle }),
    query: None,
    body: None,
    response: ContributorPublic.extend({ contributions: z.array(ContributionView) }),
    errors: ["NOT_FOUND"],
    summary:
      "Public profile of an account that has contributed (non-contributors have none). Contributions are public PRs; score only if opted in.",
  }),
  getContributorLedger: route({
    method: "GET",
    path: "/v1/public/contributors/:handle/ledger",
    auth: "public",
    idempotent: false,
    params: z.object({ handle: Handle }),
    query: z.object({ cursor: Cursor.optional() }),
    body: None,
    response: Page(LedgerEntryView),
    errors: ["NOT_FOUND"],
    summary: "Token history. 404 unless the contributor opted in to the leaderboard.",
  }),
  getLeaderboard: route({
    method: "GET",
    path: "/v1/public/leaderboard",
    auth: "public",
    idempotent: false,
    params: None,
    query: z.object({ cursor: Cursor.optional() }),
    body: None,
    response: Page(LeaderboardRow).extend({ disclaimer: z.literal("WOS tokens are in-app credits with no cash value.") }),
    errors: [],
    summary: "Opted-in contributors ranked by score.",
  }),

  // ------------------------------------------------------------------ auth (D8: email magic link / code)
  startEmailSignIn: route({
    method: "POST",
    path: "/v1/auth/email/start",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: z.object({
      email: z.email().max(254),
      clientKind: z.enum(["web", "desktop", "cli"]),
      deviceName: z.string().max(100).nullable(),
      /** Desktop/CLI only: Ed25519 public key (base64) generated on first run, private key in the OS keychain. */
      devicePublicKey: z.string().max(100).nullable(),
    }),
    /**
     * Always 202 with the same shape whether or not the email has an account (no enumeration).
     * `pollSecret` is returned only here and never emailed: redeeming the email token also
     * requires it, which binds the sign-in to the client that started it (SECURITY.md S-2).
     * For web the pollSecret is set as an HttpOnly cookie `wos_signin` instead of returned.
     */
    response: z.object({ requestId: Uuid, pollSecret: z.string().nullable(), expiresAt: Timestamp }),
    errors: ["VALIDATION_FAILED"],
    summary: "Sends a single-use sign-in email containing a link and an 8-character code. Creates the account on first verify.",
  }),
  redeemEmailSignIn: route({
    method: "POST",
    path: "/v1/auth/email/redeem",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: z.object({
      requestId: Uuid,
      /** Desktop/CLI send it in the body; web sends it via the wos_signin cookie. */
      pollSecret: z.string().nullable(),
      /** Exactly one of: the link token (from the deep link / web link) or the code typed by the user. */
      linkToken: z.string().nullable(),
      code: z
        .string()
        .regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
        .nullable(),
    }),
    response: z.object({
      accessToken: z.string(),
      accessExpiresAt: Timestamp,
      refreshToken: z.string(),
      refreshExpiresAt: Timestamp,
      deviceId: Uuid.nullable(),
      created: z.boolean(),
      me: Me,
    }),
    errors: ["UNAUTHENTICATED", "RATE_LIMITED"],
    summary: "Redeems link token or code (single use, 15 min, 5 tries). Web receives an HttpOnly cookie instead of tokens in the body.",
  }),
  refreshSession: route({
    method: "POST",
    path: "/v1/auth/refresh",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: z.object({ refreshToken: z.string() }),
    response: z.object({ accessToken: z.string(), accessExpiresAt: Timestamp, refreshToken: z.string(), refreshExpiresAt: Timestamp }),
    errors: ["UNAUTHENTICATED"],
    summary: "Rotating refresh; reuse of a rotated refresh token revokes the whole session family.",
  }),
  logout: route({
    method: "POST",
    path: "/v1/auth/logout",
    auth: "account",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: Ok,
    errors: [],
    summary: "Revokes the session family.",
  }),
  startGithubLink: route({
    method: "POST",
    path: "/v1/me/github/link",
    auth: "account",
    idempotent: false,
    params: None,
    query: None,
    body: z.object({ flow: z.enum(["device", "web"]) }),
    response: z.discriminatedUnion("flow", [
      z.object({
        flow: z.literal("device"),
        linkId: Uuid,
        userCode: z.string(),
        verificationUri: z.url(),
        intervalSeconds: z.number().int(),
        expiresAt: Timestamp,
      }),
      z.object({ flow: z.literal("web"), linkId: Uuid, authorizeUrl: z.url(), expiresAt: Timestamp }),
    ]),
    errors: ["CONFLICT", "UPSTREAM_GITHUB"],
    summary: "Starts GitHub user authorization (the wOS GitHub App's OAuth). Device flow for CLI/Desktop, web redirect for the site.",
  }),
  pollGithubLink: route({
    method: "POST",
    path: "/v1/me/github/link/poll",
    auth: "account",
    idempotent: false,
    params: None,
    query: None,
    body: z.object({ linkId: Uuid }),
    response: z.discriminatedUnion("status", [
      z.object({ status: z.literal("pending") }),
      z.object({ status: z.literal("denied") }),
      z.object({ status: z.literal("expired") }),
      z.object({ status: z.literal("linked"), me: Me }),
    ]),
    errors: ["NOT_FOUND", "GITHUB_LINKED_ELSEWHERE", "GITHUB_RESERVED", "UPSTREAM_GITHUB"],
    summary:
      "Completes the link. One GitHub per account; a GitHub linked to (or reserved by) another account is refused. The GitHub token is discarded after reading /user.",
  }),
  githubOAuthCallback: route({
    method: "GET",
    path: "/v1/github/oauth/callback",
    auth: "public",
    idempotent: false,
    params: None,
    query: z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }),
    body: None,
    response: z.object({ redirectTo: z.url() }),
    errors: ["NOT_FOUND", "GITHUB_LINKED_ELSEWHERE", "GITHUB_RESERVED", "UPSTREAM_GITHUB"],
    summary:
      "Web linking flow callback (the App's Callback URL). `state` must match a pending github_link_requests row; responds 302 to https://waronsaas.com/account?github=linked|refused.",
  }),
  unlinkGithub: route({
    method: "POST",
    path: "/v1/me/github/unlink",
    auth: "account",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({ confirm: z.literal(true) }),
    response: Me,
    errors: ["CONFLICT"],
    summary:
      "Refused (409) while the account holds any active lease, live attempt or sealed review. The unlinked GitHub stays reserved to this account for 90 days.",
  }),

  // ------------------------------------------------------------------ me
  getMe: route({
    method: "GET",
    path: "/v1/me",
    auth: "account",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: Me,
    errors: [],
    summary: "Current contributor, attestations, balance.",
  }),
  updateMe: route({
    method: "PATCH",
    path: "/v1/me",
    auth: "account",
    idempotent: false,
    params: None,
    query: None,
    body: z.object({
      displayName: z.string().max(80).nullable().optional(),
      leaderboardOptIn: z.boolean().optional(),
      /** Non-contributor features are a FOUNDER DECISION (GAPS.md G-27); these two are the recommended minimum. */
      followedTargets: z.array(TargetSlug).max(20).optional(),
      progressEmails: z.boolean().optional(),
    }),
    response: Me,
    errors: ["VALIDATION_FAILED"],
    summary: "Profile settings (leaderboard opt-in).",
  }),
  postAttestation: route({
    method: "POST",
    path: "/v1/me/attestations",
    auth: "contributor",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({ deviceId: Uuid, providers: z.array(ProviderAttestation) }),
    response: Me,
    errors: ["VALIDATION_FAILED", "FORBIDDEN"],
    summary: "Records local CLI readiness (wos status). An attestation, not proof (SECURITY.md).",
  }),
  getMyWork: route({
    method: "GET",
    path: "/v1/me/work",
    auth: "contributor",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ leases: z.array(LeaseView), tasks: z.array(TaskView), attempts: z.array(AttemptView) }),
    errors: [],
    summary: "Everything `wos status` shows: active leases, my tasks, my attempts.",
  }),
  listMyEvents: route({
    method: "GET",
    path: "/v1/me/events",
    auth: "account",
    idempotent: false,
    params: None,
    query: z.object({ after: z.coerce.number().int().nonnegative().optional() }),
    body: None,
    response: z.object({ items: z.array(DomainEvent), lastId: z.number().int().nonnegative() }),
    errors: [],
    summary: "Events about my tasks/attempts (public + my private), ascending; clients poll every 5s while active.",
  }),

  // ------------------------------------------------------------------ work discovery and claims
  listClaimableAbus: route({
    method: "GET",
    path: "/v1/targets/:slug/features/:feature/abus",
    auth: "contributor",
    idempotent: false,
    params: z.object({ slug: TargetSlug, feature: FeatureKey }),
    query: None,
    body: None,
    response: z.object({ items: z.array(AbuSummary) }),
    errors: ["NOT_FOUND"],
    summary: "ABUs of the feature with `claimable` computed for the caller.",
  }),
  claimBuild: route({
    method: "POST",
    path: "/v1/abus/:id/claim",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: z.object({ deviceId: Uuid }),
    response: ClaimResponse,
    errors: ["NOT_FOUND", "NOT_ELIGIBLE", "RESOURCE_LOCKED", "LIMIT_REACHED", "CONFLICT"],
    summary: "LEASE: creates the attempt, leases the abu_build task, takes resource locks, pins the base commit. (wos build <abu-id>)",
  }),
  claimReview: route({
    method: "POST",
    path: "/v1/reviews/claim",
    auth: "contributor",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({
      deviceId: Uuid,
      slot: ReviewerSlot,
      kinds: z.array(z.enum(["roadmap_review", "feature_review", "implementation_review"])).min(1),
    }),
    response: ClaimResponse.nullable(),
    errors: ["NOT_ELIGIBLE", "LIMIT_REACHED"],
    summary: "Server ASSIGNS the oldest eligible review task for the slot (reviewers cannot pick subjects). Null when none. (wos review)",
  }),
  listOpenTasks: route({
    method: "GET",
    path: "/v1/tasks",
    auth: "contributor",
    idempotent: false,
    params: None,
    query: z.object({ kind: TaskKind.optional(), target: TargetSlug.optional() }),
    body: None,
    response: z.object({ items: z.array(TaskView) }),
    errors: [],
    summary: "Open author/resolution tasks the caller is eligible for (reviews are assigned via claimReview).",
  }),
  claimTask: route({
    method: "POST",
    path: "/v1/tasks/:id/claim",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: z.object({ deviceId: Uuid }),
    response: ClaimResponse,
    errors: ["NOT_FOUND", "NOT_ELIGIBLE", "LIMIT_REACHED", "CONFLICT"],
    summary: "Claims a roadmap_author / feature_author / abu_revision / conflict_resolution task. (wos roadmap, wos resolve)",
  }),

  // ------------------------------------------------------------------ lease lifecycle
  heartbeat: route({
    method: "POST",
    path: "/v1/leases/:id/heartbeat",
    auth: "contributor",
    idempotent: false,
    params: IdParams,
    query: None,
    body: z.object({ deviceId: Uuid, phase: z.string().max(40) }),
    response: LeaseView,
    errors: ["LEASE_NOT_HELD", "LEASE_EXPIRED"],
    summary: "Extends expires_at to min(now + ttl, hard deadline).",
  }),
  releaseLease: route({
    method: "POST",
    path: "/v1/leases/:id/release",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: z.object({ reason: z.string().max(500) }),
    response: LeaseView,
    errors: ["LEASE_NOT_HELD"],
    summary: "Gives the task back. For builds this abandons the attempt.",
  }),
  postManifest: route({
    method: "POST",
    path: "/v1/leases/:id/manifest",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: ContextManifest,
    response: z.object({ accepted: z.literal(true), manifestId: Uuid }),
    errors: ["LEASE_NOT_HELD", "LEASE_EXPIRED", "MANIFEST_REJECTED"],
    summary: "Immutable Context Manifest for this invocation; must match the plan. Moves attempt leased->building.",
  }),
  postAgentRun: route({
    method: "POST",
    path: "/v1/leases/:id/agent-runs",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: AgentRunRecord,
    response: z.object({ agentRunId: Uuid }),
    errors: ["LEASE_NOT_HELD", "VALIDATION_FAILED"],
    summary: "Signed attestation of one CLI run.",
  }),
  setAttemptPhase: route({
    method: "POST",
    path: "/v1/attempts/:id/phase",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: z.object({ phase: z.enum(["verifying", "building"]), localRepair: z.boolean() }),
    response: AttemptView,
    errors: ["LEASE_NOT_HELD", "CONFLICT", "LIMIT_REACHED"],
    summary: "building->verifying, or verifying->building for a local repair loop.",
  }),
  submitChangeset: route({
    method: "POST",
    path: "/v1/leases/:id/changeset",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: Changeset,
    response: z.object({ validation: ChangesetValidation, attempt: AttemptView.nullable(), documentId: Uuid.nullable() }),
    errors: ["LEASE_NOT_HELD", "LEASE_EXPIRED", "SCOPE_VIOLATION", "VALIDATION_FAILED", "UPSTREAM_GITHUB"],
    summary: "Author/builder submission. Scope validated server-side; the App then builds the commit via the Git Data API.",
  }),
  submitVerdict: route({
    method: "POST",
    path: "/v1/leases/:id/verdict",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: z.object({
      verdict: ReviewVerdict,
      /** Binds the verdict to exactly what was reviewed (D9). Must equal the round's head sha and submission hash. */
      headSha: GitSha,
      submissionSha256: Sha256.nullable(),
      agentRunId: Uuid,
    }),
    response: z.object({ sealed: z.literal(true), reviewId: Uuid }),
    errors: ["LEASE_NOT_HELD", "LEASE_EXPIRED", "VALIDATION_FAILED", "CONFLICT"],
    summary: "Sealed until both slots are in; then the round is revealed atomically.",
  }),
  submitRuling: route({
    method: "POST",
    path: "/v1/leases/:id/ruling",
    auth: "contributor",
    idempotent: true,
    params: IdParams,
    query: None,
    body: Ruling,
    response: z.object({ rulingId: Uuid, awaitingMaintainer: z.boolean() }),
    errors: ["LEASE_NOT_HELD", "VALIDATION_FAILED"],
    summary: "Conflict resolver output; needs maintainer confirmation in V1.",
  }),
  getAttempt: route({
    method: "GET",
    path: "/v1/attempts/:id",
    auth: "contributor",
    idempotent: false,
    params: IdParams,
    query: None,
    body: None,
    response: AttemptView.extend({
      reviews: z.array(ReviewView),
      openFindings: z.array(z.object({ id: Uuid, title: z.string(), detail: z.string(), slot: ReviewerSlot })),
    }),
    errors: ["NOT_FOUND"],
    summary: "Attempt with revealed reviews and open findings.",
  }),

  // ------------------------------------------------------------------ proposals & blockers (GitHub Issues)
  createProposal: route({
    method: "POST",
    path: "/v1/proposals",
    auth: "contributor",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({
      target: TargetSlug,
      feature: FeatureKey.nullable(),
      title: z.string().min(5).max(200),
      body: z.string().min(20).max(20000),
    }),
    response: z.object({ proposalId: Uuid, issueUrl: z.url() }),
    errors: ["VALIDATION_FAILED", "UPSTREAM_GITHUB"],
    summary: "wos propose: opens a GitHub Issue (label wos:proposal) via the App.",
  }),
  createBlocker: route({
    method: "POST",
    path: "/v1/blockers",
    auth: "contributor",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({
      target: TargetSlug,
      affectedContract: z.string().min(1),
      reason: z.string().min(10),
      evidence: z.string().min(10),
      requestedCapability: z.string().min(5),
      affectedWorkstream: z.string(),
      suggestedResolution: z.string().nullable(),
      abu: AbuKey.nullable(),
    }),
    response: z.object({ blockerId: Uuid, issueUrl: z.url(), taskId: Uuid }),
    errors: ["VALIDATION_FAILED", "UPSTREAM_GITHUB"],
    summary: "ARCHITECTURE_BLOCKER in a target repo: GitHub Issue (label wos:blocker) + conflict_resolution task.",
  }),

  // ------------------------------------------------------------------ maintainer
  openRoadmap: route({
    method: "POST",
    path: "/v1/admin/targets/:slug/roadmaps",
    auth: "maintainer",
    idempotent: true,
    params: SlugParams,
    query: None,
    body: z.object({ reason: z.string().min(5) }),
    response: z.object({ documentId: Uuid, taskId: Uuid }),
    errors: ["CONFLICT", "NOT_FOUND"],
    summary: "Opens the canonical roadmap workflow (409 if one is open).",
  }),
  confirmRuling: route({
    method: "POST",
    path: "/v1/admin/rulings/:id/confirm",
    auth: "maintainer",
    idempotent: true,
    params: IdParams,
    query: None,
    body: z.object({ accept: z.boolean(), note: z.string().min(5) }),
    response: Ok,
    errors: ["NOT_FOUND", "CONFLICT"],
    summary: "Confirms or rejects a resolver ruling (public note).",
  }),
  maintainerAction: route({
    method: "POST",
    path: "/v1/admin/actions",
    auth: "maintainer",
    idempotent: true,
    params: None,
    query: None,
    body: z.discriminatedUnion("action", [
      z.object({ action: z.literal("abandon_document"), documentId: Uuid, reason: z.string().min(5) }),
      z.object({ action: z.literal("reopen_document"), documentId: Uuid, reason: z.string().min(5) }),
      z.object({ action: z.literal("fail_attempt"), attemptId: Uuid, reason: z.string().min(5) }),
      z.object({ action: z.literal("flag_abu_for_decomposition"), abuId: Uuid, reason: z.string().min(5) }),
      z.object({ action: z.literal("reverse_contribution"), contributionId: Uuid, reason: z.string().min(5) }),
      z.object({ action: z.literal("suspend_account"), handleOrEmail: z.string().min(3), reason: z.string().min(5) }),
      z.object({ action: z.literal("set_hosting"), target: TargetSlug, hostedUrl: z.url().nullable(), selfHostable: z.boolean() }),
      z.object({ action: z.literal("end_bootstrap"), reason: z.string().min(5) }),
      z.object({
        action: z.literal("ledger_adjustment"),
        handle: Handle,
        amount: z.number().int(),
        bucket: z.enum(["held", "available"]),
        memo: z.string().min(10),
      }),
      z.object({
        action: z.literal("award_security"),
        handle: Handle,
        severity: z.enum(["low", "medium", "high", "critical"]),
        reference: z.url(),
      }),
    ]),
    response: Ok,
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    summary: "Every maintainer override. Each writes a public event with the reason.",
  }),

  // ------------------------------------------------------------------ machine endpoints
  githubWebhook: route({
    method: "POST",
    path: "/v1/github/webhook",
    auth: "github_webhook",
    idempotent: false,
    params: None,
    query: None,
    body: z.unknown(),
    response: Ok,
    errors: ["FORBIDDEN"],
    summary: "Verified, deduped by X-GitHub-Delivery, stored, processed; always 200 after storage.",
  }),
  cronSweep: route({
    method: "GET",
    path: "/v1/cron/sweep",
    auth: "cron",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ expiredLeases: z.number().int(), expiredAttempts: z.number().int(), released: z.number().int() }),
    errors: ["FORBIDDEN"],
    summary: "Every minute: expire leases, lapse revision windows, release held awards past hold.",
  }),
  cronDispatch: route({
    method: "GET",
    path: "/v1/cron/dispatch",
    auth: "cron",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ processed: z.number().int() }),
    errors: ["FORBIDDEN"],
    summary: "Every minute: run event consumers (progress, rewards, task_unlocker, github_sync) over unconsumed events.",
  }),
} as const;

export type RouteName = keyof typeof Routes;
export type RouteOf<N extends RouteName> = (typeof Routes)[N];
export type RouteResponse<N extends RouteName> = z.infer<RouteOf<N>["response"]>;
export type RouteBody<N extends RouteName> = z.infer<RouteOf<N>["body"]>;
export type RouteParams<N extends RouteName> = z.infer<RouteOf<N>["params"]>;
export type RouteQuery<N extends RouteName> = z.infer<RouteOf<N>["query"]>;

/** Public web host and API host, fixed by D5. */
export const HOSTS = {
  web: "https://waronsaas.com",
  api: "https://api.waronsaas.com",
} as const;
