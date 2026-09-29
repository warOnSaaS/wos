/**
 * @waronsaas/github (owner: github-build workstream).
 *   "@waronsaas/github/app"   server side: GitHub App auth, Git Data API commits, PRs, statuses, webhooks.
 *   "@waronsaas/github/local" client side: git CLI worktrees and changeset capture.
 * The root entry only re-exports shared naming rules so both sides agree.
 */
/** Pre-qualification refs: App-only, never a PR, deleted after the PR opens (BUILD-PROTOCOL.md). */
export const CANDIDATE_BRANCH_PREFIX = "wos/candidate/" as const;
export const ROADMAP_BRANCH_PREFIX = "wos/roadmap/" as const;
export const FEATURE_BRANCH_PREFIX = "wos/feature/" as const;
export const QUALIFIED_STATUS_CONTEXT = "wos/qualified" as const;
export const CONSENSUS_STATUS_CONTEXT = "wos/consensus" as const;
export const VERIFY_CHECK_NAME = "wos-verify" as const;

export const candidateBranch = (attemptId: string) => `${CANDIDATE_BRANCH_PREFIX}${attemptId}`;
export const roadmapBranch = (target: string, version: number) => `${ROADMAP_BRANCH_PREFIX}${target}/v${version}`;
export const featureBranch = (feature: string, version: number) => `${FEATURE_BRANCH_PREFIX}${feature}/v${version}`;

/** GitHub noreply address used as commit author so contributions attribute to the contributor. */
export const noreplyEmail = (githubUserId: number, login: string) => `${githubUserId}+${login}@users.noreply.github.com`;

/**
 * Official PR branch (D9: `wos/<unit-id>`), created by the App only after qualification, pointing at
 * the exact reviewed candidate commit. Unit id = ABU key with '#' -> '-', plus the first 8 hex of
 * the attempt id so retries of one ABU never collide. e.g. "wos/crm.contacts-04-0192ab3c".
 */
export const officialBranch = (abuKey: string, attemptId: string) =>
  `wos/${abuKey.replace("#", "-")}-${attemptId.replace(/-/g, "").slice(0, 8)}`;

/** Commit author for every official commit; the contributor is credited via Co-authored-by (D9). */
export const APP_COMMIT_AUTHOR_NAME = "waronsaas-wos[bot]" as const;
export const coAuthoredBy = (githubUserId: number, login: string) =>
  `Co-authored-by: ${login} <${githubUserId}+${login}@users.noreply.github.com>`;

/**
 * RFC 8785 canonical JSON and its sha256, shared by ./app (provenance) and the orchestrator
 * (submission hash, signatures). Should move to @waronsaas/contracts (blockers/B-0002).
 */
export { canonicalJson, canonicalSha256, gitBlobOid, sha256Prefixed } from "./internal/hash.js";
