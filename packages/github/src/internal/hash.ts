/** Hashing helpers shared by ./app and ./local. Internal: not part of the package exports. */
import { createHash } from "node:crypto";

/** git blob object id (SHA-1 of "blob <len>\0<bytes>"), exactly what `git hash-object` prints. */
export function gitBlobOid(bytes: Uint8Array): string {
  const h = createHash("sha1");
  h.update(`blob ${bytes.byteLength}\0`);
  h.update(bytes);
  return h.digest("hex");
}

/** "sha256:<hex>" in the contracts' Sha256 format. */
export function sha256Prefixed(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * RFC 8785 (JCS) canonical JSON for the JSON values wOS hashes: objects with keys sorted by UTF-16
 * code units, no whitespace, ECMAScript number and string serialisation (which JCS adopts).
 * The shared implementation is `context-engine.canonicalSha256`; the github package may not import
 * context-engine (ARCHITECTURE.md section 4), see blockers/B-0001-github-build.md.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("JCS: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`JCS: unsupported value of type ${typeof value}`);
  }
}

export function canonicalSha256(value: unknown): string {
  return sha256Prefixed(canonicalJson(value));
}
