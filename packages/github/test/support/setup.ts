import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Changeset, ChangesetFile } from "@waronsaas/contracts";
import { configureGithubApp, type AppCredentials } from "../../src/app/index.js";
import { sha256Of } from "@waronsaas/contracts/canonical";
import { FakeGithub } from "./fake-github.js";

export const API = "https://api.github.test";
export const OAUTH = "https://github.test";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `wos-${prefix}-`));
}

export function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

/** Writes files (path -> content; content ending in "\u0000x" marks executable) and commits them. Returns the commit sha. */
export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    const exec = content.endsWith("\u0000x");
    writeFileSync(full, exec ? content.slice(0, -2) : content);
    if (exec) chmodSync(full, 0o755);
  }
}

export function makeUpstream(files: Record<string, string>): { dir: string; base: string } {
  const dir = tempDir("upstream");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  writeFiles(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}

let keys: { privateKey: string; publicKey: string } | null = null;

export function makeApp(): { creds: AppCredentials; fake: FakeGithub } {
  keys ??= generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const { privateKey, publicKey } = keys;
  const creds: AppCredentials = {
    appId: "123456",
    privateKeyPem: privateKey,
    webhookSecret: "whsec-test",
    clientId: "Iv1.fakeclient",
    clientSecret: "fake-client-secret",
  };
  const fake = new FakeGithub({
    appId: creds.appId,
    publicKeyPem: publicKey,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    apiBase: API,
    oauthBase: OAUTH,
  });
  configureGithubApp({ fetch: fake.fetch, apiBaseUrl: API, oauthBaseUrl: OAUTH });
  return { creds, fake };
}

export function upsert(path: string, content: string | Buffer, mode: "100644" | "100755" = "100644"): ChangesetFile {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  return { op: "upsert", path, mode, contentBase64: bytes.toString("base64"), sha256: sha256Of(bytes), bytes: bytes.byteLength };
}

export function del(path: string): ChangesetFile {
  return { op: "delete", path };
}

const ZERO = `sha256:${"0".repeat(64)}`;

export function changeset(parentCommit: string, files: ChangesetFile[]): Changeset {
  return {
    schema: "wos-changeset.v1",
    taskId: "0192ab3c-0000-7000-8000-000000000001",
    leaseId: "0192ab3c-0000-7000-8000-000000000002",
    deviceId: "0192ab3c-0000-7000-8000-000000000003",
    parentCommit,
    manifestSha256: ZERO,
    submissionSha256: ZERO,
    files,
    summary: { schema: "build-summary.v1", summary: "fixture", requirementsCovered: [], responses: [], abuConcerns: [] },
    localVerification: [],
    signature: "fixture",
  };
}
