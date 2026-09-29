/**
 * THE canonical hashing and signing definitions for wOS (contracts 2.0.0; blockers B-0002-github-build,
 * B-0004-github-build, B-0001-verification). Every package that hashes or signs anything imports these;
 * no package may carry its own copy. Node-only (node:crypto), so it is a separate entry point:
 *
 *   import { canonicalJson, submissionSha256, ... } from "@waronsaas/contracts/canonical";
 *
 * Normative rules (the test vectors in test/canonical.test.ts pin every byte):
 *
 *  C-1 Canonical JSON is RFC 8785 (JCS): object members sorted by UTF-16 code units of their names,
 *      no whitespace, strings and numbers serialised exactly as ECMAScript JSON.stringify does.
 *      Members whose value is `undefined` are omitted; `undefined` inside arrays is refused.
 *      Non-finite numbers, bigint, functions, symbols and non-plain objects (Date, Map, Buffer...) throw.
 *  C-2 Digests are written "sha256:<64 lowercase hex>" over the UTF-8 bytes of the input.
 *  C-3 submissionSha256 (the "diff hash") = sha256 of JCS({ parentCommit, files }) where files are sorted
 *      by path (UTF-16 code units) and each entry is
 *        upsert: { path, op: "upsert", mode, sha256 }        (sha256 of the decoded file bytes)
 *        delete: { path, op: "delete" }                       (no mode, no sha256 keys at all)
 *      Duplicate paths are an error.
 *  C-4 Signed bytes of a changeset = UTF-8 of JCS(P) where P is the changeset AFTER zod parsing (defaults
 *      applied, unknown keys stripped) with `signature` removed and every upsert's `contentBase64`
 *      replaced by that file's `sha256` string. Agent-run records: JCS of the parsed record without
 *      `signature`. The verifier parses first, then rebuilds the same bytes.
 *  C-5 Device keys are Ed25519. The public key is encoded as standard base64 (with padding) of the RAW
 *      32-byte key (44 characters). Signatures are standard base64 of the 64-byte signature (88 chars).
 *      PEM/SPKI encodings are not accepted on the wire.
 *  C-6 manifestSha256 = canonicalSha256(manifest without `manifestSha256`);
 *      provenance record hash = canonicalSha256(parsed ProvenanceRecord).
 *  C-7 gitBlobOid = SHA-1 of "blob <byteLength>\0" + bytes (what `git hash-object` prints).
 */
import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign, verify } from "node:crypto";
import { AgentRunRecord, Changeset, type ChangesetFile, ContextManifest, ProvenanceRecord } from "./agent-io.js";
import type { Sha256 } from "./primitives.js";

// ---------------------------------------------------------------------------------------------- C-1

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((v) => {
            if (v === undefined) throw new TypeError("canonicalJson: undefined in array");
            return canonicalJson(v);
          })
          .join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new TypeError("canonicalJson: only plain objects");
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot canonicalise ${typeof value}`);
  }
}

// ---------------------------------------------------------------------------------------------- C-2

export function sha256Of(data: Uint8Array | string): Sha256 {
  const h = createHash("sha256");
  if (typeof data === "string") h.update(data, "utf8");
  else h.update(data);
  return `sha256:${h.digest("hex")}` as Sha256;
}

export function canonicalSha256(value: unknown): Sha256 {
  return sha256Of(canonicalJson(value));
}

// ---------------------------------------------------------------------------------------------- C-3

export function submissionEntries(files: readonly ChangesetFile[]) {
  const entries = files.map((f) =>
    f.op === "upsert" ? { path: f.path, op: "upsert" as const, mode: f.mode, sha256: f.sha256 } : { path: f.path, op: "delete" as const },
  );
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.path === entries[i - 1]!.path) throw new Error(`submissionSha256: duplicate path ${entries[i]!.path}`);
  }
  return entries;
}

export function submissionSha256(parentCommit: string, files: readonly ChangesetFile[]): Sha256 {
  return canonicalSha256({ parentCommit, files: submissionEntries(files) });
}

// ---------------------------------------------------------------------------------------------- C-4

const UnsignedChangeset = Changeset.omit({ signature: true });
export type UnsignedChangeset = import("zod").input<typeof UnsignedChangeset>;
const UnsignedAgentRun = AgentRunRecord.omit({ signature: true });
export type UnsignedAgentRun = import("zod").input<typeof UnsignedAgentRun>;

/** UTF-8 bytes the device key signs for a changeset (C-4). Accepts signed or unsigned input. */
export function changesetSigningPayload(changeset: UnsignedChangeset | Changeset): Uint8Array {
  const { signature: _drop, ...rest } = changeset as Changeset;
  const parsed = UnsignedChangeset.parse(rest);
  const view = { ...parsed, files: parsed.files.map((f) => (f.op === "upsert" ? { ...f, contentBase64: f.sha256 } : f)) };
  return new TextEncoder().encode(canonicalJson(view));
}

export function agentRunSigningPayload(record: UnsignedAgentRun | AgentRunRecord): Uint8Array {
  const { signature: _drop, ...rest } = record as AgentRunRecord;
  return new TextEncoder().encode(canonicalJson(UnsignedAgentRun.parse(rest)));
}

// ---------------------------------------------------------------------------------------------- C-5

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function strictBase64(text: string, bytes: number): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error("not standard base64");
  const buf = Buffer.from(text, "base64");
  if (buf.toString("base64") !== text || buf.length !== bytes) throw new Error(`expected ${bytes} bytes of base64`);
  return buf;
}

/** Decodes a device public key (C-5). Throws on anything but base64 of 32 raw bytes. */
export function devicePublicKeyFromBase64(b64: string): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, strictBase64(b64, 32)]), format: "der", type: "spki" });
}

/** Encodes an Ed25519 public KeyObject as the C-5 wire format. */
export function encodeDevicePublicKey(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519" || der.length !== 44) throw new Error("not an Ed25519 public key");
  return der.subarray(12).toString("base64");
}

/** Builds an Ed25519 private key from a 32-byte seed (tests and key import). */
export function ed25519PrivateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: "der", type: "pkcs8" });
}

export function signEd25519(privateKey: KeyObject, payload: Uint8Array): string {
  return sign(null, payload, privateKey).toString("base64");
}

export function verifyEd25519(publicKeyB64: string, payload: Uint8Array, signatureB64: string): boolean {
  try {
    return verify(null, payload, devicePublicKeyFromBase64(publicKeyB64), strictBase64(signatureB64, 64));
  } catch {
    return false;
  }
}

export function signChangeset(unsigned: UnsignedChangeset, privateKey: KeyObject): Changeset {
  const parsed = UnsignedChangeset.parse(unsigned);
  return { ...parsed, signature: signEd25519(privateKey, changesetSigningPayload(parsed)) };
}

export function verifyChangesetSignature(changeset: Changeset, publicKeyB64: string): boolean {
  try {
    return verifyEd25519(publicKeyB64, changesetSigningPayload(changeset), changeset.signature);
  } catch {
    return false;
  }
}

export function verifyAgentRunSignature(record: AgentRunRecord, publicKeyB64: string): boolean {
  try {
    return verifyEd25519(publicKeyB64, agentRunSigningPayload(record), record.signature);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------- C-6, C-7

export function computeManifestSha256(manifest: ContextManifest | Omit<ContextManifest, "manifestSha256">): Sha256 {
  const { manifestSha256: _drop, ...rest } = manifest as ContextManifest;
  return canonicalSha256(ContextManifest.omit({ manifestSha256: true }).parse(rest));
}

export function provenanceSha256(record: ProvenanceRecord): Sha256 {
  return canonicalSha256(ProvenanceRecord.parse(record));
}

export function gitBlobOid(bytes: Uint8Array): string {
  const h = createHash("sha1");
  h.update(`blob ${bytes.byteLength}\0`);
  h.update(bytes);
  return h.digest("hex");
}
