/** Server-side GitHub App operations. Phase 0 stubs; signatures are the contract with the control plane. */
import { NotImplementedError, type Changeset, type ProvenanceRecord } from "@waronsaas/contracts";

export interface AppCredentials {
  appId: string;
  privateKeyPem: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

export interface CommitIdentity {
  author: { name: string; email: string };
  trailers: Record<string, string>;
  message: string;
}

/** Builds blobs + tree (base_tree = parent tree) + commit via the Git Data API and moves/creates the ref. No git binary. */
export async function commitChangeset(
  creds: AppCredentials,
  repo: string,
  branch: string,
  changeset: Changeset,
  identity: CommitIdentity,
  options: { createBranch: boolean; expectedHeadSha: string | null },
): Promise<{ commitSha: string; treeSha: string }> {
  void creds, repo, branch, changeset, identity, options;
  throw new NotImplementedError("commitChangeset");
}

export async function openPullRequest(
  creds: AppCredentials,
  repo: string,
  input: { head: string; base: string; title: string; body: string; draft: boolean; labels: string[]; provenance: ProvenanceRecord | null },
): Promise<{ number: number; url: string }> {
  void creds, repo, input;
  throw new NotImplementedError("openPullRequest");
}

export async function setCommitStatus(
  creds: AppCredentials,
  repo: string,
  sha: string,
  input: { context: string; state: "pending" | "success" | "failure" | "error"; description: string; targetUrl: string | null },
): Promise<void> {
  void creds, repo, sha, input;
  throw new NotImplementedError("setCommitStatus");
}

export async function enableAutoMerge(creds: AppCredentials, repo: string, prNumber: number): Promise<void> {
  void creds, repo, prNumber;
  throw new NotImplementedError("enableAutoMerge");
}

/** git blob oids of the given paths at a commit (Trees API, recursive), for manifest verification. */
export async function blobOidsAt(
  creds: AppCredentials,
  repo: string,
  commit: string,
  paths: string[],
): Promise<Map<string, string | null>> {
  void creds, repo, commit, paths;
  throw new NotImplementedError("blobOidsAt");
}

export async function createIssue(
  creds: AppCredentials,
  repo: string,
  input: { title: string; body: string; labels: string[] },
): Promise<{ number: number; url: string }> {
  void creds, repo, input;
  throw new NotImplementedError("createIssue");
}

/** Constant-time HMAC-SHA256 check of X-Hub-Signature-256. */
export async function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string): Promise<boolean> {
  void secret, rawBody, signatureHeader;
  throw new NotImplementedError("verifyWebhookSignature");
}

export type GithubUserIdentity = { userId: number; login: string; createdAt: string; avatarUrl: string | null };

/** Device flow / web flow for LINKING a GitHub identity to an account (D8). Returns identity; token is discarded. */
export async function exchangeUserAuthorization(
  creds: AppCredentials,
  input: { deviceCode: string } | { code: string; redirectUri: string },
): Promise<{ status: "pending" | "denied" | "expired" } | { status: "ok"; user: GithubUserIdentity }> {
  void creds, input;
  throw new NotImplementedError("exchangeUserAuthorization");
}
