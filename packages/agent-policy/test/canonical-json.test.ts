import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/index.js";

describe("agent-policy canonicalJson (RFC 8785)", () => {
  it("matches the RFC 8785 section 3.2.2 example", () => {
    const input = {
      // biome-ignore lint/correctness/noPrecisionLoss: the RFC 8785 vector is deliberately beyond double precision
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      // U+20AC "$" U+000F U+000A "A" "'" "B" U+0022 U+005C U+005C U+0022 "/" (built from code points to keep the source ASCII-safe)
      string: String.fromCodePoint(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f),
      literals: [null, true, false],
    };
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units (RFC 8785 3.2.3 example)", () => {
    const names = [0x20ac, 0x0d, 0xfb33, 0x31, 0x1f600, 0x80, 0xf6].map((c) => String.fromCodePoint(c));
    const labels = [
      "Euro Sign",
      "Carriage Return",
      "Hebrew Letter Dalet With Dagesh",
      "One",
      "Emoji: Grinning Face",
      "Control",
      "Latin Small Letter O With Diaeresis",
    ];
    const input = Object.fromEntries(names.map((n, i) => [n, labels[i]]));
    // Read the order from the text: JSON.parse would move the integer-like key "1" first.
    const text = canonicalJson(input);
    expect(labels.slice().sort((a, b) => text.indexOf(`"${a}"`) - text.indexOf(`"${b}"`))).toEqual([
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ]);
  });

  it("is independent of insertion order and nests", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 0, y: -0 }], c: "x" } })).toBe('{"a":{"c":"x","d":[1,{"y":0,"z":0}]},"b":1}');
  });

  it("omits undefined members and refuses values JSON cannot carry", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalJson([undefined])).toThrow();
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ n: 1n })).toThrow();
    expect(() => canonicalJson(new Date(0))).toThrow();
  });
});
