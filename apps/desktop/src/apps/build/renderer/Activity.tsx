/**
 * The activity / terminal pane: every OrchestratorEvent as it streams (tagged per run, so a Claude build
 * and a Codex build show side by side), plus the account's server events from `events()`.
 */
import type { DomainEvent } from "@waronsaas/contracts";
import { useEffect, useRef } from "react";
import type { RunInfo } from "../../../shared/ipc.js";
import { clock, type LogLine, upper } from "../../../renderer/lib/format.js";

export interface LogEntry {
  seq: number;
  runId: string | null;
  at: string;
  line: LogLine;
}

export type ActivityFilter = "all" | "server" | string;

function runLabel(r: RunInfo, index: number): string {
  const n = `RUN ${String(index + 1).padStart(2, "0")}`;
  if (r.kind === "build") return `${n} BUILD ${r.attempt?.abu ?? r.subject.slice(0, 8)} ${r.model ? r.model.toUpperCase() : ""}`.trim();
  return `${n} REVIEW ${r.subject.toUpperCase()}`;
}

export function serverEventLine(e: DomainEvent): LogLine {
  const payload = (e as { payload?: Record<string, unknown> }).payload ?? {};
  const bits = Object.entries(payload)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  return { tag: "SERVER", text: `${(e as { type: string }).type} ${bits}`.trim(), strong: false };
}

export function ActivityView({
  runs,
  entries,
  server,
  filter,
  onFilter,
  polling,
}: {
  runs: RunInfo[];
  entries: LogEntry[];
  server: DomainEvent[];
  filter: ActivityFilter;
  onFilter: (f: ActivityFilter) => void;
  polling: string;
}) {
  const bottom = useRef<HTMLLIElement | null>(null);
  const shown =
    filter === "server"
      ? server.map((e, i): LogEntry => ({ seq: i, runId: null, at: e.occurredAt, line: serverEventLine(e) }))
      : filter === "all"
        ? entries
        : entries.filter((e) => e.runId === filter);
  const selectedRun = runs.find((r) => r.id === filter) ?? null;
  const runningCount = runs.filter((r) => r.state === "running").length;
  const runNo = new Map(runs.map((r, i) => [r.id, String(i + 1).padStart(2, "0")]));

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest line whenever a line is added.
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [shown.length]);

  return (
    <aside className="activity" aria-label="Activity" data-testid="activity">
      <div className="activity-h">
        <h2>ACTIVITY</h2>
        <span className="label">{runningCount === 0 ? "IDLE" : `${runningCount} RUNNING`}</span>
      </div>
      <div className="runs">
        <button type="button" aria-pressed={filter === "all"} onClick={() => onFilter("all")}>
          <span>ALL</span>
          <span className="dim">EVERY RUN AND SIGN-IN</span>
          <span className="state">{entries.length} LINES</span>
        </button>
        {runs.map((r, i) => (
          <button type="button" key={r.id} aria-pressed={filter === r.id} onClick={() => onFilter(r.id)} data-testid={`run-${i + 1}`}>
            <span>{upper(r.kind)}</span>
            <span>{runLabel(r, i)}</span>
            <span className="state">{r.state === "running" ? "RUNNING" : r.state === "passed" ? "PASSED" : "FAILED"}</span>
          </button>
        ))}
        <button type="button" aria-pressed={filter === "server"} onClick={() => onFilter("server")}>
          <span>SERVER</span>
          <span className="dim">MY EVENTS FROM THE CONTROL PLANE</span>
          <span className="state">{server.length}</span>
        </button>
      </div>
      {selectedRun && selectedRun.state !== "running" && selectedRun.explanation ? (
        <div className="outcome" data-testid="run-outcome">
          <span className="label">{selectedRun.state === "passed" ? "OUTCOME: PASSED" : `OUTCOME: FAILED ${selectedRun.code ?? ""}`}</span>
          {selectedRun.explanation}
        </div>
      ) : (
        <div />
      )}
      <div className="term">
        {shown.length === 0 ? (
          <p className="dim">
            {filter === "server"
              ? "NO SERVER EVENTS YET."
              : "NOTHING HAS RUN YET. BUILD A UNIT AND ITS LEASE, AGENT OUTPUT AND CHECKS STREAM HERE."}
          </p>
        ) : (
          <ol>
            {shown.map((e) => (
              <li key={`${e.runId ?? "g"}-${e.seq}`} className={e.line.strong ? "strong" : undefined}>
                <span className="t">{clock(e.at)}</span>
                <span className="tag">
                  {filter === "all" && e.runId ? `${runNo.get(e.runId) ?? "--"} ` : ""}
                  {e.line.tag}
                </span>
                <span className="msg">{e.line.text}</span>
              </li>
            ))}
            <li ref={bottom}>
              <span className="t" />
              <span className="tag" />
              <span className={runningCount > 0 ? "msg cursor" : "msg"} />
            </li>
          </ol>
        )}
      </div>
      <div className="activity-f">
        <span>{polling}</span>
        <span>{runs.length} RUNS THIS SESSION</span>
      </div>
    </aside>
  );
}
