/**
 * wOS Desktop renderer. React UI; talks only to `window.wos` (WosBridge). No Node, no network: the
 * main process does everything through the one orchestrator (SECURITY.md S-29).
 */
import type { DomainEvent, LocalStatus, Me } from "@waronsaas/contracts";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { AppInfo, DesktopEvent, RunInfo } from "../shared/ipc.js";
import { type ActivityFilter, ActivityView, type LogEntry } from "./components/Activity.js";
import { eventLines } from "./lib/format.js";
import { wos } from "./lib/hooks.js";
import { Contributions, Profile, Settings, Work } from "./screens/Account.js";
import { LinkGithub, SignIn } from "./screens/SignIn.js";
import { Feature, type Route, SniperList, Target } from "./screens/Targets.js";

type Tab = "targets" | "work" | "contributions" | "profile" | "settings";
const TABS: Array<[Tab, string]> = [
  ["targets", "SNIPER LIST"],
  ["work", "MY WORK"],
  ["contributions", "CONTRIBUTIONS"],
  ["profile", "PROFILE"],
  ["settings", "SETTINGS"],
];
const LOG_LIMIT = 3000;

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [boot, setBoot] = useState<"loading" | "signed_out" | "link_github" | "ready">("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("targets");
  const [route, setRoute] = useState<Route>({ name: "targets" });
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [server, setServer] = useState<DomainEvent[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [pollSeconds, setPollSeconds] = useState(5);
  const seq = useRef(0);
  const lastEventId = useRef<number | undefined>(undefined);

  const afterSignIn = useCallback((m: Me) => {
    setMe(m);
    setBoot(m.github ? "ready" : "link_github");
    // Status posts the provider and toolchain attestations the claim's eligibility check reads.
    void wos()
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const api = wos();
    api.appInfo().then(setInfo, () => undefined);
    api.getSettings().then(
      (s) => setPollSeconds(s.eventsPollSeconds),
      () => undefined,
    );
    api
      .status()
      .then((s) => {
        setStatus(s);
        setMe(s.me);
        setBoot(s.me ? (s.me.github ? "ready" : "link_github") : "signed_out");
      })
      .catch((e: unknown) => {
        setBootError(e instanceof Error ? e.message : String(e));
        setBoot("signed_out");
      });
    // Re-attach to runs started before this window loaded.
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
  }, []);

  // Poll the account's server events while signed in (the spec: clients poll every 5 s while active).
  useEffect(() => {
    if (!me) return;
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
  }, [me, pollSeconds]);

  const go = (r: Route) => {
    setTab("targets");
    setRoute(r);
  };

  const stripRight = me ? `SIGNED IN: ${me.email} / GITHUB: ${me.github?.login ?? "NOT LINKED"}` : "NOT SIGNED IN";

  const strip = (
    <div className="strip">
      <span>
        wOS DESKTOP {info ? `V${info.version}` : ""} / CONTRACTS {info?.contractsVersion ?? ""} / CONTROL PLANE{" "}
        {info?.apiBaseUrl.replace(/^https:\/\//, "") ?? ""}{" "}
        {info?.fakeControlPlane ? <span className="fake">FAKE CONTROL PLANE</span> : null}
      </span>
      <span>{stripRight}</span>
    </div>
  );

  if (boot === "loading" || !info) {
    return (
      <div className="frame">
        {strip}
        <div className="masthead">
          <span className="wordmark">wOS</span>
        </div>
        <main className="main">
          <p className="dim">STARTING...</p>
        </main>
      </div>
    );
  }

  if (boot === "signed_out" || !me) {
    return (
      <div className="frame" style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}>
        {strip}
        <div style={{ minHeight: 0 }}>
          {bootError ? <p className="fine">{bootError}</p> : null}
          <SignIn onSignedIn={afterSignIn} fake={info.fakeControlPlane} />
        </div>
      </div>
    );
  }

  if (boot === "link_github") {
    return (
      <div className="frame" style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}>
        {strip}
        <div style={{ minHeight: 0 }}>
          <LinkGithub
            me={me}
            onLinked={(m) => {
              setMe(m);
              setBoot("ready");
              void wos()
                .status()
                .then(setStatus)
                .catch(() => undefined);
            }}
            onLater={() => setBoot("ready")}
          />
        </div>
      </div>
    );
  }

  let screen: ReactNode;
  if (tab === "targets") {
    if (route.name === "targets") screen = <SniperList go={go} />;
    else if (route.name === "target") screen = <Target slug={route.slug} go={go} />;
    else
      screen = (
        <Feature
          slug={route.slug}
          targetName={route.targetName}
          feature={route.feature}
          capability={route.capability}
          me={me}
          go={go}
          runs={runs}
        />
      );
  } else if (tab === "work") screen = <Work me={me} />;
  else if (tab === "contributions") screen = <Contributions info={info} />;
  else if (tab === "profile")
    screen = <Profile me={me} info={info} status={status} onStatus={(s) => (setStatus(s), s.me && setMe(s.me))} />;
  else
    screen = (
      <Settings
        me={me}
        info={info}
        onLoggedOut={() => {
          setMe(null);
          setStatus(null);
          setBoot("signed_out");
        }}
      />
    );

  return (
    <div className="frame">
      {strip}
      <header className="masthead">
        <span className="wordmark">wOS</span>
        <nav className="nav" aria-label="Main">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? "page" : undefined}
              onClick={() => {
                setTab(k);
                if (k === "targets") setRoute({ name: "targets" });
              }}
              data-testid={`tab-${k}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="who">
          {me.github ? (
            <>
              {me.handle ?? me.github.login} / {status ? `${status.eligibleRoles.length} ROLES READY` : "STATUS NOT RUN"}
            </>
          ) : (
            <button className="btn btn--quiet" type="button" onClick={() => setBoot("link_github")}>
              LINK GITHUB
            </button>
          )}
        </span>
      </header>
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
    </div>
  );
}
