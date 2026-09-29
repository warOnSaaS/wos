/**
 * @waronsaas/verification — deterministic scope/diff validation shared by client, server and CI
 * (owner: verification workstream). Pure functions only (node:crypto for hashing and Ed25519).
 */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type {
  AbuSpec,
  Changeset,
  ChangesetErrorCode,
  ChangesetFile,
  ChangesetValidation,
  RepoManifest,
  WriteScope,
} from "@waronsaas/contracts";
import { canonicalJson } from "./jcs.js";
import { fold, inScope, matchesDeny, parentDirs, pathProblem } from "./paths.js";
import { scanForSecrets } from "./secrets.js";

export { canonicalJson } from "./jcs.js";
export { fold, inScope, matchesDeny, pathProblem } from "./paths.js";
export { SECRET_PATTERNS, scanForSecrets, type SecretHit, type SecretPattern } from "./secrets.js";
export { lintProductWorkflow, type WorkflowLintIssue } from "./workflow-lint.js";

/** True when two write scopes can touch the same path (prefix algebra, BUILD-PROTOCOL.md). */
export function scopesOverlap(a: WriteScope, b: WriteScope): boolean {
  const base = (s: string) => (s.endsWith("/**") ? { prefix: s.slice(0, -3), tree: true } : { prefix: s, tree: false });
  const x = base(a);
  const y = base(b);
  if (x.prefix === y.prefix) return true;
  if (x.tree && y.prefix.startsWith(`${x.prefix}/`)) return true;
  if (y.tree && x.prefix.startsWith(`${y.prefix}/`)) return true;
  return false;
}

export interface ScopeContext {
  kind: "abu" | "roadmap" | "feature_contract";
  abu: AbuSpec | null;
  /** For documents: the only paths the author may write. */
  documentPaths: WriteScope[];
  repoManifest: RepoManifest;
  /** Paths that exist at the parent commit (to validate deletes and case collisions). */
  existingPaths: ReadonlySet<string>;
}

/** The API body limit (BUILD-PROTOCOL.md section 6); `wos.json` may only lower it. */
export const HARD_MAX_CHANGESET_BYTES = 4_000_000;
export const MAX_CHANGESET_FILES = 500;

/**
 * Protected regardless of what `wos.json` says (a manifest that forgot them must not open the door).
 * `.gitmodules`/`.gitattributes` change how every checkout materialises the tree (submodules, filters,
 * eol), so what reviewers read could differ from what CI builds.
 */
export const ALWAYS_PROTECTED: readonly string[] = [".github/**", "wos.json"];
const GIT_META_BASENAMES = new Set([".gitmodules", ".gitattributes"]);
const WORKFLOWS = ".github/workflows/**";
/** Lockfile names treated as lockfiles even when `wos.json` does not list them (nested workspaces). */
const LOCKFILE_BASENAMES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"]);

export const sha256Hex = (data: Uint8Array | string) => `sha256:${createHash("sha256").update(data).digest("hex")}`;

type FileEntry = { path: string; op: "delete" } | { path: string; op: "upsert"; mode: string; sha256: string };

/** The diff hash: sha256 of JCS {parentCommit, files: [{path, op, mode, sha256}] sorted by path}. Deletes carry path and op only. */
export function computeSubmissionSha256(parentCommit: string, files: readonly ChangesetFile[]): string {
  const entries: FileEntry[] = files
    .map(
      (f): FileEntry =>
        f.op === "upsert" ? { path: f.path, op: "upsert", mode: f.mode, sha256: f.sha256 } : { path: f.path, op: "delete" },
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(canonicalJson({ parentCommit, files: entries }));
}

/** Bytes the device key signs: JCS of the changeset without `signature`, each upsert's content replaced by its sha256. */
export function changesetSigningPayload(changeset: Changeset): string {
  const { signature: _omit, ...rest } = changeset;
  return canonicalJson({
    ...rest,
    files: changeset.files.map((f) => (f.op === "upsert" ? { ...f, contentBase64: f.sha256 } : f)),
  });
}

function decodeStrictBase64(b64: unknown): Buffer | null {
  if (typeof b64 !== "string" || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  return buf.toString("base64") === b64 ? buf : null;
}

function hasResource(abu: AbuSpec | null, key: string): boolean {
  return !!abu?.resources?.some((r) => r.key === key && r.mode === "exclusive");
}

/**
 * Validates a submission against its scope. Pure and deterministic: the same inputs give the same errors
 * in the same order on the builder's machine, on the control plane and in CI. Input is treated as
 * untrusted even when typed: a modified client can send anything the JSON can carry.
 */
export function validateChangeset(changeset: Changeset, ctx: ScopeContext): ChangesetValidation {
  const errors: ChangesetValidation["errors"] = [];
  const add = (code: ChangesetErrorCode, path: string | null, message: string) => errors.push({ code, path, message });

  const files: unknown[] = Array.isArray(changeset?.files) ? changeset.files : [];
  if (files.length === 0) {
    add("EMPTY_DIFF", null, "the changeset changes nothing");
    return { ok: false, errors };
  }
  if (files.length > MAX_CHANGESET_FILES) add("TOO_LARGE", null, `${files.length} files; the limit is ${MAX_CHANGESET_FILES}`);

  const manifest = ctx.repoManifest;
  const protectedPaths = [...ALWAYS_PROTECTED, ...(manifest.protectedPaths ?? [])];
  const isDocument = ctx.kind !== "abu";
  const allowed: WriteScope[] = isDocument ? ctx.documentPaths : (ctx.abu?.scope.write ?? []);
  const lockfiles = manifest.lockfiles ?? [];
  const migrationsDir = manifest.migrationsDir;

  const seen = new Set<string>();
  const valid: ChangesetFile[] = [];
  let totalBytes = 0;

  for (const raw of files) {
    const f = raw as { path?: unknown; op?: unknown; mode?: unknown; contentBase64?: unknown; sha256?: unknown; bytes?: unknown };
    const problem = pathProblem(f?.path);
    if (problem) {
      add("PATH_INVALID", typeof f?.path === "string" ? f.path : null, problem);
      continue;
    }
    const path = f.path as string;
    if (f.op !== "upsert" && f.op !== "delete") {
      add("SYMLINK_OR_SPECIAL_FILE", path, `unknown operation ${JSON.stringify(f.op)}`);
      continue;
    }
    if (f.op === "upsert" && f.mode !== "100644" && f.mode !== "100755") {
      // 120000 (symlink) and 160000 (submodule) cannot be expressed by the schema; a modified client may still send them.
      add("SYMLINK_OR_SPECIAL_FILE", path, `mode ${JSON.stringify(f.mode)}; only regular files 100644/100755`);
      continue;
    }
    if (seen.has(path)) {
      add("CASE_COLLISION", path, "path listed more than once");
      continue;
    }
    seen.add(path);

    // Denials first: none of them can be overridden by a write scope.
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (matchesDeny(path, WORKFLOWS)) {
      add("WORKFLOW_FILE", path, "workflow files are never writable by a submission");
    } else if (protectedPaths.some((p) => matchesDeny(path, p)) || GIT_META_BASENAMES.has(fold(basename))) {
      const documentException =
        isDocument &&
        !ALWAYS_PROTECTED.some((p) => matchesDeny(path, p)) &&
        !GIT_META_BASENAMES.has(fold(basename)) &&
        ctx.documentPaths.some((s) => inScope(path, s));
      if (!documentException) add("PROTECTED_PATH", path, "protected path");
    }
    if ((manifest.generatedPaths ?? []).some((p) => matchesDeny(path, p)))
      add("GENERATED_PATH", path, "generated files are never submitted");

    const lockfile = lockfiles.find((l) => fold(l) === fold(path)) ?? (LOCKFILE_BASENAMES.has(fold(basename)) ? path : null);
    if (lockfile !== null && (isDocument || !hasResource(ctx.abu, `lockfile:${lockfile}`))) {
      add("LOCKFILE_WITHOUT_RESOURCE", path, `needs an exclusive lockfile:${lockfile} resource`);
    }
    if (migrationsDir && matchesDeny(path, `${migrationsDir}/**`) && (isDocument || !hasResource(ctx.abu, "db:migrations"))) {
      add("MIGRATION_WITHOUT_RESOURCE", path, "needs an exclusive db:migrations resource");
    }
    if (!isDocument && !ctx.abu) add("OUT_OF_SCOPE", path, "no ABU in scope context");
    else if (!allowed.some((s) => inScope(path, s))) add("OUT_OF_SCOPE", path, "outside every write scope");

    if (f.op === "delete") {
      if (!ctx.existingPaths.has(path)) add("DELETE_MISSING_FILE", path, "not present at the parent commit");
      valid.push({ op: "delete", path });
      continue;
    }

    const content = decodeStrictBase64(f.contentBase64);
    if (!content) {
      add("HASH_MISMATCH", path, "content is not canonical base64");
      continue;
    }
    totalBytes += content.length;
    if (sha256Hex(content) !== f.sha256 || content.length !== f.bytes) {
      add("HASH_MISMATCH", path, "sha256 or byte count does not match the content");
    }
    for (const hit of scanForSecrets(content.toString("utf8"))) add("SECRET_DETECTED", path, `${hit.id} at line ${hit.line}`);
    valid.push(f as ChangesetFile);
  }

  const limit = Math.min(manifest.maxChangesetBytes ?? HARD_MAX_CHANGESET_BYTES, HARD_MAX_CHANGESET_BYTES);
  if (totalBytes > limit) add("TOO_LARGE", null, `${totalBytes} bytes; the limit is ${limit}`);

  checkCollisions(valid, ctx.existingPaths, add);

  // Only recomputable when every entry parsed; otherwise the changeset already failed on those entries.
  if (valid.length === files.length) {
    const recomputed = computeSubmissionSha256(String(changeset.parentCommit), valid);
    if (recomputed !== changeset.submissionSha256) add("SUBMISSION_HASH_MISMATCH", null, `recomputed ${recomputed}`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Case/normalisation collisions and file/directory conflicts in the tree the changeset produces
 * (parent tree minus deletes plus upserts). Only collisions involving a path this changeset writes are
 * reported, so a pre-existing collision cannot block unrelated work.
 */
function checkCollisions(
  files: readonly ChangesetFile[],
  existing: ReadonlySet<string>,
  add: (code: ChangesetErrorCode, path: string | null, message: string) => void,
) {
  const deleted = new Set(files.filter((f) => f.op === "delete").map((f) => f.path));
  const upserts = files.filter((f) => f.op === "upsert").map((f) => f.path);
  const resulting = new Set<string>([...[...existing].filter((p) => !deleted.has(p)), ...upserts]);

  const spellings = new Map<string, Set<string>>();
  const dirs = new Set<string>();
  const note = (p: string) => {
    const k = fold(p);
    let s = spellings.get(k);
    if (!s) {
      s = new Set();
      spellings.set(k, s);
    }
    s.add(p);
  };
  for (const p of resulting) {
    note(p);
    for (const d of parentDirs(p)) {
      dirs.add(d);
      note(d);
    }
  }
  for (const p of upserts) {
    if (dirs.has(p)) {
      add("PATH_INVALID", p, "a file cannot replace a directory that still has files");
      continue;
    }
    const fileAsDir = parentDirs(p).find((d) => resulting.has(d));
    if (fileAsDir) {
      add("PATH_INVALID", p, `parent "${fileAsDir}" is a file`);
      continue;
    }
    for (const q of [p, ...parentDirs(p)]) {
      const others = [...(spellings.get(fold(q)) ?? [])].filter((s) => s !== q);
      if (others.length > 0) {
        add("CASE_COLLISION", p, `"${q}" collides with "${others.sort()[0]}" ignoring case/normalisation`);
        break;
      }
    }
  }
}

/** Inputs only the control plane has: the expected parent, the accepted manifest and the device key. */
export interface SubmissionContext {
  /** The lease's base for a first submission, else the attempt's current candidate head. */
  expectedParentCommit: string;
  /** manifest_sha256 of the context manifest accepted for this lease. */
  acceptedManifestSha256: string;
  /** The registered device's Ed25519 public key: base64 of the raw 32 bytes, base64 SPKI DER, or PEM. */
  devicePublicKey: string;
}

/**
 * Server-side validation (S-16): `validateChangeset` plus PARENT_MISMATCH, MANIFEST_MISMATCH and
 * SIGNATURE_INVALID. Every input is required, so the server checks cannot be skipped by omission.
 */
export function validateSubmission(changeset: Changeset, ctx: ScopeContext, server: SubmissionContext): ChangesetValidation {
  const result = validateChangeset(changeset, ctx);
  const errors = [...result.errors];
  if (changeset.parentCommit !== server.expectedParentCommit) {
    errors.push({ code: "PARENT_MISMATCH", path: null, message: `expected parent ${server.expectedParentCommit}` });
  }
  if (changeset.manifestSha256 !== server.acceptedManifestSha256) {
    errors.push({ code: "MANIFEST_MISMATCH", path: null, message: "not the manifest accepted for this lease" });
  }
  if (!verifyChangesetSignature(changeset, server.devicePublicKey)) {
    errors.push({ code: "SIGNATURE_INVALID", path: null, message: "signature does not verify with the device key" });
  }
  return { ok: errors.length === 0, errors };
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function ed25519Key(encoded: string) {
  const text = encoded.trim();
  if (text.startsWith("-----BEGIN")) return createPublicKey(text);
  const der = Buffer.from(text, "base64");
  return createPublicKey({ key: der.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, der]) : der, format: "der", type: "spki" });
}

export function verifyChangesetSignature(changeset: Changeset, devicePublicKey: string): boolean {
  try {
    const key = ed25519Key(devicePublicKey);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const sig = decodeStrictBase64(changeset.signature);
    if (sig?.length !== 64) return false;
    return verifySignature(null, Buffer.from(changesetSigningPayload(changeset), "utf8"), key, sig);
  } catch {
    return false;
  }
}
