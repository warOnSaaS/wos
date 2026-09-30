/**
 * Build (D16), the built-in wOS app for contributing: what wOS Desktop was before Amendment 01. The shell shows it
 * only while S-40 holds, and its navigation comes from src/apps/build/wos-app.json (SNIPER LIST, MY WORK,
 * CONTRIBUTIONS); PROFILE opens from the account button. The activity pane streams orchestrator events per run.
 * It stays mounted while Build is on, so runs keep streaming when another app is on screen.
 */
import type { DomainEvent, LocalStatus, Me } from "@waronsaas/contracts";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { AppInfo, DesktopEvent, RunInfo } from "../../../shared/ipc.js";
import { eventLines } from "../../../renderer/lib/format.js";
import { wos } from "../../../renderer/lib/hooks.js";
import { Contributions, Profile, Work } from "./Account.js";
import { type ActivityFilter, ActivityView, type LogEntry } from "./Activity.js";
import { LinkGithub } from "./LinkGithub.js";
import { Feature, type Route, SniperList, Target } from "./Targets.js";

export const BUILD_ROUTES = {
  targets: "/build/targets",
  work: "/build/work",
  contributions: "/build/contributions",
  profile: "/build/profile",
} as const;

const LOG_LIMIT = 3000;

export function BuildApp({
  route,
  navTick,
  visible,
  me,
  info,
  onMe,
}: {
  route: string;
  /** Changes on every click of a Build navigation entry: SNIPER LIST goes back to the list. */
  navTick: number;
  visible: boolean;
  me: Me;
  info: AppInfo;
  onMe: (me: Me) => void;
}) {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [target, setTarget] = useState<Route>({ name: "targets" });
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [server, setServer] = useState<DomainEvent[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [pollSeconds, setPollSeconds] = useState(5);
  const [githubLater, setGithubLater] = useState(false);
  const seq = useRef(0);
  const lastEventId = useRef<number | undefined>(undefined);

  const refreshStatus = useCallback(() => {
    // Status posts the provider and toolchain attestations the claim's eligibility check reads.
    void wos()
      .status()
      .then((s) => {
        setStatus(s);
        if (s.me) onMe(s.me);
      })
      .catch(() => undefined);
  }, [onMe]);

  useEffect(() => {
    const api = wos();
    api.getSettings().then(
      (s) => setPollSeconds(s.eventsPollSeconds),
      () => undefined,
    );
    refreshStatus();
    // Re-attach to runs started before this view mounted.
    api
      .runs()
      .then((snapshots) => {
        setRuns(snapshots.map(({ events: _e, ...r }) => r));
        const restored: LogEntry[] = [];
        for (const s of snapshots)
          for (const e of s.events)
            for (const line of eventLines(e)) restored.push({ seq: seq.current++, runId: s.id, at: s.startedAt, line });
        setEntries(restored.slice(-LOG_LIMIT));
      })
      .catch(() => undefined);
    return api.onEvent((e: DesktopEvent) => {
      if (e.kind === "run") {
        setRuns((prev) => {
          const i = prev.findIndex((r) => r.id === e.run.id);
          if (i < 0) return [...prev, e.run];
          const next = [...prev];
          next[i] = e.run;
          return next;
        });
        if (e.run.state === "running") setFilter((f) => (f === "all" || f === "server" ? f : e.run.id));
        return;
      }
      if (e.kind === "orchestrator") {
        const ev = e.event;
        if (ev.type === "attempt" && e.runId) {
          setRuns((prev) => prev.map((r) => (r.id === e.runId ? { ...r, attempt: ev.attempt } : r)));
        }
        const lines = eventLines(ev);
        if (lines.length === 0) return;
        setEntries((prev) => {
          const next = prev.concat(lines.map((line) => ({ seq: seq.current++, runId: e.runId, at: e.at, line })));
          return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
        });
      }
      if (e.kind === "deep_link") {
        setEntries((prev) =>
          prev.concat([
            {
              seq: seq.current++,
              runId: null,
              at: new Date().toISOString(),
              line: { tag: "DEEP LINK", text: e.detail, strong: !e.accepted },
            },
          ]),
        );
      }
    });
  }, [refreshStatus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: navTick is the trigger.
  useEffect(() => {
    if (route === BUILD_ROUTES.targets) setTarget({ name: "targets" });
  }, [route, navTick]);

  // Poll the account's server events while Build is on (the spec: clients poll every 5 s while active).
  useEffect(() => {
    let live = true;
    const tick = () =>
      wos()
        .myEvents(lastEventId.current)
        .then((page) => {
          if (!live) return;
          lastEventId.current = page.lastId;
          if (page.items.length) setServer((prev) => prev.concat(page.items).slice(-500));
        })
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, pollSeconds * 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pollSeconds]);

  if (!visible) return null;

  if (!me.github && !githubLater) {
    return (
      <LinkGithub
        me={me}
        onLinked={(m) => {
          onMe(m);
          refreshStatus();
        }}
        onLater={() => setGithubLater(true)}
      />
    );
  }

  let screen: ReactNode;
  if (route === BUILD_ROUTES.work) screen = <Work me={me} />;
  else if (route === BUILD_ROUTES.contributions) screen = <Contributions info={info} />;
  else if (route === BUILD_ROUTES.profile)
    screen = <Profile me={me} info={info} status={status} onStatus={(s) => (setStatus(s), s.me && onMe(s.me))} />;
  else if (target.name === "targets") screen = <SniperList go={setTarget} />;
  else if (target.name === "target") screen = <Target slug={target.slug} go={setTarget} />;
  else
    screen = (
      <Feature
        slug={target.slug}
        targetName={target.targetName}
        feature={target.feature}
        capability={target.capability}
        me={me}
        go={setTarget}
        runs={runs}
      />
    );

  return (
    <div className="body">
      <main className="main">{screen}</main>
      <ActivityView
        runs={runs}
        entries={entries}
        server={server}
        filter={filter}
        onFilter={setFilter}
        polling={`POLLING EVERY ${pollSeconds}S`}
      />
    </div>
  );
}
