import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_SCHEMA,
  ASSESSMENT_SCHEMA_V2,
  AssessmentBlock,
  AssessmentRecord,
  CURRENT_ASSESSMENT_SCHEMA,
  extractAssessmentBlock,
  hasGaps,
  MAX_GAPS,
  REFERENCE_SOURCE,
} from "../src/assessment.js";

// A structurally valid block for tests. Test data only: never written to docs/assessments.
const thesis = { importance: 5, compelling: 5, confidence: "low" };
const block = () => ({
  schema: ASSESSMENT_SCHEMA,
  paperVersion: "0.7",
  evaluator: { model: "test-model", product: "test-cli" },
  date: "2026-10-01",
  stage1: {
    problemReal: "partly",
    importance: { total: 50, impact: 10, breadth: 10, urgency: 10, evidence: 10, tractability: 10 },
    theses: { control: thesis, efficiency: thesis, softwareEngineering: thesis, apoc: thesis },
    confidence: "medium",
  },
  stage2: { effectiveness: 40, credibility: 30, readiness: "prototype", verdict: "watch", confidence: "medium" },
});
const fence = (json: string, tag = "wos-assessment") => `\`\`\`${tag}\n${json}\n\`\`\``;

describe("AssessmentBlock (wos-assessment/v1)", () => {
  it("accepts a complete block", () => {
    expect(AssessmentBlock.safeParse(block()).success).toBe(true);
  });

  it("requires the importance total to equal the sum of the five dimensions", () => {
    const b = block();
    b.stage1.importance.total = 51;
    const r = AssessmentBlock.safeParse(b);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("sum of the five dimensions");
  });

  it.each([
    ["dimension over 20", (b: ReturnType<typeof block>) => ((b.stage1.importance as { impact: number }).impact = 21)],
    ["non-integer score", (b: ReturnType<typeof block>) => (b.stage2.credibility = 40.5)],
    ["thesis over 10", (b: ReturnType<typeof block>) => (b.stage1.theses.apoc = { ...thesis, importance: 11 })],
    ["unknown verdict", (b: ReturnType<typeof block>) => ((b.stage2 as { verdict: string }).verdict = "buy")],
    ["unknown readiness", (b: ReturnType<typeof block>) => ((b.stage2 as { readiness: string }).readiness = "production")],
    ["bad date", (b: ReturnType<typeof block>) => (b.date = "1 Oct 2026")],
    ["bad version", (b: ReturnType<typeof block>) => (b.paperVersion = "v0.7")],
    ["empty model", (b: ReturnType<typeof block>) => (b.evaluator.model = " ")],
    ["unknown schema", (b: ReturnType<typeof block>) => ((b as { schema: string }).schema = "wos-assessment/v9")],
    // A v1 block relabelled v2 lacks the required lists.
    ["v2 without gaps and improvements", (b: ReturnType<typeof block>) => ((b as { schema: string }).schema = "wos-assessment/v2")],
  ])("rejects %s", (_name, mutate) => {
    const b = block();
    mutate(b);
    expect(AssessmentBlock.safeParse(b).success).toBe(false);
  });
});

// ------------------------------------------------------------------ v2 (contracts 5.2.0)
const gap = (id: string, severity = "high", part = "I") => ({ id, title: `Gap ${id}`, concerns: "section 3", part, severity });
const improvement = (id: string, g: string | null) => ({
  id,
  change: `Publish the data behind ${id}`,
  gap: g,
  raises: ["evidence", "credibility"],
});
const blockV2 = () => ({
  ...block(),
  schema: ASSESSMENT_SCHEMA_V2,
  paperVersion: "0.9",
  gaps: [gap("duplication-share-unsourced"), gap("no-pilot-data", "medium", "II")],
  improvements: [improvement("source-duplication-share", "duplication-share-unsourced"), improvement("run-a-public-pilot", null)],
});

describe("AssessmentBlock (wos-assessment/v2: gaps and improvements)", () => {
  it("the current paper asks for v2; v1 keeps its old value", () => {
    expect(CURRENT_ASSESSMENT_SCHEMA).toBe("wos-assessment/v2");
    expect(ASSESSMENT_SCHEMA).toBe("wos-assessment/v1");
  });

  it("accepts a complete v2 block, and empty lists (the agent looked and found none)", () => {
    const r = AssessmentBlock.safeParse(blockV2());
    expect(r.success).toBe(true);
    expect(r.success && hasGaps(r.data) && r.data.gaps.map((g) => g.id)).toEqual(["duplication-share-unsourced", "no-pilot-data"]);
    expect(AssessmentBlock.safeParse({ ...blockV2(), gaps: [], improvements: [] }).success).toBe(true);
  });

  it("still accepts a v1 block, and hasGaps tells them apart", () => {
    const r = AssessmentBlock.parse(block());
    expect(hasGaps(r)).toBe(false);
  });

  it("keeps the v1 rules (the total is the sum)", () => {
    const b = blockV2();
    b.stage1.importance.total = 51;
    expect(JSON.stringify(AssessmentBlock.safeParse(b).error?.issues)).toContain("sum of the five dimensions");
  });

  it.each([
    [
      "more than MAX_GAPS gaps",
      (b: ReturnType<typeof blockV2>) => (b.gaps = Array.from({ length: MAX_GAPS + 1 }, (_, i) => gap(`gap-${i}`))),
    ],
    ["a gap id that is not a slug", (b: ReturnType<typeof blockV2>) => (b.gaps[0]!.id = "Duplication Share")],
    ["a gap id too short", (b: ReturnType<typeof blockV2>) => (b.gaps[0]!.id = "ab")],
    ["a title over 120 characters", (b: ReturnType<typeof blockV2>) => (b.gaps[0]!.title = "x".repeat(121))],
    ["an unknown severity", (b: ReturnType<typeof blockV2>) => (b.gaps[0]!.severity = "critical")],
    ["an unknown part", (b: ReturnType<typeof blockV2>) => (b.gaps[0]!.part = "III")],
    ["duplicate gap ids", (b: ReturnType<typeof blockV2>) => (b.gaps[1]!.id = b.gaps[0]!.id)],
    ["an improvement tied to a gap not in the block", (b: ReturnType<typeof blockV2>) => (b.improvements[0]!.gap = "not-a-gap-here")],
    ["an improvement that raises no score", (b: ReturnType<typeof blockV2>) => (b.improvements[0]!.raises = [])],
    ["an improvement that raises an unknown score", (b: ReturnType<typeof blockV2>) => (b.improvements[0]!.raises = ["vibes"])],
    ["a change over 240 characters", (b: ReturnType<typeof blockV2>) => (b.improvements[0]!.change = "x".repeat(241))],
    ["a missing improvements list", (b: ReturnType<typeof blockV2>) => delete (b as { improvements?: unknown }).improvements],
  ])("rejects %s", (_name, mutate) => {
    const b = blockV2();
    mutate(b);
    expect(AssessmentBlock.safeParse(b).success).toBe(false);
  });

  it("extracts a v2 block, including from a json fence that declares v2", () => {
    const r = extractAssessmentBlock(`intro\n\n\`\`\`json\n${JSON.stringify(blockV2())}\n\`\`\`\n`);
    expect(r.ok && hasGaps(r.block) && r.block.improvements[0]!.gap).toBe("duplication-share-unsourced");
  });
});

describe("extractAssessmentBlock", () => {
  it("finds the tagged block anywhere in a report and returns the raw JSON", () => {
    const json = JSON.stringify(block(), null, 2);
    const report = `# Report\n\nStage 1...\n\n${fence(json)}\n\n## Against the recorded trend\n\nText after the block.`;
    const r = extractAssessmentBlock(report);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.raw).toBe(json);
      expect(r.block.stage2.verdict).toBe("watch");
    }
  });

  it("takes the last tagged block when there are several", () => {
    const a = block();
    const b = block();
    b.stage2.credibility = 35;
    const r = extractAssessmentBlock(`${fence(JSON.stringify(a))}\n\ntext\n\n${fence(JSON.stringify(b))}`);
    expect(r.ok && r.block.stage2.credibility).toBe(35);
  });

  it("falls back to a json block that declares the schema", () => {
    const r = extractAssessmentBlock(`intro\n\n${fence(JSON.stringify(block()), "json")}\n`);
    expect(r.ok).toBe(true);
  });

  it("ignores unrelated json blocks", () => {
    const r = extractAssessmentBlock(`${fence('{"a":1}', "json")}`);
    expect(r).toMatchObject({ ok: false, raw: null });
  });

  it("reports invalid JSON and schema failures without guessing", () => {
    expect(extractAssessmentBlock(fence("{ not json }"))).toMatchObject({ ok: false, raw: "{ not json }" });
    const b = block();
    b.stage1.importance.total = 99;
    const r = extractAssessmentBlock(fence(JSON.stringify(b)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("stage1.importance.total");
  });

  it("accepts tilde fences and indented closing fences", () => {
    const r = extractAssessmentBlock(`~~~wos-assessment\n${JSON.stringify(block())}\n  ~~~\n`);
    expect(r.ok).toBe(true);
  });
});

describe("AssessmentRecord", () => {
  const record = () => ({
    record: "wos-assessment-record/v1",
    id: "2026-10-01-v0.7-test-model",
    source: REFERENCE_SOURCE,
    recordedAt: "2026-10-01T12:00:00.000Z",
    runner: { cli: "claude", cliVersion: "1.0.0", requestedModel: "opus" },
    prompt: { sha256: `sha256:${"a".repeat(64)}`, matchedLiveSite: true },
    servedPaperVersion: "0.7",
    reportFile: "2026-10-01-v0.7-test-model.md",
    rawBlock: JSON.stringify(block()),
    block: block(),
  });

  it("accepts a reference run", () => {
    expect(AssessmentRecord.safeParse(record()).success).toBe(true);
  });

  it("accepts a v1 record (written under 5.1.0) and a v2 record", () => {
    expect(AssessmentRecord.safeParse(record()).success).toBe(true);
    const v2 = {
      ...record(),
      id: "2026-10-01-v0.9-test-model",
      servedPaperVersion: "0.9",
      reportFile: "2026-10-01-v0.9-test-model.md",
      block: blockV2(),
    };
    expect(AssessmentRecord.safeParse({ ...v2, rawBlock: JSON.stringify(blockV2()) }).success).toBe(true);
  });

  it("accepts only the reference source", () => {
    expect(AssessmentRecord.safeParse({ ...record(), source: "reader-submitted, unverified" }).success).toBe(false);
  });
});
