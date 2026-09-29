import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  formatPath,
  MAX_YAML_BYTES,
  parseBuildGraphYaml,
  parseCatalogEntryYaml,
  parseFeatureContractYaml,
  parseInventoryYaml,
  parseRoadmapYaml,
} from "../src/index.js";
import { catalog, clone, contract, graph, inventory, roadmap } from "./fixtures.js";

const y = (v: unknown) => stringify(v, { lineWidth: 0 });

describe("YAML parsers return path-precise errors (DONE 1)", () => {
  it("round-trips every artifact kind", () => {
    const rm = parseRoadmapYaml(y(roadmap()));
    expect(rm).toEqual({ ok: true, value: roadmap() });
    expect(parseInventoryYaml(y(inventory()))).toEqual({ ok: true, value: inventory() });
    expect(parseCatalogEntryYaml(y(catalog().get("contacts")))).toEqual({ ok: true, value: catalog().get("contacts") });
    expect(parseFeatureContractYaml(y(contract()))).toEqual({ ok: true, value: contract() });
    expect(parseBuildGraphYaml(y(graph()))).toEqual({ ok: true, value: graph() });
  });

  it("roadmap-consensus R-003 a missing rationale is reported at its JSONPath with the line of the capability", () => {
    const r = clone(roadmap()) as Record<string, unknown> & ReturnType<typeof roadmap>;
    delete (r.capabilities[1] as Partial<(typeof r.capabilities)[number]>).weightRationale;
    const text = y(r);
    const res = parseRoadmapYaml(text);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.path).toBe("$.capabilities[1].weightRationale");
    // The key is missing, so the location is its parent: the "- key: deals" line.
    const line = text.split("\n").findIndex((l) => l.includes("key: deals")) + 1;
    expect(res.errors[0]!.message).toMatch(new RegExp(`^line ${line}, column \\d+: `));
  });

  it("roadmap-consensus R-003 wrong sums are reported on the level that is wrong", () => {
    const r = clone(roadmap());
    r.capabilities[0]!.features[0]!.weightBp = 6000;
    r.capabilities[0]!.features[0]!.surfaces[1]!.weightBp = 2999;
    const res = parseRoadmapYaml(y(r));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.path).sort()).toEqual(["$.capabilities[0].features", "$.capabilities[0].features[0].surfaces"]);
    expect(res.errors.find((e) => e.path === "$.capabilities[0].features")!.message).toContain("must sum to 10000 bp, got 9000");
  });

  it("a wrong scalar points at the scalar itself", () => {
    const text = y(roadmap()).replace("weightBp: 3000\n    weightRationale: Deals", "weightBp: lots\n    weightRationale: Deals");
    const res = parseRoadmapYaml(text);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const line = text.split("\n").findIndex((l) => l.includes("weightBp: lots")) + 1;
    expect(res.errors).toEqual([
      { path: "$.capabilities[1].weightBp", message: expect.stringMatching(new RegExp(`^line ${line}, column 15: `)) },
    ]);
  });

  it("syntax errors carry line and column", () => {
    const res = parseInventoryYaml("schema: wos-inventory.v1\nitems:\n  - key: [unclosed\n");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]!.message).toMatch(/^line \d+, column \d+: /);
  });

  it("rejects duplicate keys (a second weightBp would silently win)", () => {
    const res = parseCatalogEntryYaml("schema: wos-catalog-entry.v1\nkey: contacts\nkey: people\ntitle: t\nsummary: a summary text\n");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]!.message).toMatch(/^line 3, column 1: .*[Uu]nique/);
  });

  it("rejects several documents in one file", () => {
    const one = y(catalog().get("contacts"));
    expect(parseCatalogEntryYaml(`${one}---\n${one}`).ok).toBe(false);
  });

  it("uses the core schema: no custom tags, no merge keys, dates stay strings", () => {
    expect(parseCatalogEntryYaml("!!js/function x\n").ok).toBe(false);
    expect(parseCatalogEntryYaml("schema: !custom wos-catalog-entry.v1\nkey: contacts\ntitle: t\nsummary: a summary text\n").ok).toBe(
      false,
    );
    const merged = "base: &b\n  title: t\nschema: wos-catalog-entry.v1\nkey: contacts\n<<: *b\nsummary: a summary text\n";
    expect(parseCatalogEntryYaml(merged).ok).toBe(false);
    const inv = parseInventoryYaml(y(inventory()));
    expect(inv.ok && typeof inv.value.sources[0]!.retrievedOn).toBe("string");
  });

  it("caps alias expansion (billion laughs)", () => {
    let text = "a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n";
    for (let i = 1; i < 8; i++)
      text += `a${i}: &a${i} [${Array(10)
        .fill(`*a${i - 1}`)
        .join(", ")}]\n`;
    const res = parseCatalogEntryYaml(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]!.path).toBe("$");
  });

  it("refuses input over the API body limit before parsing", () => {
    const res = parseCatalogEntryYaml(`# ${"x".repeat(MAX_YAML_BYTES)}\n`);
    expect(res).toEqual({ ok: false, errors: [{ path: "$", message: expect.stringContaining("the limit is") }] });
  });

  it("an empty file is one root error", () => {
    expect(parseRoadmapYaml("")).toEqual({ ok: false, errors: [{ path: "$", message: expect.stringMatching(/^line 1, column 1: /) }] });
  });

  it("formatPath quotes keys that are not identifiers", () => {
    expect(formatPath(["capabilities", 0, "features", 2, "weightBp"])).toBe("$.capabilities[0].features[2].weightBp");
    expect(formatPath(["a b", 1])).toBe('$["a b"][1]');
    expect(formatPath([])).toBe("$");
  });
});
