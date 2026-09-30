/**
 * D60 "Architecture changes" (contracts 5.5.0): records, the element registry, impact computation, holds and
 * the build-next priority.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_POLICY_V1,
  abuOffered,
  ArchitectureHoldMachine,
  ArchitectureRecord,
  ArchitectureRecordErrorCode,
  architectureDocumentAllowedPaths,
  architecturePrTitle,
  architectureRecordIssues,
  architectureRegistry,
  computeArchitectureImpact,
  DocumentKind,
  DomainEventBody,
  findTransition,
  holdOutcome,
  ResourceClaim,
  rankWithArchitecture,
  type ArchitectureImpactInput,
} from "../src/index.js";

const WHY = "Forty characters of honest context about the change.";
const adr000 = {
  id: "ADR-000",
  elements: [
    { key: "arch:auth-session", change: "introduce" as const, summary: "Sessions issued by wOS Core.", paths: ["modules/core/auth/**"] },
    {
      key: "arch:data-layer",
      change: "introduce" as const,
      summary: "Postgres through the shared data layer.",
      paths: ["modules/core/db/**"],
    },
    { key: "arch:ui-shell", change: "introduce" as const, summary: "The one web shell and its navigation.", paths: ["apps/web/shell/**"] },
  ],
};
const record = (over: Partial<ArchitectureRecord> = {}): ArchitectureRecord =>
  ArchitectureRecord.parse({
    schema: "wos-architecture-record.v1",
    id: "ADR-001",
    version: 1,
    title: "Sessions move to rotating refresh tokens",
    context: WHY,
    decision: WHY,
    consequences: WHY,
    alternatives: [{ option: "Keep it", rejectedBecause: "Long-lived sessions are the audit's top finding." }],
    elements: [
      {
        key: "arch:auth-session",
        change: "change",
        summary: "Rotating refresh tokens, 15-minute access.",
        paths: ["modules/core/auth/**"],
      },
    ],
    migration: { buildGraph: "architecture/ADR-001/BUILD-GRAPH.yaml", summary: "Move every session reader to the new API." },
    ...over,
  });
const migrationAbu = (n: string, over: object = {}) => ({
  key: `adr-001#${n}`,
  requirements: ["R-001"],
  resources: [{ key: "arch:auth-session", mode: "exclusive" }],
  ...over,
});

describe("architecture records (D60)", () => {
  it("are a document kind with fixed paths and a PR title, and arch: is a resource key", () => {
    expect(DocumentKind.options).toContain("architecture");
    expect(architectureDocumentAllowedPaths("ADR-001")).toEqual(["architecture/ADR-001.yaml", "architecture/ADR-001/BUILD-GRAPH.yaml"]);
    expect(architecturePrTitle("ADR-001", "Rotating sessions")).toBe("ADR-001: Rotating sessions (Architecture Record)");
    expect(ResourceClaim.safeParse({ key: "arch:auth-session", mode: "shared" }).success).toBe(true);
  });

  it("need a migration graph to change or retire an element, and paths for what they govern", () => {
    expect(() => record({ migration: null })).toThrow();
    expect(() => record({ elements: [{ key: "arch:auth-session", change: "change", summary: "x".repeat(20), paths: [] }] })).toThrow();
    expect(() =>
      record({
        elements: [
          { key: "arch:events", change: "introduce", summary: "An outbox per app, delivered once.", paths: ["modules/core/events/**"] },
        ],
        migration: null,
      }),
    ).not.toThrow();
  });

  const reg = architectureRegistry([adr000]);
  const graph = (abus: object[]) => ({ feature: "adr-001", contractVersion: 1, abus: abus as never });
  const CASES: Record<ArchitectureRecordErrorCode, () => ReturnType<typeof architectureRecordIssues>> = {
    ARCH_ELEMENT_DUPLICATE: () =>
      architectureRecordIssues(
        record({ elements: [record().elements[0]!, record().elements[0]!] }),
        reg,
        graph([migrationAbu("01")]),
        null,
      ),
    ARCH_INTRODUCE_EXISTING: () =>
      architectureRecordIssues(
        record({
          elements: [{ key: "arch:data-layer", change: "introduce", summary: "A second data layer, again.", paths: ["modules/x/**"] }],
          migration: null,
        }),
        reg,
        null,
        null,
      ),
    ARCH_CHANGE_UNKNOWN: () =>
      architectureRecordIssues(
        record({
          elements: [{ key: "arch:nothing", change: "change", summary: "Changes an element nobody defined.", paths: ["modules/y/**"] }],
        }),
        reg,
        graph([migrationAbu("01", { resources: [{ key: "arch:nothing", mode: "exclusive" }] })]),
        null,
      ),
    ARCH_PATH_OVERLAP: () =>
      architectureRecordIssues(
        record({
          elements: [
            { key: "arch:events", change: "introduce", summary: "An outbox inside the data layer.", paths: ["modules/core/db/outbox/**"] },
          ],
          migration: null,
        }),
        reg,
        null,
        null,
      ),
    ARCH_MIGRATION_KEY: () => architectureRecordIssues(record(), reg, { ...graph([migrationAbu("01")]), feature: "adr-002" }, null),
    ARCH_MIGRATION_RESOURCE: () => architectureRecordIssues(record(), reg, graph([migrationAbu("01", { resources: [] })]), null),
    ARCH_MIGRATION_UNCOVERED: () => architectureRecordIssues(record(), reg, graph([migrationAbu("01", { requirements: ["R-002"] })]), null),
    ARCH_VERSION_NOT_NEXT: () =>
      architectureRecordIssues(record({ version: 3 }), reg, { ...graph([migrationAbu("01")]), contractVersion: 3 }, 1),
  };

  it("the valid record passes", () => {
    expect(architectureRecordIssues(record(), reg, graph([migrationAbu("01")]), null)).toEqual([]);
  });
  for (const code of ArchitectureRecordErrorCode.options)
    it(`record validation ${code}`, () => {
      expect([...new Set(CASES[code]().map((i) => i.code))]).toEqual([code]);
    });

  it("the registry applies records in merge order: introduce, change, retire", () => {
    const retire = { id: "ADR-002", elements: [{ key: "arch:ui-shell", change: "retire" as const, summary: "", paths: [] }] };
    const r = architectureRegistry([adr000, record(), retire]);
    expect([...r.keys()].sort()).toEqual(["arch:auth-session", "arch:data-layer"]);
    expect(r.get("arch:auth-session")!.definedBy).toBe("ADR-001");
  });
});

describe("impact computation (deterministic)", () => {
  const abu = (key: string, state: ArchitectureImpactInput["abus"][number]["state"], rel: string[], dependsOn: string[] = []) => ({
    key,
    feature: key.split("#")[0]!,
    state,
    resources: rel.map((k) => ({ key: k, mode: "shared" as const })),
    dependsOn,
  });
  const input: ArchitectureImpactInput = {
    record: record(),
    contracts: [
      { feature: "contacts", version: 2, architecture: ["arch:auth-session", "arch:data-layer"] },
      { feature: "deals", version: 1, architecture: ["arch:data-layer"] },
    ],
    abus: [
      abu("contacts#01", "merged", ["arch:auth-session"]),
      abu("contacts#02", "ready", ["arch:auth-session"], ["contacts#01"]),
      abu("contacts#03", "pending_dependencies", [], ["contacts#02"]),
      abu("contacts#04", "pending_dependencies", [], ["contacts#03"]),
      abu("contacts#05", "in_progress", ["arch:auth-session"]),
      abu("contacts#06", "ready", ["arch:data-layer"]),
      abu("deals#01", "ready", ["arch:data-layer"]),
      abu("contacts#07", "superseded", ["arch:auth-session"]),
      abu("adr-001#01", "ready", ["arch:auth-session"]),
    ],
    attempts: [
      { id: "a-5", abu: "contacts#05", state: "in_review" },
      { id: "a-5-old", abu: "contacts#05", state: "expired" },
    ],
    tasks: [
      { id: "t-2", state: "open", abu: "contacts#02" },
      { id: "t-6", state: "open", abu: "deals#01" },
      { id: "t-5", state: "leased", abu: "contacts#05" },
    ],
  };

  it("finds affected versus unaffected work", () => {
    expect(computeArchitectureImpact(input)).toEqual({
      record: "ADR-001",
      elements: ["arch:auth-session"],
      contracts: [{ feature: "contacts", version: 2 }],
      held: ["contacts#02"],
      blockedByHold: ["contacts#03", "contacts#04"],
      finishing: ["contacts#05"],
      liveAttempts: ["a-5"],
      heldTasks: ["t-2"],
      merged: ["contacts#01"],
    });
  });

  it("does not hold transitive dependents (they cannot start anyway) and never holds the record's own migration", () => {
    const out = computeArchitectureImpact(input);
    expect(out.held).not.toContain("contacts#03");
    expect(out.held).not.toContain("adr-001#01");
    expect(ARCHITECTURE_POLICY_V1.holds.holdTransitiveDependents).toBe(false);
  });

  it("is deterministic and an introduce-only record affects nobody", () => {
    const shuffled = { ...input, abus: [...input.abus].reverse(), tasks: [...input.tasks].reverse() };
    expect(computeArchitectureImpact(shuffled)).toEqual(computeArchitectureImpact(input));
    const intro = {
      ...input,
      record: { id: "ADR-003", elements: [{ key: "arch:events", change: "introduce" as const, summary: "", paths: ["x/**"] }] },
    };
    expect(computeArchitectureImpact(intro)).toMatchObject({ held: [], finishing: [], contracts: [], merged: [] });
  });

  it("is published as an event", () => {
    const i = computeArchitectureImpact(input);
    const ev = DomainEventBody.safeParse({
      type: "architecture.impact_computed",
      v: 1,
      visibility: "public",
      payload: {
        documentId: "0192f000-0000-7000-8000-000000000009",
        recordId: "ADR-001",
        version: 1,
        phase: "merged",
        ...i,
        record: undefined,
        liveAttempts: ["0192f000-0000-7000-8000-00000000000a"],
        heldTasks: [],
      },
    });
    expect(ev.error?.issues ?? []).toEqual([]);
  });
});

describe("HELD (an overlay machine; the ABU, attempt and task machines are unchanged)", () => {
  it("a held ABU is not offered; released it is again", () => {
    expect(abuOffered("ready", [{ state: "held" }])).toBe(false);
    expect(abuOffered("ready", [{ state: "released" }])).toBe(true);
    expect(abuOffered("pending_dependencies", [])).toBe(false);
  });

  it("holds end in release or supersede, never back to held", () => {
    expect(findTransition(ArchitectureHoldMachine, "held", "release")?.to).toBe("released");
    expect(findTransition(ArchitectureHoldMachine, "held", "supersede")?.to).toBe("superseded");
    expect(findTransition(ArchitectureHoldMachine, "released", "supersede")).toBeUndefined();
    expect(ArchitectureHoldMachine.terminal).toEqual(["released", "superseded"]);
  });

  it("re-validation at the end of a hold follows FEATURE-CONTRACT section 5", () => {
    expect(holdOutcome({ recordAbandoned: false, carriedOver: null })).toBe("release");
    expect(holdOutcome({ recordAbandoned: false, carriedOver: true })).toBe("release");
    expect(holdOutcome({ recordAbandoned: false, carriedOver: false })).toBe("supersede");
    expect(holdOutcome({ recordAbandoned: true, carriedOver: false })).toBe("release");
  });

  it("in-flight review is never paused and runs with the record in context", () => {
    expect(ARCHITECTURE_POLICY_V1.review).toEqual({ pauseInFlight: false, recordInContext: true });
    expect(ARCHITECTURE_POLICY_V1.maintainerSignOff).toBe(true);
  });
});

describe("priority (published policy data)", () => {
  const units = [
    { unitId: "contacts#06", baseScore: 460, migrationOf: null, held: false },
    { unitId: "deals#01", baseScore: 300, migrationOf: null, held: false },
    { unitId: "contacts#02", baseScore: 500, migrationOf: null, held: true },
    { unitId: "adr-001#02", baseScore: 60, migrationOf: "ADR-001", held: false },
    { unitId: "adr-001#01", baseScore: 60, migrationOf: "ADR-001", held: false },
  ];

  it("migration units rank first, ties by id; held units are not offered", () => {
    expect(rankWithArchitecture(ARCHITECTURE_POLICY_V1, units).map((u) => u.unitId)).toEqual([
      "adr-001#01",
      "adr-001#02",
      "contacts#06",
      "deals#01",
    ]);
  });

  it("held work returns in its prior order when released", () => {
    const plain = units.filter((u) => u.migrationOf === null);
    const before = rankWithArchitecture(
      ARCHITECTURE_POLICY_V1,
      plain.map((u) => ({ ...u, held: false })),
    );
    const during = rankWithArchitecture(ARCHITECTURE_POLICY_V1, units);
    const after = rankWithArchitecture(
      ARCHITECTURE_POLICY_V1,
      plain.map((u) => ({ ...u, held: false })),
    );
    expect(during.map((u) => u.unitId)).not.toContain("contacts#02");
    expect(before.map((u) => u.unitId)).toEqual(["contacts#02", "contacts#06", "deals#01"]);
    expect(after).toEqual(before);
  });
});
