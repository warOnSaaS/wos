/**
 * YAML front door for canonical artifacts (ROADMAP-PROTOCOL.md "Validation" step 1).
 *
 * Every error is path precise: `path` is a JSONPath into the document (`$` is the root, e.g.
 * `$.capabilities[2].features[0].weightBp`) and `message` starts with the line and column of the nearest
 * node that exists in the file, so an author can find the spot without re-parsing.
 *
 * The text is untrusted (it comes from a contributor's submission): YAML 1.2 core schema only (no custom
 * tags, no `<<` merge keys, no implicit timestamps), duplicate keys rejected, one document only, alias
 * expansion capped, and a size cap equal to the API body limit.
 */
import type { z } from "zod";
import { LineCounter, parseDocument } from "yaml";

export type ParseError = { path: string; message: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: ParseError[] };

/** The API body limit (BUILD-PROTOCOL.md section 6); no canonical YAML file can be larger. */
export const MAX_YAML_BYTES = 4_000_000;
/** Aliases are legal YAML but an expansion bomb in untrusted input; canonical files need very few. */
export const MAX_YAML_ALIASES = 100;

type PathSegment = string | number | symbol;

/** `["capabilities", 2, "weightBp"]` -> `$.capabilities[2].weightBp`. Keys that are not identifiers are quoted. */
export function formatPath(path: ReadonlyArray<PathSegment>): string {
  let out = "$";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (typeof seg === "string" && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(seg)) out += `.${seg}`;
    else out += `[${JSON.stringify(String(seg))}]`;
  }
  return out;
}

interface Located {
  range?: [number, number, number] | null;
}

/** Parses `text` as one YAML document and validates it with `schema`. Never throws. */
export function parseYamlWith<S extends z.ZodType>(schema: S, text: string): ParseResult<z.infer<S>> {
  if (typeof text !== "string") return { ok: false, errors: [{ path: "$", message: "input is not text" }] };
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_YAML_BYTES) {
    return { ok: false, errors: [{ path: "$", message: `file is ${bytes} bytes; the limit is ${MAX_YAML_BYTES}` }] };
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    schema: "core",
    merge: false,
    uniqueKeys: true,
    strict: true,
  });
  const at = (offset: number) => {
    const { line, col } = lineCounter.linePos(offset);
    return `line ${line}, column ${col}`;
  };
  const syntax = [...doc.errors, ...doc.warnings];
  if (syntax.length > 0) {
    return {
      ok: false,
      errors: syntax.map((e) => ({ path: "$", message: `${at(e.pos[0])}: ${e.message.split("\n")[0]}` })),
    };
  }
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: MAX_YAML_ALIASES });
  } catch (err) {
    return { ok: false, errors: [{ path: "$", message: `cannot read the document: ${(err as Error).message}` }] };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };

  /** The nearest node that exists for a path (a missing key reports its parent). */
  const locate = (path: ReadonlyArray<PathSegment>): string => {
    for (let n = path.length; n >= 0; n--) {
      const keys = path.slice(0, n).filter((s): s is string | number => typeof s !== "symbol");
      const node = (n === 0 ? doc.contents : doc.getIn(keys, true)) as Located | null | undefined;
      if (node?.range) return at(node.range[0]);
    }
    return at(0);
  };
  const errors = parsed.error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: `${locate(issue.path)}: ${issue.message}`,
  }));
  return { ok: false, errors };
}
