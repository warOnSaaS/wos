/**
 * Everything the control plane talks to, injected. Production wiring is `defaultDeps(env)`; tests pass
 * fakes. The pure logic of other workstreams (agent-policy, context-engine, verification, planning,
 * rewards) is injected too, so the control plane can be tested against fakes until those land.
 */
import { checkEligibility } from "@waronsaas/agent-policy";
import { checkManifestAgainstPlan } from "@waronsaas/context-engine";
import {
  AGENT_POLICY_V1,
  type AgentPolicyDocument,
  type Changeset,
  HOSTS,
  NotImplementedError,
  PLATFORM_REPO,
  PRODUCT_REPO,
  type ProvenanceRecord,
  REWARD_SCHEDULE_V1,
  type Surface,
  type RewardSchedule,
} from "@waronsaas/contracts";
import type { Sql } from "@waronsaas/db";
import * as githubApp from "@waronsaas/github/app";
import {
  computeRoundOutcome,
  parseBuildGraphYaml,
  parseCatalogEntryYaml,
  parseFeatureContractYaml,
  parseInventoryYaml,
  parseRoadmapYaml,
  validateBuildGraph,
  validateFeatureContract,
  validateRoadmap,
} from "@waronsaas/planning";
import { computeLedgerDrafts, computeReleaseDrafts } from "@waronsaas/rewards";
import { validateChangeset } from "@waronsaas/verification";
import { ApiFailure } from "./errors.js";
import type { AppKeys } from "./domain/app-keys.js";

export type GithubUserIdentity = githubApp.GithubUserIdentity;
export type CommitIdentity = githubApp.CommitIdentity;

/**
 * The GitHub operations the control plane needs, mapped 1:1 onto `@waronsaas/github/app` (github-build),
 * with the App credentials bound.
 */
export interface GithubPort {
  commitChangeset(
    repo: string,
    branch: string,
    changeset: Changeset,
    identity: CommitIdentity,
    options: { createBranch: boolean; expectedHeadSha: string | null },
  ): Promise<{ commitSha: string; treeSha: string }>;
  openPullRequest(
    repo: string,
    input: {
      head: string;
      base: string;
      title: string;
      body: string;
      draft: boolean;
      labels: string[];
      provenance: ProvenanceRecord | null;
    },
  ): Promise<{ number: number; url: string }>;
  setCommitStatus(
    repo: string,
    sha: string,
    input: { context: string; state: "pending" | "success" | "failure" | "error"; description: string; targetUrl: string | null },
  ): Promise<void>;
  enableAutoMerge(repo: string, prNumber: number): Promise<void>;
  blobOidsAt(repo: string, commit: string, paths: string[]): Promise<Map<string, string | null>>;
  createIssue(repo: string, input: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): Promise<boolean>;
  exchangeUserAuthorization(
    input: { deviceCode: string } | { code: string; redirectUri: string },
  ): Promise<{ status: "pending" | "denied" | "expired" } | { status: "ok"; user: GithubUserIdentity }>;

  // ---- ratified in contracts 3.0.0 (B-0001-control-plane decision); github-build implements them ----
  startDeviceAuthorization(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
    expiresInSeconds: number;
  }>;
  webAuthorizeUrl(input: { state: string; redirectUri: string }): string;
  /** Current head commit of a branch (pins an attempt's base, BUILD-PROTOCOL.md section 3 step 6). */
  getBranchHead(repo: string, branch: string): Promise<string>;
  /** File bytes at a commit, or null when absent. */
  readFileAt(repo: string, commit: string, path: string): Promise<Uint8Array | null>;
  /** Every blob path at a commit. */
  listTreePaths(repo: string, commit: string): Promise<string[]>;
  /** Creates a branch at a commit (the official PR branch). */
  createBranchAt(repo: string, branch: string, sha: string): Promise<void>;
  /** Moves an existing branch (expected-head check, or force). */
  moveBranch(repo: string, branch: string, sha: string, mode: { expectedHeadSha: string } | { force: true }): Promise<void>;
  deleteBranch(repo: string, branch: string): Promise<void>;
  closePullRequest(repo: string, prNumber: number, options: { comment: string; lock: boolean }): Promise<void>;
  /** Unified diff base..head. */
  compareDiff(repo: string, base: string, head: string): Promise<string>;
  /** contracts 3.1.0 (B-0005-control-plane): request review from an org team, e.g. "maintainers". */
  requestTeamReview(repo: string, prNumber: number, teamSlug: string): Promise<void>;
}

export interface OutboundMail {
  template: "signin" | "progress_digest" | "lease_expiring" | "review_assigned";
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<{ providerId: string | null }>;
}

/** Pure logic owned by other workstreams, injected so fakes can stand in until each lands. */
/** The ratified sixth argument of validateBuildGraph (FEATURE-CONTRACT.md section 9, B-0001-planning). */
export interface BuildGraphValidationContext {
  repositories: ReadonlyMap<string, "platform" | "product">;
  contractRepo: string;
  surfacesInScope?: ReadonlyMap<string, Surface[]>;
}

export interface Logic {
  checkEligibility: typeof checkEligibility;
  checkManifestAgainstPlan: typeof checkManifestAgainstPlan;
  validateChangeset: typeof validateChangeset;
  computeRoundOutcome: typeof computeRoundOutcome;
  computeLedgerDrafts: typeof computeLedgerDrafts;
  computeReleaseDrafts: typeof computeReleaseDrafts;
  parseRoadmapYaml: typeof parseRoadmapYaml;
  parseInventoryYaml: typeof parseInventoryYaml;
  parseCatalogEntryYaml: typeof parseCatalogEntryYaml;
  parseFeatureContractYaml: typeof parseFeatureContractYaml;
  parseBuildGraphYaml: typeof parseBuildGraphYaml;
  validateRoadmap: typeof validateRoadmap;
  /** FEATURE-CONTRACT.md section 9: the optional sixth argument (ratified at 4.2.0; planning implements it). */
  validateBuildGraph: (
    ...args: [...Parameters<typeof validateBuildGraph>, BuildGraphValidationContext?]
  ) => ReturnType<typeof validateBuildGraph>;
  /** contracts 4.2.0 (B-0002-planning), integration glue. */
  validateFeatureContract: typeof validateFeatureContract;
}

export const DEFAULT_LOGIC: Logic = {
  checkEligibility,
  checkManifestAgainstPlan,
  validateChangeset,
  computeRoundOutcome,
  computeLedgerDrafts,
  computeReleaseDrafts,
  parseRoadmapYaml,
  parseInventoryYaml,
  parseCatalogEntryYaml,
  parseFeatureContractYaml,
  parseBuildGraphYaml,
  validateRoadmap,
  validateBuildGraph,
  validateFeatureContract,
};

export interface Config {
  env: "production" | "preview" | "local" | "test";
  /** https://waronsaas.com: the only CORS origin, and the email links of every client kind except web_app. */
  webOrigin: string;
  /**
   * https://app.waronsaas.com (HOSTS.app): wOS Web, where a web_app sign-in link lands (WEB_APP_SIGNIN_CODE_PATH,
   * S-43). Never a CORS origin: wOS Web calls the control plane server to server only.
   */
  appOrigin: string;
  /** https://api.waronsaas.com: OAuth callback base. */
  apiOrigin: string;
  cronSecret: string;
  /** HMAC key for every stored token hash (SESSION_TOKEN_PEPPER). */
  tokenPepper: string;
  /** HMAC key for daily-salted IP hashes (IP_HASH_SECRET). */
  ipHashSecret: string;
  productRepo: string;
  platformRepo: string;
  /** Retry budget for GitHub calls made inside a request. */
  githubRetries: number;
  /** Login of the wOS GitHub App's bot user: the only allowed PR author (S-18). */
  appBotLogin: string;
}

export type Logger = (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;

export interface Deps {
  /** Connection as wos_app (NOBYPASSRLS). Never the owner. */
  sql: Sql;
  config: Config;
  github: GithubPort;
  mailer: Mailer;
  logic: Logic;
  policy: AgentPolicyDocument;
  schedule: RewardSchedule;
  log: Logger;
  /**
   * Wave 3 (Amendment 01): the environment-token signing keys and the module-signing public keys the registry
   * re-verifies releases with (`appKeysFromEnv`). Absent: no token can be minted and no desktop package published.
   */
  appKeys?: AppKeys;
  /** Downloads a module bundle once, at publish, to verify it and store its sha256 (default: global fetch, https only). */
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  /**
   * Test hook: when set, the router reports every error code a handler returns that the route's
   * contract does not list, instead of silently sending it.
   */
  onContractViolation?: (route: string, detail: string) => void;
}

export function configFromEnv(env: Readonly<Record<string, string | undefined>>): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`wOS control plane: environment variable ${k} is required`);
    return v;
  };
  const wosEnv = (env.WOS_ENV ?? "local") as Config["env"];
  const webOrigin = env.WEB_ORIGIN ?? "https://waronsaas.com";
  return {
    env: wosEnv,
    webOrigin,
    appOrigin: env.APP_ORIGIN ?? HOSTS.app,
    apiOrigin: env.API_ORIGIN ?? "https://api.waronsaas.com",
    cronSecret: need("CRON_SECRET"),
    tokenPepper: need("SESSION_TOKEN_PEPPER"),
    ipHashSecret: need("IP_HASH_SECRET"),
    productRepo: env.PRODUCT_REPO ?? PRODUCT_REPO,
    platformRepo: PLATFORM_REPO,
    githubRetries: 2,
    appBotLogin: `${env.GITHUB_APP_SLUG ?? "waronsaas-wos"}[bot]`,
  };
}

/** Production adapter over @waronsaas/github/app. Operations missing from that package fail with UPSTREAM_GITHUB. */
export function githubFromEnv(env: Readonly<Record<string, string | undefined>>): GithubPort {
  const creds: githubApp.AppCredentials = {
    appId: env.GITHUB_APP_ID ?? "",
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY ?? "",
    webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "",
    clientId: env.GITHUB_APP_CLIENT_ID ?? "",
    clientSecret: env.GITHUB_APP_CLIENT_SECRET ?? "",
  };
  const upstream = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NotImplementedError) throw new ApiFailure("UPSTREAM_GITHUB", err.message);
      throw err;
    }
  };
  return {
    commitChangeset: (repo, branch, changeset, identity, options) =>
      upstream(() => githubApp.commitChangeset(creds, repo, branch, changeset, identity, options)),
    openPullRequest: (repo, input) => upstream(() => githubApp.openPullRequest(creds, repo, input)),
    setCommitStatus: (repo, sha, input) => upstream(() => githubApp.setCommitStatus(creds, repo, sha, input)),
    enableAutoMerge: (repo, n) => upstream(() => githubApp.enableAutoMerge(creds, repo, n)),
    blobOidsAt: (repo, commit, paths) => upstream(() => githubApp.blobOidsAt(creds, repo, commit, paths)),
    createIssue: (repo, input) => upstream(() => githubApp.createIssue(creds, repo, input)),
    verifyWebhookSignature: async (rawBody, header) => {
      try {
        return await githubApp.verifyWebhookSignature(creds.webhookSecret, rawBody, header);
      } catch {
        return false;
      }
    },
    exchangeUserAuthorization: (input) => upstream(() => githubApp.exchangeUserAuthorization(creds, input)),
    // Wave 1 integration glue: the ratified github/app functions now exist, so they are called directly.
    startDeviceAuthorization: () => upstream(() => githubApp.startDeviceAuthorization(creds)),
    webAuthorizeUrl: ({ state, redirectUri }) => githubApp.webAuthorizeUrl(creds, { state, redirectUri }),
    getBranchHead: (repo, branch) =>
      upstream(async () => {
        const sha = await githubApp.getBranchHead(creds, repo, branch);
        if (sha === null) throw new ApiFailure("UPSTREAM_GITHUB", `branch ${branch} not found in ${repo}`);
        return sha;
      }),
    readFileAt: (repo, commit, path) => upstream(() => githubApp.readFileAt(creds, repo, commit, path)),
    listTreePaths: (repo, commit) => upstream(() => githubApp.listTreePaths(creds, repo, commit)),
    createBranchAt: (repo, branch, sha) => upstream(async () => void (await githubApp.createBranchAt(creds, repo, branch, sha))),
    moveBranch: (repo, branch, sha, mode) => upstream(async () => void (await githubApp.moveBranch(creds, repo, branch, sha, mode))),
    deleteBranch: (repo, branch) => upstream(async () => void (await githubApp.deleteBranch(creds, repo, branch))),
    closePullRequest: (repo, n, options) => upstream(() => githubApp.closePullRequest(creds, repo, n, options)),
    compareDiff: (repo, base, head) => upstream(() => githubApp.compareDiff(creds, repo, base, head)),
    requestTeamReview: (repo, n, team) => upstream(() => githubApp.requestTeamReview(creds, repo, n, team)),
  };
}

/** Resend over HTTPS from notify.waronsaas.com (D5, D8). Without RESEND_API_KEY mail is dropped with a warning (local only). */
export function resendMailer(env: Readonly<Record<string, string | undefined>>, log: Logger): Mailer {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM ?? "warOnSaaS <signin@notify.waronsaas.com>";
  return {
    async send(mail) {
      if (!key) {
        log("warn", "RESEND_API_KEY not set: email not sent", { template: mail.template });
        return { providerId: null };
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
      const body = (await res.json()) as { id?: string };
      return { providerId: body.id ?? null };
    },
  };
}

export function consoleLogger(): Logger {
  return (level, message, fields) => {
    const line = JSON.stringify({ level, message, ...fields });
    if (level === "error") console.error(line);
    else console.log(line);
  };
}

export function defaultPolicyAndSchedule(): { policy: AgentPolicyDocument; schedule: RewardSchedule } {
  return { policy: AGENT_POLICY_V1, schedule: REWARD_SCHEDULE_V1 };
}
