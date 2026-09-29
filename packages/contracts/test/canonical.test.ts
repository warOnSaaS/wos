/**
 * Normative test vectors for canonical.ts (contracts 2.0.0). Every implementation that hashes or signs
 * (client, control plane, CI) imports @waronsaas/contracts/canonical; these vectors pin the bytes so a
 * change to any rule is caught here first.
 */
import { createPublicKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  changesetSigningPayload,
  devicePublicKeyFromBase64,
  ed25519PrivateKeyFromSeed,
  encodeDevicePublicKey,
  gitBlobOid,
  sha256Of,
  signChangeset,
  submissionSha256,
  type UnsignedChangeset,
  verifyChangesetSignature,
} from "../src/canonical.js";
import type { ChangesetFile } from "../src/index.js";

const PARENT = "a".repeat(40);
const FILES: ChangesetFile[] = [
  {
    op: "upsert",
    path: "modules/contacts/b.ts",
    mode: "100644",
    contentBase64: "ZXhwb3J0IGNvbnN0IGIgPSAyOwo=",
    sha256: "sha256:b5d546753d33709dff508a6f2c2e547f432267fbb05b68d3da74fa5f7bda9f7a",
    bytes: 20,
  },
  { op: "delete", path: "modules/contacts/a.ts" },
  {
    op: "upsert",
    path: "modules/contacts/run.sh",
    mode: "100755",
    contentBase64: "IyEvYmluL3NoCg==",
    sha256: "sha256:a8076d3d28d21e02012b20eaf7dbf75409a6277134439025f282e368e3305abf",
    bytes: 10,
  },
];
const UNSIGNED: UnsignedChangeset = {
  schema: "wos-changeset.v1",
  taskId: "0192f000-0000-7000-8000-000000000001",
  leaseId: "0192f000-0000-7000-8000-000000000002",
  deviceId: "0192f000-0000-7000-8000-000000000003",
  parentCommit: PARENT,
  manifestSha256: `sha256:${"1".repeat(64)}`,
  submissionSha256: "sha256:08a42b4ece456507fc5cfa01d6d07d473044a230117a9667a278df54379b7608",
  files: FILES,
  summary: { schema: "build-summary.v1", summary: "s", requirementsCovered: ["R-001"], responses: [], abuConcerns: [] },
};
const SEED = new Uint8Array(32).fill(7);
const PUBLIC_KEY = "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=";
const SIGNATURE = "igcfDlLL1ZIj7dqMSEM63k58K95STKlN0dOpV9ABw8R55EKa6Nlz1u2oSjjdU4MFbVGbcjef49crNxE/CjtsAA==";

describe("C-1 canonical JSON (RFC 8785)", () => {
  it("matches the RFC 8785 section 3.2.2 example", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units, omits undefined members, refuses what JSON cannot say", () => {
    expect(canonicalJson({ b: 1, a: undefined, é: 2, Z: 3 })).toBe('{"Z":3,"b":1,"é":2}');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date(0), [undefined], () => 1]) {
      expect(() => canonicalJson(bad)).toThrow();
    }
  });
});

describe("C-2/C-3 the diff hash", () => {
  it("pins the submission hash; deletes carry path and op only; order does not matter", () => {
    expect(submissionSha256(PARENT, FILES)).toBe(UNSIGNED.submissionSha256);
    expect(submissionSha256(PARENT, [...FILES].reverse())).toBe(UNSIGNED.submissionSha256);
    const withModeOnDelete = canonicalJson({ parentCommit: PARENT, files: [{ path: "x", op: "delete", mode: null }] });
    expect(sha256Of(withModeOnDelete)).not.toBe(submissionSha256(PARENT, [{ op: "delete", path: "x" }]));
  });

  it("changes when a mode, a content hash or the parent changes, and refuses duplicate paths", () => {
    const flipped = FILES.map((f) => (f.op === "upsert" && f.mode === "100755" ? { ...f, mode: "100644" as const } : f));
    expect(submissionSha256(PARENT, flipped)).not.toBe(UNSIGNED.submissionSha256);
    expect(submissionSha256("b".repeat(40), FILES)).not.toBe(UNSIGNED.submissionSha256);
    expect(() => submissionSha256(PARENT, [...FILES, { op: "delete", path: "modules/contacts/b.ts" }])).toThrow(/duplicate/);
  });
});

describe("C-4/C-5 signing", () => {
  const priv = ed25519PrivateKeyFromSeed(SEED);

  it("encodes the device key as base64 of the raw 32 bytes", () => {
    expect(encodeDevicePublicKey(createPublicKey(priv))).toBe(PUBLIC_KEY);
    expect(() => devicePublicKeyFromBase64(`${PUBLIC_KEY}=`)).toThrow();
    const spki = createPublicKey(priv).export({ format: "der", type: "spki" }).toString("base64");
    expect(() => devicePublicKeyFromBase64(spki)).toThrow();
  });

  it("signs the post-parse changeset with contents replaced by their sha256 (pinned bytes and signature)", () => {
    expect(sha256Of(changesetSigningPayload(UNSIGNED))).toBe("sha256:2b896def9067d74557a2123bddb87df07233f8a95019e3680386c4be278517aa");
    const signed = signChangeset(UNSIGNED, priv);
    expect(signed.signature).toBe(SIGNATURE);
    expect(verifyChangesetSignature(signed, PUBLIC_KEY)).toBe(true);
  });

  it("pre-parse and post-parse inputs sign the same bytes (localVerification default applied)", () => {
    const explicit = { ...UNSIGNED, localVerification: [] };
    expect(changesetSigningPayload(explicit)).toEqual(changesetSigningPayload(UNSIGNED));
  });

  it("any change to a signed field breaks the signature, and content swaps are caught by sha256", () => {
    const signed = signChangeset(UNSIGNED, priv);
    expect(verifyChangesetSignature({ ...signed, parentCommit: "c".repeat(40) }, PUBLIC_KEY)).toBe(false);
    expect(verifyChangesetSignature({ ...signed, signature: SIGNATURE.replace("A", "B") }, PUBLIC_KEY)).toBe(false);
  });
});

describe("C-7 git blob ids", () => {
  it("matches git hash-object", () => {
    expect(gitBlobOid(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
