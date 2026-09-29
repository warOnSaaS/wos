/**
 * Test harness: a migrated scratch database (wos_app connection for the app, owner connection for
 * fixtures), the control plane wired with fakes for GitHub, mail and the other Wave 1 workstreams'
 * logic (their frozen signatures, simple behaviour), and API helpers.
 */
import { createHash, createHmac, generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";
import {
  AGENT_POLICY_V1,
  type AbuSpec,
  BuildGraph,
  CatalogEntry,
  DEFAULT_TOOLCHAIN_PATHS,
  type Changeset,
  type ContextManifest,
  type ContextPlan,
  FeatureContract,
  Inventory,
  type ProviderAttestation,
  REWARD_SCHEDULE_V1,
  Roadmap,
  type ReviewVerdict,
} from "@waronsaas/contracts";
import type { EligibilityInput, EligibilityResult } from "@waronsaas/agent-policy";
import { buildContext, type SnapshotReader } from "@waronsaas/context-engine";
import { gitBlobOid } from "@waronsaas/contracts/canonical";
import { matchesGlob } from "node:path";
import { renderServerDocument } from "../../src/domain/plans.js";
import postgres from "postgres";
import { vi } from "vitest";
import { createControlPlane } from "../../src/app.js";
import { DEFAULT_LOGIC, type Deps, type GithubPort, type GithubUserIdentity, type Logic, type OutboundMail } from "../../src/deps.js";
import {
  agentRunSigningPayload,
  computeManifestSha256,
  encodeDevicePublicKey,
  signChangeset,
  submissionSha256 as diffHash,
  sha256Of,
} from "@waronsaas/contracts/canonical";
import { createMigratedDb, type MigratedDb } from "../../../../packages/db/test/support/pg.js";

export { HAS_DB } from "../../../../packages/db/test/support/pg.js";

// Database scenarios run many requests; under a loaded full-suite run the 5 s default is too tight.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

export const WEBHOOK_SECRET = "test-webhook-secret";
export const CRON_SECRET = "test-cron-secret";
export const PRODUCT_REPO = "waronsaas/suite";
export const BASE_SHA = "b".repeat(40);

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
export const sha256 = (b: string | Buffer) => sha256Of(b);

export const REPO_MANIFEST = {
  schema: "wos-repo.v1",
  displayName: "warOnSaaS suite",
  products: [],
  defaultBranch: "main",
  stack: { language: "typescript", runtime: "node", packageManager: "npm" },
  install: ["npm", "ci", "--ignore-scripts"],
  verify: [{ id: "test", run: ["npm", "test"], timeoutSeconds: 600 }],
  protectedPaths: [".github/**", "wos.json"],
  lockfiles: ["package-lock.json"],
  toolchainPaths: [...DEFAULT_TOOLCHAIN_PATHS],
  generatedPaths: [],
  migrationsDir: null,
  maxChangesetBytes: 4_000_000,
};

export class FakeGithub implements GithubPort {
  heads = new Map<string, string>();
  files = new Map<string, Uint8Array>();
  commits: Array<{ repo: string; branch: string; sha: string; parent: string; trailers: Record<string, string>; message: string }> = [];
  prs: Array<{ repo: string; number: number; head: string; title: string; body: string; draft: boolean; labels: string[] }> = [];
  statuses: Array<{ repo: string; sha: string; context: string; state: string }> = [];
  branches = new Map<string, string>();
  closed: Array<{ repo: string; number: number }> = [];
  issues: Array<{ repo: string; title: string; labels: string[] }> = [];
  autoMerge: number[] = [];
  deviceGrants = new Map<string, { status: "pending" | "denied" | "expired" } | { status: "ok"; user: GithubUserIdentity }>();
  failCommits = 0;
  private n = 0;

  headOf(repo: string) {
    return this.heads.get(repo) ?? BASE_SHA;
  }
  putFile(repo: string, commit: string, path: string, content: string) {
    this.files.set(`${repo}@${commit}:${path}`, Buffer.from(content, "utf8"));
  }
  async commitChangeset(repo: string, branch: string, cs: Changeset, identity: { trailers: Record<string, string>; message: string }) {
    if (this.failCommits > 0) {
      this.failCommits--;
      throw new Error("GitHub 502");
    }
    const sha = sha1(`${repo}:${branch}:${cs.submissionSha256}:${this.n++}`);
    this.commits.push({ repo, branch, sha, parent: cs.parentCommit, trailers: identity.trailers, message: identity.message });
    // The new commit carries the parent's files plus the upserts (so later reads at the head work).
    for (const [k, v] of this.files) {
      const prefix = `${repo}@${cs.parentCommit}:`;
      if (k.startsWith(prefix)) this.files.set(`${repo}@${sha}:${k.slice(prefix.length)}`, v);
    }
    for (const f of cs.files) if (f.op === "upsert") this.files.set(`${repo}@${sha}:${f.path}`, Buffer.from(f.contentBase64, "base64"));
    return { commitSha: sha, treeSha: sha1(`tree:${sha}`) };
  }
  async openPullRequest(repo: string, input: { head: string; title: string; body: string; draft: boolean; labels: string[] }) {
    const number = 100 + this.prs.length;
    this.prs.push({ repo, number, head: input.head, title: input.title, body: input.body, draft: input.draft, labels: input.labels });
    return { number, url: `https://github.com/${repo}/pull/${number}` };
  }
  async setCommitStatus(repo: string, sha: string, input: { context: string; state: string }) {
    this.statuses.push({ repo, sha, context: input.context, state: input.state });
  }
  async enableAutoMerge(_repo: string, n: number) {
    this.autoMerge.push(n);
  }
  async blobOidsAt(_repo: string, _commit: string, paths: string[]) {
    return new Map(paths.map((p) => [p, null]));
  }
  async createIssue(repo: string, input: { title: string; labels: string[] }) {
    this.issues.push({ repo, title: input.title, labels: input.labels });
    const number = 500 + this.issues.length;
    return { number, url: `https://github.com/${repo}/issues/${number}` };
  }
  async verifyWebhookSignature(rawBody: string, header: string) {
    return header === `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")}`;
  }
  async exchangeUserAuthorization(input: { deviceCode: string } | { code: string; redirectUri: string }) {
    const key = "deviceCode" in input ? input.deviceCode : input.code;
    return this.deviceGrants.get(key) ?? { status: "pending" as const };
  }
  async startDeviceAuthorization() {
    return {
      deviceCode: `dc_${randomUUID()}`,
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    };
  }
  webAuthorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    return `https://github.com/login/oauth/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
  async getBranchHead(repo: string) {
    return this.headOf(repo);
  }
  async readFileAt(repo: string, commit: string, path: string) {
    if (path === "wos.json" && !this.files.has(`${repo}@${commit}:${path}`)) return Buffer.from(JSON.stringify(REPO_MANIFEST));
    // Integration glue: the real context engine requires the canonical documents a plan selects; the fake
    // repo serves a placeholder for any that a test did not put there.
    if (
      /^(features\/[^/]+\/(CONTRACT|BUILD-GRAPH)\.yaml|catalog\/[^/]+\.yaml|roadmaps\/[^/]+\/(ROADMAP|INVENTORY)\.yaml)$/.test(path) &&
      !this.files.has(`${repo}@${commit}:${path}`)
    )
      return Buffer.from(`# placeholder for ${path}\n`);
    return this.files.get(`${repo}@${commit}:${path}`) ?? null;
  }
  async listTreePaths(repo: string, commit: string) {
    const prefix = `${repo}@${commit}:`;
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }
  async createBranchAt(repo: string, branch: string, sha: string) {
    if (this.branches.has(`${repo}:${branch}`)) throw new Error(`branch ${branch} exists`);
    this.branches.set(`${repo}:${branch}`, sha);
  }
  async moveBranch(repo: string, branch: string, sha: string, mode: { expectedHeadSha: string } | { force: true }) {
    const cur = this.branches.get(`${repo}:${branch}`);
    if ("expectedHeadSha" in mode && cur !== mode.expectedHeadSha) throw new Error("expected head mismatch");
    this.branches.set(`${repo}:${branch}`, sha);
  }
  deleted: string[] = [];
  async deleteBranch(repo: string, branch: string) {
    this.deleted.push(`${repo}:${branch}`);
  }
  async closePullRequest(repo: string, number: number, _options: { comment: string; lock: boolean }) {
    this.closed.push({ repo, number });
  }
  async compareDiff(_repo: string, base: string, head: string) {
    return `diff ${base}..${head}`;
  }
  readonly teamReviews: Array<{ repo: string; prNumber: number; team: string }> = [];
  async requestTeamReview(repo: string, prNumber: number, team: string) {
    this.teamReviews.push({ repo, prNumber, team });
  }
}

export class FakeMailer {
  sent: OutboundMail[] = [];
  async send(mail: OutboundMail) {
    this.sent.push(mail);
    return { providerId: `re_${this.sent.length}` };
  }
  lastTo(email: string): { code: string; linkToken: string; requestId: string } {
    const m = [...this.sent].reverse().find((x) => x.to.toLowerCase() === email.toLowerCase());
    if (!m) throw new Error(`no mail to ${email}`);
    const code = /code: ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(m.text)![1]!;
    const url = new URL(/(https:\/\/\S+)/.exec(m.text)![1]!);
    return { code, linkToken: url.searchParams.get("t")!, requestId: url.searchParams.get("r")! };
  }
}

/** Stand-in for context-policy's checkEligibility (AGENT-POLICY.md section 5, simplified). */
export function fakeCheckEligibility(input: EligibilityInput): EligibilityResult {
  const role = AGENT_POLICY_V1.roles.find((r) => r.role === input.role)!;
  const reasons: string[] = [];
  if (input.account.suspended) reasons.push("account suspended");
  const ageDays = (Date.now() - Date.parse(input.account.githubAccountCreatedAt)) / 86_400_000;
  if (!input.account.isMaintainer && ageDays < role.eligibility.minGithubAccountAgeDays) reasons.push("GitHub account too new");
  const waive = input.bootstrapMode || input.account.isMaintainer;
  if (!waive && input.account.acceptedContributions < role.eligibility.minAcceptedContributions)
    reasons.push("not enough accepted contributions");
  const model = role.allowedModels
    .map((ref) => AGENT_POLICY_V1.models.find((m) => m.ref === ref)!)
    .find((m) => input.attestations.some((a) => a.provider === m.provider && a.installed && a.signedIn && a.models.includes(m.ref)));
  if (!model) reasons.push("no attested CLI for an allowed model");
  let independence: "independent" | "bootstrap_maintainer" | "bootstrap_self" = "independent";
  if (role.independence) {
    if (input.otherSlotReviewerId === input.account.id) reasons.push("already reviewing the other slot");
    if (input.subjectAuthorIds.includes(input.account.id)) {
      const self =
        input.bootstrapMode && input.account.isMaintainer && input.taskOpenHours >= AGENT_POLICY_V1.bootstrap.selfReviewAfterHours;
      if (self) independence = "bootstrap_self";
      else reasons.push("author of the subject");
    } else if (input.bootstrapMode && input.account.isMaintainer) independence = "bootstrap_maintainer";
    if (
      role.independence.maxReviewsOfSameAuthorPer7d > 0 &&
      input.reviewsOfSameAuthorLast7d >= role.independence.maxReviewsOfSameAuthorPer7d
    ) {
      reasons.push("reviewed this author too often");
    }
  }
  if (reasons.length > 0 || !model) return { eligible: false, reasons };
  const req = role.reasoning.required;
  return { eligible: true, independence, model, reasoning: req === "max" ? model.maxReasoning : req };
}

const parseWith =
  <T>(schema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  }) =>
  (text: string) => {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return { ok: false as const, errors: [{ path: "", message: "not JSON (test parser)" }] };
    }
    const r = schema.safeParse(v);
    return r.success
      ? { ok: true as const, value: r.data }
      : { ok: false as const, errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  };

export const FAKE_LOGIC: Logic = {
  checkEligibility: (input) => fakeCheckEligibility(input),
  checkManifestAgainstPlan: (m: ContextManifest, p: ContextPlan) => {
    const reasons: string[] = [];
    if (m.role !== p.role) reasons.push("role");
    if (m.source.commit !== p.source.commit || m.source.repo !== p.source.repo) reasons.push("source");
    if (m.reasoning !== p.reasoning) reasons.push("reasoning");
    if (m.task.id !== p.taskId) reasons.push("task");
    return reasons.length ? { ok: false, reasons } : { ok: true };
  },
  validateChangeset: (cs, ctx) => {
    const errors: Array<{ code: "OUT_OF_SCOPE" | "WORKFLOW_FILE"; path: string; message: string }> = [];
    const scopes = ctx.abu ? ctx.abu.scope.write : ctx.documentPaths;
    for (const f of cs.files) {
      if (f.path.startsWith(".github/workflows/")) errors.push({ code: "WORKFLOW_FILE", path: f.path, message: "workflow" });
      else if (!scopes.some((s) => (s.endsWith("/**") ? f.path.startsWith(s.slice(0, -2)) : f.path === s))) {
        errors.push({ code: "OUT_OF_SCOPE", path: f.path, message: "outside the write scope" });
      }
    }
    return { ok: errors.length === 0, errors };
  },
  computeRoundOutcome: ({ astra, fable, priorOpenFindingIds }) =>
    astra.verdict === "NO_MATERIAL_GAPS" && fable.verdict === "NO_MATERIAL_GAPS" && priorOpenFindingIds.length === 0
      ? { outcome: "consensus" }
      : {
          outcome: "gaps",
          openMaterialFindings:
            [...astra.findings, ...fable.findings].filter((f) => f.severity === "material").length + priorOpenFindingIds.length,
        },
  computeLedgerDrafts: () => [],
  parseRoadmapYaml: parseWith(Roadmap),
  parseInventoryYaml: parseWith(Inventory),
  parseCatalogEntryYaml: parseWith(CatalogEntry),
  parseFeatureContractYaml: parseWith(FeatureContract),
  parseBuildGraphYaml: parseWith(BuildGraph),
  validateRoadmap: () => [],
  validateBuildGraph: () => [],
};

/** The real Wave 1 implementations (context-policy, verification), exactly as in DEFAULT_LOGIC. */
export const REAL_WAVE1_LOGIC: Partial<Logic> = {
  checkEligibility: DEFAULT_LOGIC.checkEligibility,
  checkManifestAgainstPlan: DEFAULT_LOGIC.checkManifestAgainstPlan,
  validateChangeset: DEFAULT_LOGIC.validateChangeset,
};

// biome-ignore lint/suspicious/noExplicitAny: test responses are asserted field by field
export interface Response<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface Account {
  email: string;
  token: string;
  refresh: string;
  deviceId: string;
  id: string;
  key: KeyObject;
  handle: string | null;
}

export interface Harness {
  deps: Deps;
  app: ReturnType<typeof createControlPlane>;
  owner: postgres.Sql;
  github: FakeGithub;
  mailer: FakeMailer;
  violations: string[];
  db: MigratedDb;
  // biome-ignore lint/suspicious/noExplicitAny: test responses are asserted field by field
  call<T = any>(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; headers?: Record<string, string>; idem?: string | boolean },
  ): Promise<Response<T>>;
  signIn(email: string, clientKind?: "cli" | "desktop"): Promise<Account>;
  contributor(name: string, opts?: { maintainer?: boolean; githubAgeDays?: number; githubUserId?: number }): Promise<Account>;
  close(): Promise<void>;
}

let ipCounter = 1;
let ghCounter = 5000;

export async function createHarness(overrides: Partial<Logic> = {}): Promise<Harness> {
  const db = await createMigratedDb("wos_cp");
  const sql = postgres(db.appUrl, { max: 10, onnotice: () => {} });
  const owner = postgres(db.ownerUrl, { max: 4, onnotice: () => {} });
  const github = new FakeGithub();
  const mailer = new FakeMailer();
  const violations: string[] = [];
  const deps: Deps = {
    sql,
    config: {
      env: "test",
      webOrigin: "https://waronsaas.com",
      apiOrigin: "https://api.waronsaas.com",
      cronSecret: CRON_SECRET,
      tokenPepper: "test-pepper",
      ipHashSecret: "test-ip-secret",
      productRepo: PRODUCT_REPO,
      platformRepo: "waronsaas/waronsaas",
      cookieDomain: null,
      githubRetries: 1,
      appBotLogin: "waronsaas-wos[bot]",
    },
    github,
    mailer,
    // Wave 1 integration glue: the real Wave 1 packages replace the fakes (planning and rewards stay fake until Wave 2).
    logic: { ...FAKE_LOGIC, ...REAL_WAVE1_LOGIC, ...overrides },
    policy: AGENT_POLICY_V1,
    schedule: REWARD_SCHEDULE_V1,
    log: (level, message, fields) => {
      if (level === "error" && process.env.WOS_TEST_LOG) console.error(message, fields);
    },
    onContractViolation: (route, detail) => violations.push(`${route}: ${detail}`),
  };
  const app = createControlPlane(deps);

  const call: Harness["call"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.${ipCounter >> 8}.${ipCounter++ & 255}`,
      ...(opts.headers ?? {}),
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.idem) headers["idempotency-key"] = opts.idem === true ? randomUUID() : opts.idem;
    const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  const signIn: Harness["signIn"] = async (email, clientKind = "cli") => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = encodeDevicePublicKey(publicKey);
    const start = await call("POST", "/v1/auth/email/start", {
      body: { email, clientKind, deviceName: "test machine", devicePublicKey: raw },
    });
    if (start.status !== 202) throw new Error(`start ${start.status} ${JSON.stringify(start.body)}`);
    const mail = mailer.lastTo(email);
    const redeem = await call("POST", "/v1/auth/email/redeem", {
      body: { requestId: start.body.requestId, pollSecret: start.body.pollSecret, linkToken: null, code: mail.code },
    });
    if (redeem.status !== 200) throw new Error(`redeem ${redeem.status} ${JSON.stringify(redeem.body)}`);
    return {
      email,
      token: redeem.body.accessToken,
      refresh: redeem.body.refreshToken,
      deviceId: redeem.body.deviceId,
      id: redeem.body.me.id,
      key: privateKey,
      handle: null,
    };
  };

  const contributor: Harness["contributor"] = async (name, opts = {}) => {
    const acct = await signIn(`${name}@example.com`);
    const userId = opts.githubUserId ?? ghCounter++;
    const start = await call("POST", "/v1/me/github/link", { token: acct.token, body: { flow: "device" } });
    if (start.status !== 200) throw new Error(`link ${start.status} ${JSON.stringify(start.body)}`);
    const [req] = await owner<{ device_code: string }[]>`select device_code from wos.github_link_requests where id = ${start.body.linkId}`;
    github.deviceGrants.set(req!.device_code, {
      status: "ok",
      user: {
        userId,
        login: name,
        createdAt: new Date(Date.now() - (opts.githubAgeDays ?? 400) * 86_400_000).toISOString(),
        avatarUrl: null,
      },
    });
    const poll = await call("POST", "/v1/me/github/link/poll", { token: acct.token, body: { linkId: start.body.linkId } });
    if (poll.body?.status !== "linked") throw new Error(`poll ${poll.status} ${JSON.stringify(poll.body)}`);
    if (opts.maintainer) await owner`insert into wos.account_roles (account_id, role) values (${acct.id}, 'maintainer')`;
    const now = new Date().toISOString();
    const providers: ProviderAttestation[] = [
      {
        provider: "claude_cli",
        installed: true,
        cliVersion: "2.1.284",
        signedIn: true,
        authMethod: "claude.ai",
        models: ["opus", "fable"],
        checkedAt: now,
      },
      {
        provider: "codex_cli",
        installed: true,
        cliVersion: "0.155.0",
        signedIn: true,
        authMethod: "chatgpt",
        models: ["astra"],
        checkedAt: now,
      },
    ];
    const att = await call("POST", "/v1/me/attestations", { token: acct.token, idem: true, body: { deviceId: acct.deviceId, providers } });
    if (att.status !== 200) throw new Error(`attest ${att.status} ${JSON.stringify(att.body)}`);
    return { ...acct, handle: poll.body.me.handle };
  };

  return {
    deps,
    app,
    owner,
    github,
    mailer,
    violations,
    db,
    call,
    signIn,
    contributor,
    async close() {
      await sql.end({ timeout: 5 });
      await owner.end({ timeout: 5 });
      await db.drop();
    },
  };
}

// ---------------------------------------------------------------------------------------------- fixtures

export interface SeededFeature {
  featureId: string;
  contractDocId: string;
  targetId: string;
  abus: Map<string, string>;
}

/** A merged roadmap (salesforce: one capability) + a merged contract with ABUs, inserted directly as the owner. */
export async function seedFeature(
  owner: postgres.Sql,
  opts: {
    feature?: string;
    target?: string;
    abus: Array<{
      n: string;
      write: string[];
      dependsOn?: string[];
      resources?: Array<{ key: string; mode: "exclusive" | "shared" }>;
      size?: 1 | 2 | 3 | 5 | 8;
    }>;
  },
): Promise<SeededFeature> {
  const feature = opts.feature ?? "contacts";
  const target = opts.target ?? "salesforce";
  const [t] = await owner<{ id: string; repo: string }[]>`select id, repo_full_name as repo from wos.targets where slug = ${target}`;
  const repo = t!.repo;
  const rid = randomUUID();
  await owner`insert into wos.documents (id, kind, target_id, version, state, branch, merged_sha, merged_at, repo_full_name)
              values (${rid}, 'roadmap', ${t!.id}, 1, 'merged', ${`wos/roadmap/${target}/v1`}, ${"c".repeat(40)}, now(), ${repo})
              on conflict do nothing`;
  const [roadmapDoc] = await owner<
    { id: string }[]
  >`select id from wos.documents where kind = 'roadmap' and target_id = ${t!.id} order by version limit 1`;
  const [cap] = await owner<{ id: string }[]>`
    insert into wos.capabilities (target_id, key, title, summary, position, weight_bp, weight_rationale, mapped, roadmap_version)
    values (${t!.id}, 'crm', 'CRM', 'Customer records', 0, 10000, ${"The whole app for this test: one capability carries all of the weight."}, true, 1)
    on conflict (target_id, key) do update set mapped = true returning id`;
  const featureId = randomUUID();
  await owner`insert into wos.catalog_features (id, key, title, summary, state, created_by_document_id, repo_full_name)
              values (${featureId}, ${feature}, ${feature}, 'A shared feature', 'active', ${roadmapDoc!.id}, ${repo})`;
  const [afCount] = await owner<{ n: number }[]>`select count(*)::int as n from wos.app_features where capability_id = ${cap!.id}`;
  await owner`insert into wos.app_features (target_id, catalog_feature_id, capability_id, state, weight_bp, weight_rationale, phase, first_roadmap_version, roadmap_version)
              values (${t!.id}, ${featureId}, ${cap!.id}, 'specified', ${afCount!.n === 0 ? 10000 : 1}, ${"All of the capability for this test fixture, by construction."}, 'core', 1, 1)`;
  const contractDocId = randomUUID();
  await owner`insert into wos.documents (id, kind, catalog_feature_id, version, state, branch, merged_sha, merged_at, repo_full_name)
              values (${contractDocId}, 'feature_contract', ${featureId}, 1, 'merged', ${`wos/feature/${feature}/v1`}, ${"d".repeat(40)}, now(), ${repo})`;
  await owner`update wos.catalog_features set current_contract_document_id = ${contractDocId} where id = ${featureId}`;
  const reqId = randomUUID();
  await owner`insert into wos.requirements (id, document_id, catalog_feature_id, key, kind, statement) values (${reqId}, ${contractDocId}, ${featureId}, 'R-001', 'functional', 'It MUST work.')`;
  await owner`insert into wos.requirement_profiles (document_id, target_id, requirement_id) values (${contractDocId}, ${t!.id}, ${reqId})`;
  const abus = new Map<string, string>();
  for (const a of opts.abus) {
    const key = `${feature}#${a.n}`;
    const spec: AbuSpec = {
      key,
      title: `Unit ${a.n}`,
      objective: "Build this unit so that its acceptance checks pass.",
      requirements: ["R-001"],
      dependsOn: (a.dependsOn ?? []).map((d) => `${feature}#${d}`),
      sizePoints: a.size ?? 2,
      scope: { write: a.write, read: [] },
      resources: a.resources ?? [],
      acceptance: { checks: [{ id: "unit", run: ["npm", "test"] }], tests: [] },
    };
    const id = randomUUID();
    abus.set(a.n, id);
    const pending = (a.dependsOn ?? []).length > 0;
    await owner`insert into wos.abus (id, catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens, repo_full_name)
                values (${id}, ${featureId}, ${contractDocId}, ${key}, ${spec.title}, ${spec.sizePoints}, ${pending ? "pending_dependencies" : "ready"},
                        ${owner.json(spec as never)}, 1000, ${repo})`;
    await owner`insert into wos.abu_requirements (abu_id, requirement_id) values (${id}, ${reqId})`;
    await owner`insert into wos.tasks (kind, state, role, abu_id, catalog_feature_id) values ('abu_build', ${pending ? "blocked" : "open"}, 'builder', ${id}, ${featureId})`;
  }
  for (const a of opts.abus)
    for (const d of a.dependsOn ?? [])
      await owner`insert into wos.abu_dependencies (abu_id, depends_on_abu_id) values (${abus.get(a.n)!}, ${abus.get(d)!})`;
  return { featureId, contractDocId, targetId: t!.id, abus };
}

// ---------------------------------------------------------------------------------------------- client-side helpers

/**
 * Wave 1 integration glue: manifests are built by the REAL context engine (context-policy) over the fake
 * GitHub's files and the control plane's own server-document renderer, so the real checkManifestAgainstPlan
 * accepts them. `kind` is kept for call-site readability; the engine takes the kind from the plan.
 */
export async function manifestFor(h: Harness, plan: ContextPlan, _kind?: string): Promise<ContextManifest> {
  const repo = plan.source.repo;
  const commit = plan.source.commit;
  const reader: SnapshotReader = {
    async readFile(path) {
      const bytes = await h.github.readFileAt(repo, commit, path);
      return bytes ? { bytes: new Uint8Array(bytes), gitBlobOid: gitBlobOid(bytes) } : null;
    },
    async listFiles(glob) {
      return (await h.github.listTreePaths(repo, commit)).filter((p) => matchesGlob(p, glob)).sort();
    },
    async readServerDocument(ref) {
      const text = await h.owner.begin(async (tx) => {
        await tx`select set_config('wos.actor_kind', 'system', true)`;
        return renderServerDocument(tx as unknown as Parameters<typeof renderServerDocument>[0], h.deps, ref);
      });
      if (text === null) throw new Error(`no server document ${ref}`);
      return new TextEncoder().encode(text);
    },
    async readLocalDocument() {
      return null;
    },
  };
  const built = await buildContext(plan, reader, h.deps.policy);
  return built.manifest;
}

export function signedRun(key: KeyObject, plan: ContextPlan, leaseId: string, deviceId: string, manifestSha256: string) {
  const now = new Date().toISOString();
  const rec = {
    schema: "wos-agent-run.v1" as const,
    leaseId,
    deviceId,
    manifestSha256,
    provider: plan.provider,
    cliVersion: "2.1.284",
    authMethod: "claude.ai",
    modelIdRequested: plan.modelId,
    modelIdReported: plan.modelId,
    reasoningRequested: plan.reasoning,
    argvSha256: sha256("argv"),
    startedAt: now,
    endedAt: now,
    exitCode: 0,
    transcriptSha256: sha256("transcript"),
    outputSha256: sha256("output"),
    usage: { inputTokens: 1, outputTokens: 1 },
    signature: "",
  };
  return { ...rec, signature: sign(null, agentRunSigningPayload(rec), key).toString("base64") };
}

export function signedChangeset(
  key: KeyObject,
  input: {
    taskId: string;
    leaseId: string;
    deviceId: string;
    parentCommit: string;
    manifestSha256: string;
    files: Array<{ path: string; content: string }>;
    summary?: Changeset["summary"];
  },
): Changeset {
  const files = input.files.map((f) => ({
    op: "upsert" as const,
    path: f.path,
    mode: "100644" as const,
    contentBase64: Buffer.from(f.content).toString("base64"),
    sha256: sha256(f.content),
    bytes: Buffer.byteLength(f.content),
  }));
  const submissionSha256 = diffHash(input.parentCommit, files);
  const cs = {
    schema: "wos-changeset.v1" as const,
    taskId: input.taskId,
    leaseId: input.leaseId,
    deviceId: input.deviceId,
    parentCommit: input.parentCommit,
    manifestSha256: input.manifestSha256,
    submissionSha256,
    files,
    summary: input.summary ?? {
      schema: "build-summary.v1",
      summary: "Implemented the unit.",
      requirementsCovered: ["R-001"],
      responses: [],
      abuConcerns: [],
    },
    localVerification: [],
  };
  return signChangeset(cs, key);
}

export const verdict = (v: "NO_MATERIAL_GAPS" | "MATERIAL_GAPS", priorFindings: ReviewVerdict["priorFindings"] = []): ReviewVerdict => ({
  schema: "review-verdict.v1",
  verdict: v,
  summary: v === "NO_MATERIAL_GAPS" ? "No material gaps." : "One material gap.",
  findings:
    v === "MATERIAL_GAPS"
      ? [
          {
            localId: "f1",
            severity: "material",
            category: "test_gap",
            title: "Missing test",
            detail: "The unit has no test for the error path.",
            evidence: [],
            suggestedResolution: "Add it.",
          },
        ]
      : [],
  priorFindings,
});

export function webhookHeaders(event: string, body: unknown, delivery: string = randomUUID()) {
  const raw = JSON.stringify(body);
  return {
    "x-github-event": event,
    "x-github-delivery": delivery,
    "x-hub-signature-256": `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")}`,
  };
}
