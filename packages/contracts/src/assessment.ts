import { z } from "zod";

/**
 * White paper assessments (contracts 5.1.0).
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

export const ASSESSMENT_SCHEMA = "wos-assessment/v1" as const;
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

export const AssessmentBlock = z
  .object({
    schema: z.literal(ASSESSMENT_SCHEMA),
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
  })
  .superRefine((b, ctx) => {
    const i = b.stage1.importance;
    const sum = i.impact + i.breadth + i.urgency + i.evidence + i.tractability;
    if (sum !== i.total) {
      ctx.addIssue({
        code: "custom",
        path: ["stage1", "importance", "total"],
        message: `total must equal the sum of the five dimensions (${sum}), got ${i.total}`,
      });
    }
  });
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
  block: AssessmentBlock,
});
export type AssessmentRecord = z.infer<typeof AssessmentRecord>;

export type ExtractResult =
  | { ok: true; raw: string; block: AssessmentBlock }
  | { ok: false; error: string; raw: string | null; issues?: unknown };

/**
 * Finds the score block in a report and validates it. The last fenced block tagged `wos-assessment` wins;
 * failing that, the last ```json block that declares "schema": "wos-assessment/v1". Never guesses values.
 */
export function extractAssessmentBlock(report: string): ExtractResult {
  const fences = [...report.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_/.-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)];
  const tagged = fences.filter((m) => m[2] === ASSESSMENT_FENCE);
  const fallback = fences.filter((m) => (m[2] === "json" || m[2] === "") && m[3]!.includes(ASSESSMENT_SCHEMA));
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
      error: `the block does not match ${ASSESSMENT_SCHEMA}: ${first ? `${first.path.join(".")}: ${first.message}` : "invalid"}`,
      raw,
      issues: parsed.error.issues,
    };
  }
  return { ok: true, raw, block: parsed.data };
}
