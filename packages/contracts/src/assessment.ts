import { z } from "zod";

/**
 * White paper assessments (contracts 5.1.0; gaps and improvements added in 5.3.0 as wos-assessment/v2).
 *
 * An agent that evaluates the warOnSaaS white paper ends its report with one machine-readable score block:
 * a fenced code block tagged `wos-assessment` holding one JSON object that matches `AssessmentBlock`. The
 * block's human-readable spec lives in the paper (docs/whitepaper/WHITEPAPER.md, "The score block"); this file
 * is the machine spec and must stay in step with it.
 *
 * Only warOnSaaS's own reference runs are recorded (tools/assessments/run-reference.ts). Each run is one
 * `AssessmentRecord` in docs/assessments/<id>.json with the full report beside it in <id>.md.
 *
 * This module imports nothing but zod, so plain `node` scripts (type stripping) can import it by path.
 */

/** The first score block (paper v0.7 and v0.8). Still accepted: records written under it stay valid forever. */
export const ASSESSMENT_SCHEMA = "wos-assessment/v1" as const;
/**
 * Contracts 5.3.0: the same block plus two required, bounded lists, `gaps` and `improvements` (paper v0.9 onwards).
 *
 * Why a new schema string and not optional fields on v1: the schema string tells a reader which brief a block answers.
 * A v1 block with the lists missing and a v2 block that found no gap must stay distinguishable: in v2 the lists are
 * required (they may be empty, which says "the agent looked and found none"), so a run of a v0.9+ paper that skipped
 * them is refused instead of silently recorded as "no gaps". v1 records are untouched (AssessmentBlock accepts both),
 * so the change is additive and backward compatible (a MINOR contracts bump).
 */
export const ASSESSMENT_SCHEMA_V2 = "wos-assessment/v2" as const;
/** Every schema a recorded block may carry, oldest first. The last one is what the current paper asks for. */
export const ASSESSMENT_SCHEMAS = [ASSESSMENT_SCHEMA, ASSESSMENT_SCHEMA_V2] as const;
export type AssessmentSchema = (typeof ASSESSMENT_SCHEMAS)[number];
export const CURRENT_ASSESSMENT_SCHEMA = ASSESSMENT_SCHEMA_V2;
/** The info string of the fenced code block that carries the block in a report. */
export const ASSESSMENT_FENCE = "wos-assessment" as const;
export const ASSESSMENT_RECORD_SCHEMA = "wos-assessment-record/v1" as const;
/** The only source recorded today. Reader submissions were considered and dropped (founder, 2026-09-30). */
export const REFERENCE_SOURCE = "reference run by warOnSaaS" as const;

const Score = (max: number) => z.number().int().min(0).max(max);
export const AssessmentConfidence = z.enum(["low", "medium", "high"]);
export type AssessmentConfidence = z.infer<typeof AssessmentConfidence>;

/** One thesis, judged on its own: how important (0-10), how compelling the argument is (0-10), confidence. */
export const ThesisScore = z.object({ importance: Score(10), compelling: Score(10), confidence: AssessmentConfidence });
export type ThesisScore = z.infer<typeof ThesisScore>;

export const THESES = ["control", "efficiency", "softwareEngineering", "apoc"] as const;
export const RUBRIC_DIMENSIONS = ["impact", "breadth", "urgency", "evidence", "tractability"] as const;
export const READINESS = ["concept", "prototype", "pilot", "limited_production", "demonstrated_scale"] as const;
export const VERDICTS = ["ignore", "watch", "test", "participate"] as const;

/** The fields v1 and v2 share (everything in v1 except its schema string). */
const blockCore = z.object({
  /** The paper version the agent read, from the paper's header table, e.g. "0.7". */
  paperVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/, "a version like 0.7 or 0.7.1"),
  /** Self-reported by the agent; never verified. */
  evaluator: z.object({ model: z.string().trim().min(1).max(100), product: z.string().trim().min(1).max(100) }),
  /** The day the agent wrote the report (UTC), YYYY-MM-DD. */
  date: z.iso.date(),
  /** Stage 1: the problem (Part I), judged as if warOnSaaS did not exist. */
  stage1: z.object({
    problemReal: z.enum(["yes", "partly", "no"]),
    /** Importance for humanity: five dimensions 0-20; total is their sum (0-100). */
    importance: z.object({
      total: Score(100),
      impact: Score(20),
      breadth: Score(20),
      urgency: Score(20),
      evidence: Score(20),
      tractability: Score(20),
    }),
    theses: z.object({
      control: ThesisScore,
      efficiency: ThesisScore,
      softwareEngineering: ThesisScore,
      apoc: ThesisScore,
    }),
    confidence: AssessmentConfidence,
  }),
  /** Stage 2: the approach (Part II), judged against stage 1. */
  stage2: z.object({
    /** Is it an efficient, well-targeted attack on a problem of that size (0-100). */
    effectiveness: Score(100),
    credibility: Score(100),
    readiness: z.enum(READINESS),
    verdict: z.enum(VERDICTS),
    confidence: AssessmentConfidence,
  }),
});

/** Gaps and improvements (v2): at most this many of each, so a block stays small and every item is specific. */
export const MAX_GAPS = 10;
export const MAX_IMPROVEMENTS = 10;
export const SEVERITIES = ["high", "medium", "low"] as const;
/** Which part of the paper an item concerns: Part I (the thesis and its materiality) or Part II (the approach). */
export const PAPER_PARTS = ["I", "II"] as const;
/**
 * A gap or improvement id: a lowercase slug, 3 to 48 characters. It is how the gap register and the paper's changelog
 * refer to the item ("Gaps addressed: `materiality-duplication-unsourced`"). Matching across runs is exact on this id.
 */
export const GAP_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ItemId = z.string().min(3).max(48).regex(GAP_ID_RE, "a lowercase slug like materiality-duplication-unsourced");
/** The scores an improvement says it would raise (the block's own score names). */
export const IMPROVABLE_SCORES = ["importance", ...RUBRIC_DIMENSIONS, ...THESES, "effectiveness", "credibility", "readiness"] as const;

/** Something missing or wrong in the paper, as the evaluating agent sees it. */
export const AssessmentGap = z.object({
  id: ItemId,
  /** A short title, one line. */
  title: z.string().trim().min(3).max(120),
  /** The paper section or thesis it concerns, as the paper names it: "section 3", "thesis 4 (APoC)", "section 8". */
  concerns: z.string().trim().min(1).max(80),
  part: z.enum(PAPER_PARTS),
  severity: z.enum(SEVERITIES),
});
export type AssessmentGap = z.infer<typeof AssessmentGap>;

/** A concrete change that would raise the scores, tied to a gap of the same block where it answers one. */
export const AssessmentImprovement = z.object({
  id: ItemId,
  /** The change, concretely: what to add, test, publish or cut. */
  change: z.string().trim().min(3).max(240),
  /** The id of the gap (in this block's `gaps`) it answers, or null when it answers none. */
  gap: ItemId.nullable(),
  /** Which of the block's scores it would raise (1 to 4 of IMPROVABLE_SCORES). */
  raises: z.array(z.enum(IMPROVABLE_SCORES)).min(1).max(4),
});
export type AssessmentImprovement = z.infer<typeof AssessmentImprovement>;

type Ctx = z.RefinementCtx;
function checkTotal(b: z.infer<typeof blockCore>, ctx: Ctx) {
  const i = b.stage1.importance;
  const sum = i.impact + i.breadth + i.urgency + i.evidence + i.tractability;
  if (sum !== i.total) {
    ctx.addIssue({
      code: "custom",
      path: ["stage1", "importance", "total"],
      message: `total must equal the sum of the five dimensions (${sum}), got ${i.total}`,
    });
  }
}

/** wos-assessment/v1 (contracts 5.1.0), unchanged. */
export const AssessmentBlockV1 = blockCore.safeExtend({ schema: z.literal(ASSESSMENT_SCHEMA) }).superRefine(checkTotal);
export type AssessmentBlockV1 = z.infer<typeof AssessmentBlockV1>;

/** wos-assessment/v2 (contracts 5.3.0): v1 plus the required, bounded `gaps` and `improvements`. */
export const AssessmentBlockV2 = blockCore
  .safeExtend({
    schema: z.literal(ASSESSMENT_SCHEMA_V2),
    gaps: z.array(AssessmentGap).max(MAX_GAPS),
    improvements: z.array(AssessmentImprovement).max(MAX_IMPROVEMENTS),
  })
  .superRefine((b, ctx) => {
    checkTotal(b, ctx);
    const dup = (list: { id: string }[], key: "gaps" | "improvements") => {
      const seen = new Set<string>();
      list.forEach((x, i) => {
        if (seen.has(x.id)) ctx.addIssue({ code: "custom", path: [key, i, "id"], message: `duplicate ${key} id "${x.id}"` });
        seen.add(x.id);
      });
    };
    dup(b.gaps, "gaps");
    dup(b.improvements, "improvements");
    const ids = new Set(b.gaps.map((g) => g.id));
    b.improvements.forEach((x, i) => {
      if (x.gap !== null && !ids.has(x.gap)) {
        ctx.addIssue({ code: "custom", path: ["improvements", i, "gap"], message: `"${x.gap}" is not the id of a gap in this block` });
      }
    });
  });
export type AssessmentBlockV2 = z.infer<typeof AssessmentBlockV2>;

/** Any recorded score block: v1 or v2, told apart by `schema`. */
export const AssessmentBlock = z.discriminatedUnion("schema", [AssessmentBlockV1, AssessmentBlockV2]);
export type AssessmentBlock = z.infer<typeof AssessmentBlock>;

/** One recorded reference run: docs/assessments/<id>.json. */
export const AssessmentRecord = z.object({
  record: z.literal(ASSESSMENT_RECORD_SCHEMA),
  /** The file stem: <date>-v<paper version>-<model slug>[-n]. */
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-v\d+\.\d+(\.\d+)?-[a-z0-9][a-z0-9.-]{0,80}$/),
  source: z.enum([REFERENCE_SOURCE]),
  /** When the run finished (the runner's clock). */
  recordedAt: z.iso.datetime({ offset: true }),
  runner: z.object({
    /** Which local CLI ran the evaluation. */
    cli: z.enum(["claude", "codex"]),
    cliVersion: z.string().max(200).nullable(),
    /** The model the runner asked the CLI for (the block's evaluator.model is what the agent reported). */
    requestedModel: z.string().min(1).max(100),
  }),
  prompt: z.object({
    /** sha256 of the exact prompt text sent (HANDOFF_PROMPT from apps/web/lib/handoff-prompt.ts). */
    sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    /** Whether the prompt was checked against the live site before the run. */
    matchedLiveSite: z.boolean(),
  }),
  /** The paper version https://waronsaas.com/whitepaper.md served when the run started. */
  servedPaperVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  /** The full report, verbatim, beside this file. */
  reportFile: z.string().regex(/^[a-z0-9.-]+\.md$/),
  /** The block exactly as the agent wrote it (JSON text inside the fence). */
  rawBlock: z.string().min(2),
  /** v1 or v2 (5.3.0); the record's own schema is unchanged. */
  block: AssessmentBlock,
});
export type AssessmentRecord = z.infer<typeof AssessmentRecord>;

export type ExtractResult =
  | { ok: true; raw: string; block: AssessmentBlock }
  | { ok: false; error: string; raw: string | null; issues?: unknown };

/**
 * Finds the score block in a report and validates it. The last fenced block tagged `wos-assessment` wins;
 * failing that, the last ```json block that declares a wos-assessment schema (v1 or v2). Never guesses values.
 */
export function extractAssessmentBlock(report: string): ExtractResult {
  const fences = [...report.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_/.-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)];
  const tagged = fences.filter((m) => m[2] === ASSESSMENT_FENCE);
  const fallback = fences.filter((m) => (m[2] === "json" || m[2] === "") && ASSESSMENT_SCHEMAS.some((x) => m[3]!.includes(x)));
  const hit = (tagged.length ? tagged : fallback).at(-1);
  if (!hit) return { ok: false, error: `no \`\`\`${ASSESSMENT_FENCE} block found in the report`, raw: null };
  const raw = hit[3]!.trim();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `the ${ASSESSMENT_FENCE} block is not valid JSON: ${(e as Error).message}`, raw };
  }
  const parsed = AssessmentBlock.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `the block does not match ${ASSESSMENT_SCHEMAS.join(" or ")}: ${first ? `${first.path.join(".")}: ${first.message}` : "invalid"}`,
      raw,
      issues: parsed.error.issues,
    };
  }
  return { ok: true, raw, block: parsed.data };
}

/** True for a block that carries gaps and improvements (wos-assessment/v2). */
export function hasGaps(b: AssessmentBlock): b is AssessmentBlockV2 {
  return b.schema === ASSESSMENT_SCHEMA_V2;
}
