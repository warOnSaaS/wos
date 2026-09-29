/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) for the JSON values wOS hashes and signs.
 *
 * Object members are sorted by UTF-16 code units of their names (JavaScript's default string order),
 * primitives are serialised exactly as ECMAScript JSON.stringify does (which is what RFC 8785 specifies
 * for strings and IEEE-754 numbers), and `undefined` members are dropped. Non-finite numbers, bigint,
 * functions and symbols are refused instead of silently changing the hash.
 *
 * NOTE (blocker B-0001-verification): the frozen contracts put `canonicalSha256` in the context-engine
 * package, which verification may not depend on. This copy must stay byte-identical to it; the
 * cross-check lives in packages/verification/test/jcs.test.ts and activates when context-engine lands.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("JCS: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`JCS: cannot canonicalise ${typeof value}`);
  }
}
