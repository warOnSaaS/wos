import { z } from "zod";
import { ModelRef, ReviewerSlot } from "./agent-policy.js";
import {
  AgentRunRecord,
  Changeset,
  ChangesetValidation,
  ContextManifest,
  ContextPlan,
  ProviderAttestation,
  ToolchainAttestation,
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
import {
  AppId,
  AppRegistryEntry,
  AppReleaseView,
  ApplicationProgressView,
  EnvironmentKey,
  EnvironmentTokenClaims,
  ModulePackage,
  OrganizationSlug,
  OrganizationView,
  OrgApps,
  OrgAppView,
  WosAppManifest,
} from "./wos-app.js";
import { AbuKey, Cursor, FeatureKey, GitSha, Page, SemVer, Sha256, TargetSlug, Timestamp, Uuid } from "./primitives.js";

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
 * A refused submission (422 SCOPE_VIOLATION on submitChangeset) carries its ChangesetValidation in
 * `error.details` (contracts 4.4.0, B-0006-control-plane); there is no top-level `validation` field on errors.
 *
 * Implicit errors (never listed per route): UNAUTHENTICATED and GITHUB_REQUIRED where the auth mode
 * requires them, RATE_LIMITED and INTERNAL everywhere, IDEMPOTENCY_MISMATCH on every idempotent route,
 * VALIDATION_FAILED for any request that fails its zod schema.
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
  // contracts 5.0.0 (Amendment 01)
  "NOT_ENTITLED",
  "DEPENDENCY_NOT_ENABLED",
  "DEPENDENT_ENABLED",
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
  /**
   * For review claims: exactly what the verdict must be bound to (contracts 4.2.0, B-0008-github-build).
   * submitVerdict sends round.headSha and round.submissionSha256 back. Null for non-review claims.
   */
  round: z
    .object({ id: Uuid, number: z.number().int().positive(), headSha: GitSha, submissionSha256: Sha256.nullable() })
    .nullable()
    .optional(),
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
      /**
       * web: the public site waronsaas.com in the browser (cookies, S-5). web_app (contracts 5.6.0, B-0002-suite-shell):
       * authenticated wOS Web's SERVER at app.waronsaas.com, a first-party server-side client like desktop and cli:
       * `pollSecret` and tokens come in the body and never reach browser script (S-43); the emailed link opens
       * HOSTS.app + WEB_APP_SIGNIN_CODE_PATH + "?r=<requestId>&t=<linkToken>".
       * mobile (contracts 5.11.0, B-0001-mobile-runtime): wOS Mobile on a phone. `pollSecret` and tokens come in the
       * body, `devicePublicKey` must be null (no device is registered), and the email carries only the code, typed in
       * the app that asked (no link). The pollSecret binds the code to that app (S-2); tokens live in
       * expo-secure-store (S-4).
       */
      clientKind: z.enum(["web", "desktop", "cli", "web_app", "mobile"]),
      deviceName: z.string().max(100).nullable(),
      /** Desktop/CLI only: Ed25519 public key as base64 of the raw 32 bytes (canonical.ts C-5), generated on first run; private key stays in the OS keychain. */
      devicePublicKey: z.string().max(100).nullable(),
    }),
    /**
     * Always 202 with the same shape whether or not the email has an account (no enumeration).
     * `pollSecret` is returned only here and never emailed: redeeming the email token also
     * requires it, which binds the sign-in to the client that started it (SECURITY.md S-2).
     * For web the pollSecret is set as an HttpOnly cookie `wos_signin` instead of returned; desktop, cli,
     * web_app and mobile receive it in the body.
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
      /**
       * contracts 5.6.0 (B-0008-control-plane, S-5 amended): for clientKind web only, the CSRF value the site sends as
       * X-wOS-Csrf. Cookies are host-only on api.waronsaas.com, so page script can no longer read wos_csrf.
       */
      csrfToken: z.string().min(16).optional(),
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
    response: z.object({
      accessToken: z.string(),
      accessExpiresAt: Timestamp,
      refreshToken: z.string(),
      refreshExpiresAt: Timestamp,
      /** contracts 5.6.0: web only, the rotated CSRF value (see redeemEmailSignIn). */
      csrfToken: z.string().min(16).optional(),
    }),
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
    body: z.object({
      deviceId: Uuid,
      providers: z.array(ProviderAttestation),
      /** D13: absent or null means the device may not claim ABUs with toolchain requirements. */
      toolchain: ToolchainAttestation.nullable().optional(),
    }),
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
    body: z.object({
      deviceId: Uuid,
      /**
       * D15 (contracts 4.3.0, B-0010-github-build): the model to run this lease on, a `ModelRef` from the policy.
       * Must be in the role's `allowedModels` and attested by the device, else NOT_ELIGIBLE; a second build lease
       * on the same provider is LIMIT_REACHED. Omitted = the first of the role's `allowedModels` (policy order)
       * that the device attests, i.e. Opus for builders when claude is attested. The plan's model, modelId,
       * provider, reasoning and budget are those of the chosen model; the manifest must match the plan.
       */
      model: ModelRef.optional(),
    }),
    response: ClaimResponse,
    errors: ["NOT_FOUND", "NOT_ELIGIBLE", "NOT_ENTITLED", "RESOURCE_LOCKED", "LIMIT_REACHED", "CONFLICT", "UPSTREAM_GITHUB"],
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
    errors: ["NOT_ELIGIBLE", "NOT_ENTITLED", "LIMIT_REACHED"],
    summary: "Server ASSIGNS the oldest eligible review task for the slot (reviewers cannot pick subjects). Null when none. (wos review)",
  }),
  listOpenTasks: route({
    method: "GET",
    path: "/v1/tasks",
    auth: "contributor",
    idempotent: false,
    params: None,
    query: z.object({ kind: TaskKind.optional(), target: TargetSlug.optional(), feature: FeatureKey.optional() }),
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
    body: z.object({
      deviceId: Uuid,
      /**
       * D15 (contracts 4.3.0, B-0010-github-build): the model to run this lease on, a `ModelRef` from the policy.
       * Must be in the role's `allowedModels` and attested by the device, else NOT_ELIGIBLE; a second build lease
       * on the same provider is LIMIT_REACHED. Omitted = the first of the role's `allowedModels` (policy order)
       * that the device attests, i.e. Opus for builders when claude is attested. The plan's model, modelId,
       * provider, reasoning and budget are those of the chosen model; the manifest must match the plan.
       */
      model: ModelRef.optional(),
    }),
    response: ClaimResponse,
    errors: ["NOT_FOUND", "NOT_ELIGIBLE", "NOT_ENTITLED", "LIMIT_REACHED", "CONFLICT", "UPSTREAM_GITHUB"],
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
    summary:
      "Immutable Context Manifest for one agent invocation; must match the plan. The first one moves the attempt leased->building. A local repair run posts a new manifest (same plan, new local:verification-output hash); a submission must cite the manifest of the run that produced it.",
  }),
  getLeaseDocument: route({
    method: "GET",
    path: "/v1/leases/:id/documents",
    auth: "contributor",
    idempotent: false,
    params: IdParams,
    /** The ref goes in the query string (refs contain '/' and '@'; B-0003-control-plane). */
    query: z.object({ ref: z.string().min(5).max(300) }),
    body: None,
    response: z.object({ ref: z.string(), sha256: Sha256, contentBase64: z.string() }),
    errors: ["LEASE_NOT_HELD", "LEASE_EXPIRED", "NOT_FOUND", "FORBIDDEN"],
    summary:
      "Serves a server_document of the caller's active lease (B-0004-github-build). FORBIDDEN for any ref not in that lease's plan (so a sealed wos:verdict/... ref can never be fetched). sha256 always equals the plan's.",
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

/**
 * One-product routes (Amendment 01, contracts 5.0.0), served by the control plane from Wave 3.
 * The control plane's handler table covers `Routes` today; the Wave 3 control-plane brief adds these handlers
 * and serves `{ ...Routes, ...AppRoutes }` (WORKSTREAMS section 12). Frozen now so Desktop, Web, CLI and the
 * product's Core build against one shape.
 *
 * Build gate (D16): from Wave 3 claimBuild, claimTask and claimReview return 403 NOT_ENTITLED unless the
 * `build` app is enabled for an organization the caller belongs to (migration 0006 enables it on the personal
 * organization of every account that existed before it).
 */
const AppParams = z.object({ app: AppId });
const OrgAppParams = z.object({ id: Uuid, app: AppId });
const EntitlementBody = z.object({
  /** Optimistic concurrency: the entitlement rowVersion the caller saw (null = no row yet). 409 CONFLICT if stale. */
  expectedRowVersion: z.number().int().min(0).nullable(),
});

export const AppRoutes = {
  listApps: route({
    method: "GET",
    path: "/v1/public/apps",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ items: z.array(AppRegistryEntry) }),
    errors: [],
    summary: "The AppRegistry: every published wOS application and module at its current version.",
  }),
  getApp: route({
    method: "GET",
    path: "/v1/public/apps/:app",
    auth: "public",
    idempotent: false,
    params: AppParams,
    query: None,
    body: None,
    response: AppRegistryEntry,
    errors: ["NOT_FOUND"],
    summary: "One registry entry.",
  }),
  getAppRelease: route({
    method: "GET",
    path: "/v1/public/apps/:app/releases/:version",
    auth: "public",
    idempotent: false,
    params: z.object({ app: AppId, version: SemVer }),
    query: None,
    body: None,
    response: AppReleaseView,
    errors: ["NOT_FOUND"],
    summary: "One released version, published or yanked (contracts 5.2.0): Desktop's package lookup and yank check.",
  }),
  getApplicationProgress: route({
    method: "GET",
    path: "/v1/public/apps/:app/progress",
    auth: "public",
    idempotent: false,
    params: AppParams,
    query: None,
    body: None,
    response: ApplicationProgressView,
    errors: ["NOT_FOUND"],
    summary: "Application progress from computeApplicationProgress (contracts 5.2.0); independent of any entitlement.",
  }),
  getEnvironmentKeys: route({
    method: "GET",
    path: "/v1/public/environment-keys",
    auth: "public",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ keys: z.array(EnvironmentKey) }),
    errors: [],
    summary: "Public keys hosted wOS Core uses to verify environment tokens (current and next, for rotation).",
  }),
  listMyOrganizations: route({
    method: "GET",
    path: "/v1/orgs",
    auth: "account",
    idempotent: false,
    params: None,
    query: None,
    body: None,
    response: z.object({ items: z.array(OrganizationView) }),
    errors: [],
    summary: "The caller's organizations with their role (the personal one always first).",
  }),
  createOrganization: route({
    method: "POST",
    path: "/v1/orgs",
    auth: "account",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({ name: z.string().min(1).max(80), slug: OrganizationSlug }),
    response: OrganizationView,
    errors: ["CONFLICT", "LIMIT_REACHED"],
    summary: "Creates a team organization with the caller as owner.",
  }),
  listOrgApps: route({
    method: "GET",
    path: "/v1/orgs/:id/apps",
    auth: "account",
    idempotent: false,
    params: IdParams,
    query: None,
    body: None,
    response: OrgApps,
    errors: ["NOT_FOUND", "FORBIDDEN"],
    summary: "Your Apps and Available Apps for one organization (members only).",
  }),
  enableApp: route({
    method: "POST",
    path: "/v1/orgs/:id/apps/:app/enable",
    auth: "account",
    idempotent: true,
    params: OrgAppParams,
    query: None,
    body: EntitlementBody,
    response: OrgAppView,
    errors: ["NOT_FOUND", "FORBIDDEN", "CONFLICT", "DEPENDENCY_NOT_ENABLED", "VALIDATION_FAILED"],
    summary: "EntitlementMachine enable (owner/admin). Writes entitlement.changed; every surface picks it up.",
  }),
  disableApp: route({
    method: "POST",
    path: "/v1/orgs/:id/apps/:app/disable",
    auth: "account",
    idempotent: true,
    params: OrgAppParams,
    query: None,
    body: EntitlementBody,
    response: OrgAppView,
    errors: ["NOT_FOUND", "FORBIDDEN", "CONFLICT", "DEPENDENT_ENABLED"],
    summary: "EntitlementMachine disable (owner/admin). Hides the app on hosted surfaces; never deletes data.",
  }),
  issueEnvironmentToken: route({
    method: "POST",
    path: "/v1/environments/:id/token",
    auth: "account",
    idempotent: false,
    params: IdParams,
    query: None,
    body: z.object({ organizationId: Uuid }),
    response: z.object({ token: z.string().min(20), expiresAt: Timestamp, claims: EnvironmentTokenClaims }),
    errors: ["NOT_FOUND", "FORBIDDEN"],
    summary: "Mints a 15-minute environment token for a wOS Cloud environment and one of the caller's orgs.",
  }),
  publishAppRelease: route({
    method: "POST",
    path: "/v1/admin/app-releases",
    auth: "maintainer",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({
      manifest: WosAppManifest,
      /**
       * Required when the manifest supports desktop; the control plane verifies it like Desktop does (S-37).
       * Exception (contracts 5.2.0): `build` is bundled in the Desktop binary (D16, S-40), so its release has both
       * desktopPackage and desktopPackageUrl null, source repo waronsaas/wos, and the manifest committed at
       * apps/desktop/src/apps/build/wos-app.json. A maintainer publishes it when that manifest's version changes.
       */
      desktopPackage: ModulePackage.nullable(),
      desktopPackageUrl: z.url().nullable(),
      source: z.object({ repo: z.string(), tag: z.string(), commit: GitSha }),
    }),
    response: AppRegistryEntry,
    errors: ["VALIDATION_FAILED", "CONFLICT"],
    summary: "Registers a released app version (versions only increase). Called by the wos module-release workflow.",
  }),
  yankAppRelease: route({
    method: "POST",
    path: "/v1/admin/app-releases/yank",
    auth: "maintainer",
    idempotent: true,
    params: None,
    query: None,
    body: z.object({ app: AppId, version: z.string(), reason: z.string().min(5) }),
    response: Ok,
    errors: ["NOT_FOUND", "CONFLICT"],
    summary: "AppReleaseMachine yank; clients roll back to their previous version.",
  }),
} as const;
export type AppRouteName = keyof typeof AppRoutes;

/** contracts 5.6.0 (B-0002-suite-shell): where the sign-in email link for clientKind web_app lands on HOSTS.app. */
export const WEB_APP_SIGNIN_CODE_PATH = "/sign-in/code" as const;

/** Public web host and API host, fixed by D5. */
export const HOSTS = {
  web: "https://waronsaas.com",
  api: "https://api.waronsaas.com",
  /** Authenticated wOS Web (waronsaas/product apps/web), separate from the public Sniper List site (Amendment 01). */
  app: "https://app.waronsaas.com",
  /** wOS Cloud's hosted wOS Core (waronsaas/product apps/api): the environment wOS clients talk to by default. */
  core: "https://core.waronsaas.com",
} as const;
