/**
 * The ONE wOS Desktop (D16): the app shell. React UI; talks only to `window.wos` (WosBridge). No Node, no network:
 * the main process does everything (SECURITY.md S-29).
 *
 * The masthead's navigation is merged from the active apps' manifests (the environment's `ActiveApps` with a verified
 * desktop module) and Build's manifest while S-40 holds, plus the shell's own APPS and SETTINGS. Build's screens are
 * the built-in Build app (src/apps/build); other apps' pages are shown by main in their own sandboxed view.
 */
import type { Me } from "@waronsaas/contracts";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BuildApp, BUILD_ROUTES } from "../apps/build/renderer/BuildApp.js";
import type { AppInfo, DesktopEvent, NavEntryView, ShellState } from "../shared/ipc.js";
import { wos } from "./lib/hooks.js";
import { Apps } from "./screens/Apps.js";
import { ModuleHost } from "./screens/ModuleHost.js";
import { Settings } from "./screens/Settings.js";
import { SignIn } from "./screens/SignIn.js";

type View = { kind: "apps" } | { kind: "settings" } | { kind: "sign_in" } | { kind: "app"; app: string; route: string };

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [shell, setShell] = useState<ShellState | null>(null);
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "apps" });
  const [navTick, setNavTick] = useState(0);

  const onMe = useCallback((m: Me) => setMe(m), []);

  useEffect(() => {
    const api = wos();
    api.appInfo().then(setInfo, () => undefined);
    Promise.all([api.account(), api.shellState()])
      .then(([a, s]) => {
        setMe(a.me);
        setShell(s);
        setBoot("ready");
        if (!a.me && s.environment.isDefault) setView({ kind: "sign_in" });
        else if (s.build.open) setView({ kind: "app", app: "build", route: BUILD_ROUTES.targets });
      })
      .catch((e: unknown) => {
        setBootError(e instanceof Error ? e.message : String(e));
        setBoot("ready");
        setView({ kind: "sign_in" });
      });
    return api.onEvent((e: DesktopEvent) => {
      if (e.kind === "shell") setShell(e.state);
    });
  }, []);

  // An app that left the navigation (disabled, yanked, Build turned off) leaves the screen too.
  useEffect(() => {
    if (!shell || view.kind !== "app") return;
    if (!shell.navigation.some((n) => n.app === view.app) && !(view.app === "build" && shell.build.open)) setView({ kind: "apps" });
  }, [shell, view]);

  const open = (n: NavEntryView) => {
    setView({ kind: "app", app: n.app, route: n.route });
    setNavTick((t) => t + 1);
  };

  const strip = (
    <div className="strip">
      <span>
        wOS DESKTOP {info ? `V${info.version}` : ""} / CONTRACTS {info?.contractsVersion ?? ""} / ENVIRONMENT{" "}
        {shell ? (shell.environment.descriptor?.name ?? shell.environment.url.replace(/^https?:\/\//, "")) : ""}{" "}
        {info?.fakeControlPlane ? <span className="fake">FAKE CONTROL PLANE</span> : null}
      </span>
      <span>{me ? `SIGNED IN: ${me.email}` : "NOT SIGNED IN TO A wOS ACCOUNT"}</span>
    </div>
  );

  if (boot === "loading" || !info || !shell) {
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

  if (view.kind === "sign_in" && !me) {
    return (
      <div className="frame" style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}>
        {strip}
        <div style={{ minHeight: 0 }}>
          {bootError ? <p className="fine">{bootError}</p> : null}
          <SignIn
            onSignedIn={(m) => {
              setMe(m);
              void wos()
                .shellState()
                .then((s) => {
                  setShell(s);
                  setView(s.build.open ? { kind: "app", app: "build", route: BUILD_ROUTES.targets } : { kind: "apps" });
                })
                .catch(() => setView({ kind: "apps" }));
            }}
            fake={info.fakeControlPlane}
            onSelfHosted={() => setView({ kind: "settings" })}
          />
        </div>
      </div>
    );
  }

  const buildRoute = view.kind === "app" && view.app === "build" ? view.route : BUILD_ROUTES.targets;
  const buildVisible = view.kind === "app" && view.app === "build";
  const moduleStatus = view.kind === "app" && view.app !== "build" ? (shell.modules.find((m) => m.app === view.app) ?? null) : null;

  let screen: ReactNode = null;
  if (view.kind === "apps") screen = <Apps me={me} shell={shell} onShell={setShell} onSettings={() => setView({ kind: "settings" })} />;
  else if (view.kind === "settings")
    screen = (
      <Settings
        me={me}
        info={info}
        shell={shell}
        onShell={setShell}
        onLoggedOut={() => {
          setMe(null);
          setView({ kind: "sign_in" });
        }}
      />
    );

  const current = (n: NavEntryView) => view.kind === "app" && view.app === n.app && view.route === n.route;

  return (
    <div className="frame">
      {strip}
      <header className="masthead">
        <span className="wordmark">wOS</span>
        <nav className="nav" aria-label="Main">
          {shell.navigation.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-current={current(n) ? "page" : undefined}
              onClick={() => open(n)}
              data-testid={`nav-${n.id}`}
            >
              {n.title}
            </button>
          ))}
          <button
            type="button"
            aria-current={view.kind === "apps" ? "page" : undefined}
            onClick={() => setView({ kind: "apps" })}
            data-testid="nav-apps"
          >
            APPS
          </button>
          <button
            type="button"
            aria-current={view.kind === "settings" ? "page" : undefined}
            onClick={() => setView({ kind: "settings" })}
            data-testid="nav-settings"
          >
            SETTINGS
          </button>
        </nav>
        <span className="who">
          {me ? (
            shell.build.open ? (
              <button
                className="btn btn--quiet"
                type="button"
                onClick={() => setView({ kind: "app", app: "build", route: BUILD_ROUTES.profile })}
                data-testid="nav-profile"
              >
                {me.handle ?? me.email} / PROFILE
              </button>
            ) : (
              me.email
            )
          ) : (
            <button className="btn btn--quiet" type="button" onClick={() => setView({ kind: "sign_in" })}>
              SIGN IN
            </button>
          )}
        </span>
      </header>
      {me && shell.build.open ? (
        <BuildApp route={buildRoute} navTick={navTick} visible={buildVisible} me={me} info={info} onMe={onMe} />
      ) : null}
      {buildVisible ? null : view.kind === "app" ? (
        <div className="body body--solo">
          <ModuleHost key={`${view.app}${view.route}`} app={view.app} route={view.route} status={moduleStatus} />
        </div>
      ) : (
        <div className="body body--solo">
          <main className="main">{screen}</main>
        </div>
      )}
    </div>
  );
}
