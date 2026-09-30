import { describe, expect, it } from "vitest";
import { ASSESSMENT_SCHEMA, AssessmentBlock, AssessmentRecord, extractAssessmentBlock, REFERENCE_SOURCE } from "../src/assessment.js";

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
    ["wrong schema", (b: ReturnType<typeof block>) => ((b as { schema: string }).schema = "wos-assessment/v2")],
  ])("rejects %s", (_name, mutate) => {
    const b = block();
    mutate(b);
    expect(AssessmentBlock.safeParse(b).success).toBe(false);
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

  it("accepts only the reference source", () => {
    expect(AssessmentRecord.safeParse({ ...record(), source: "reader-submitted, unverified" }).success).toBe(false);
  });
});
