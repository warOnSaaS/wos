import { Changeset, ChangesetErrorCode, ChangesetValidation } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { submissionSha256 as computeSubmissionSha256, verifyChangesetSignature } from "@waronsaas/contracts/canonical";
import { scopesOverlap, validateChangeset, validateSubmission } from "../src/index.js";
import { changesetVectors, signedChangeset, upsert, VECTOR_DEVICE_PUBLIC_KEY } from "../src/vectors.js";

const vectors = changesetVectors();

describe("scope-verification: shared changeset vector suite (S-16, S-17, S-26)", () => {
  it("covers every ChangesetErrorCode with at least one vector that produces exactly that code", () => {
    const isolated = new Set(vectors.filter((v) => v.codes.length === 1).map((v) => v.codes[0]));
    const missing = ChangesetErrorCode.options.filter((c) => !isolated.has(c));
    expect(missing).toEqual([]);
  });

  it("has unique vector names", () => {
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
  });

  for (const vec of vectors) {
    it(vec.name, () => {
      const result = validateSubmission(vec.changeset, vec.ctx, vec.server);
      expect(ChangesetValidation.safeParse(result).success).toBe(true);
      const codes = [...new Set(result.errors.map((e) => e.code))].sort();
      expect(codes, JSON.stringify(result.errors, null, 1)).toEqual(vec.codes);
      expect(result.ok).toBe(vec.codes.length === 0);
    });
  }

  it("is deterministic: the same inputs give identical output", () => {
    for (const vec of vectors) {
      expect(JSON.stringify(validateSubmission(vec.changeset, vec.ctx, vec.server))).toBe(
        JSON.stringify(validateSubmission(vec.changeset, vec.ctx, vec.server)),
      );
    }
  });

  it("every accepted vector's changeset also satisfies the frozen Changeset schema", () => {
    for (const vec of vectors.filter((v) => v.codes.length === 0)) expect(Changeset.safeParse(vec.changeset).success, vec.name).toBe(true);
  });

  it("client-side validateChangeset never needs server inputs and never reports server-only codes", () => {
    const serverOnly = new Set(["PARENT_MISMATCH", "MANIFEST_MISMATCH", "SIGNATURE_INVALID"]);
    for (const vec of vectors) {
      for (const e of validateChangeset(vec.changeset, vec.ctx).errors) expect(serverOnly.has(e.code), vec.name).toBe(false);
    }
  });
});

describe("scope-verification: hashing and signatures", () => {
  it("diff hash is independent of file order and binds parent, path, op, mode and content hash", () => {
    const a = upsert("modules/contacts/a.ts", "a");
    const b = upsert("modules/contacts/b.ts", "b");
    const parent = "a".repeat(40);
    expect(computeSubmissionSha256(parent, [a, b])).toBe(computeSubmissionSha256(parent, [b, a]));
    expect(computeSubmissionSha256(parent, [a])).not.toBe(computeSubmissionSha256("c".repeat(40), [a]));
    expect(computeSubmissionSha256(parent, [a])).not.toBe(computeSubmissionSha256(parent, [{ ...a, mode: "100755" }]));
    expect(computeSubmissionSha256(parent, [a])).not.toBe(computeSubmissionSha256(parent, [{ op: "delete", path: a.path }]));
  });

  it("accepts only the C-5 raw-key encoding: SPKI-DER and PEM of the same key are refused", () => {
    const c = signedChangeset([upsert("modules/contacts/a.ts", "a")]);
    const raw = Buffer.from(VECTOR_DEVICE_PUBLIC_KEY, "base64");
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
    const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----\n`;
    expect(verifyChangesetSignature(c, VECTOR_DEVICE_PUBLIC_KEY)).toBe(true);
    expect(verifyChangesetSignature(c, der.toString("base64"))).toBe(false);
    expect(verifyChangesetSignature(c, pem)).toBe(false);
    expect(verifyChangesetSignature(c, "")).toBe(false);
    expect(verifyChangesetSignature(c, "pkA")).toBe(false);
  });
});

describe("scope-verification: scope algebra", () => {
  it.each([
    ["modules/a/**", "modules/a/x.ts", true],
    ["modules/a/**", "modules/a/**", true],
    ["modules/a/**", "modules/ab/x.ts", false],
    ["modules/a/**", "modules/**", true],
    ["modules/a/x.ts", "modules/a/x.ts", true],
    ["modules/a/x.ts", "modules/a/y.ts", false],
    ["modules/a/b/**", "modules/a/**", true],
  ])("scopesOverlap(%s, %s) = %s", (a, b, expected) => {
    expect(scopesOverlap(a, b)).toBe(expected);
    expect(scopesOverlap(b, a)).toBe(expected);
  });
});
