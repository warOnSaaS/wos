import Link from "next/link";
import { Gauge } from "@/components/Gauge";
import { READINESS_LABEL, type Run, reportUrl, runDate } from "@/lib/assessments";
import { PENDING_LABEL } from "@/lib/self-assessment";
import { hasVersionPage, versionPath } from "@/lib/whitepaper-history";

type Block = Run["block"];

const THESES: { key: keyof Block["stage1"]["theses"]; name: string }[] = [
  { key: "control", name: "CONTROL" },
  { key: "efficiency", name: "EFFICIENCY" },
  { key: "softwareEngineering", name: "SOFTWARE ENG." },
  { key: "apoc", name: "APoC" },
];

/**
 * A version's self-assessment as score rings: the three headline scores (0-100), then a small ring for each thesis's
 * importance and compelling (each 0-10, drawn on its own scale), the verdict and readiness as text, the evaluator, the
 * date, the paper version and the full report. `run` null means no run is recorded for `version`: every ring is drawn
 * empty and dashed, reading PENDING, with no number.
 */
export function SelfAssessment({
  run,
  version,
  compact = false,
  headingLevel = 3,
}: {
  run: Run | null;
  version: string;
  compact?: boolean;
  headingLevel?: 3 | 4;
}) {
  const b = run?.block;
  const pending = !run;
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className={`selfassess${compact ? " selfassess--compact" : ""}`}>
      <div className="gauges gauges--head">
        <Gauge label="PROBLEM IMPORTANCE" value={b?.stage1?.importance?.total} max={100} pending={pending} size={compact ? "small" : "big"} />
        <Gauge label="APPROACH EFFECTIVENESS" value={b?.stage2?.effectiveness} max={100} pending={pending} size={compact ? "small" : "big"} />
        <Gauge label="APPROACH CREDIBILITY" value={b?.stage2?.credibility} max={100} pending={pending} size={compact ? "small" : "big"} />
      </div>
      <dl className="kv selfassess__facts">
        <div>
          <dt>Verdict</dt>
          <dd>{pending ? PENDING_LABEL : (b?.stage2?.verdict ?? "n/a")}</dd>
        </div>
        <div>
          <dt>Readiness</dt>
          <dd>{pending ? PENDING_LABEL : b?.stage2?.readiness ? READINESS_LABEL[b.stage2.readiness] : "n/a"}</dd>
        </div>
        <div>
          <dt>Evaluator</dt>
          <dd>
            {run ? (
              <>
                <code data-verbatim="">{run.block.evaluator.model}</code> <span className="dim">(self-reported; run with {run.runner.cli})</span>
              </>
            ) : (
              "No run recorded yet."
            )}
          </dd>
        </div>
        <div>
          <dt>Paper</dt>
          <dd>
            {hasVersionPage(version) ? <Link href={versionPath(version)}>v{version}</Link> : <>v{version}</>}
            {run ? (
              <>
                {" "}
                <span className="dim">
                  scored <time dateTime={runDate(run)}>{runDate(run)}</time>
                </span>{" "}
                <a href={reportUrl(run)}>FULL REPORT</a>
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      {compact ? null : (
        <>
          <H className="label">THE FOUR THESES · IMPORTANCE AND COMPELLING, EACH OF 10</H>
          <div className="gauges gauges--theses">
            {THESES.map((t) => (
              <div key={t.key} className="gauges__pair">
                <Gauge label={`${t.name} IMPORTANCE`} value={b?.stage1?.theses?.[t.key]?.importance} max={10} pending={pending} size="small" />
                <Gauge label={`${t.name} COMPELLING`} value={b?.stage1?.theses?.[t.key]?.compelling} max={10} pending={pending} size="small" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
