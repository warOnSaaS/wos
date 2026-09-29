/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * - Object members are sorted by their names compared as arrays of UTF-16 code units (RFC 8785 3.2.3).
 * - Strings are serialised exactly as ECMAScript JSON.stringify does (RFC 8785 3.2.2.2).
 * - Numbers use the ECMAScript Number-to-String algorithm, which JSON.stringify implements (3.2.2.3).
 * - No whitespace.
 *
 * Values JSON cannot represent (undefined at top level or in arrays, functions, symbols, bigint,
 * NaN, Infinity) throw instead of being silently rewritten, so two parties never hash different
 * interpretations of the same object. Object members whose value is undefined are omitted, as
 * JSON.stringify does, because optional fields are routinely left undefined by TypeScript code.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, "$");
}

function serialise(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      // JSON.stringify(-0) === "0", which is what RFC 8785 requires.
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i];
      if (item === undefined) throw new TypeError(`canonicalJson: undefined at ${path}[${i}]`);
      parts.push(serialise(item, `${path}[${i}]`));
    }
    return `[${parts.join(",")}]`;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalJson: only plain objects are supported (at ${path})`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort(compareUtf16);
  const parts = keys.map((k) => `${JSON.stringify(k)}:${serialise(record[k], `${path}.${k}`)}`);
  return `{${parts.join(",")}}`;
}

/** Compare strings by UTF-16 code units (the default JS relational comparison, locale independent). */
function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
