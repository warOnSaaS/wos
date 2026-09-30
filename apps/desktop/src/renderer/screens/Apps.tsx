/**
 * APPS (Amendment 01, D16): the organization's Your Apps / Available Apps on wOS Cloud (`listOrgApps`, `enableApp`,
 * `disableApp` on api.waronsaas.com), Build's device switch (S-40), and what is active in THIS environment with each
 * desktop module's install state (ModuleInstallMachine). Nothing here is invented: an empty list says so.
 */
import type { Me } from "@waronsaas/contracts";
import { useState } from "react";
import { type OrgApps, type OrgAppView, type ShellState, splitBridgeError } from "../../shared/ipc.js";
import { Empty, Loading, Notice, Section, Title } from "../components/ui.js";
import { upper } from "../lib/format.js";
import { useLoad, wos } from "../lib/hooks.js";
import { BuildDeviceSection } from "./Settings.js";

const BILLING: Record<string, string> = { base: "INCLUDED", addon: "ADD-ON", free: "FREE" };
const STATE: Record<string, string> = { available: "AVAILABLE", enabled: "ENABLED", disabled: "DISABLED", suspended: "SUSPENDED" };

export interface AppsViewProps {
  me: Me | null;
  shell: ShellState;
  orgApps: OrgApps | null;
  orgAppsProblem: string | null;
  busy: string | null;
  error: string | null;
  onSelectOrg: (id: string) => void;
  onEnable: (row: OrgAppView) => void;
  onDisable: (row: OrgAppView) => void;
  onBuildOnDevice: (on: boolean) => void;
  onSettings: () => void;
}

function explain(code: string, message: string): string {
  switch (code) {
    case "DEPENDENCY_NOT_ENABLED":
      return `ENABLE ITS REQUIRED APPS FIRST. ${message}`;
    case "DEPENDENT_ENABLED":
      return `ANOTHER ENABLED APP NEEDS IT. Disable that app first. ${message}`;
    case "CONFLICT":
      return `SOMEONE CHANGED IT FIRST. The list is reloaded; try again. ${message}`;
    case "FORBIDDEN":
      return `ONLY OWNERS AND ADMINS of this organization enable or disable apps. ${message}`;
    case "NOT_FOUND":
      return `NOT IN THE REGISTRY: the app has no published release yet. ${message}`;
    default:
      return `${code}. ${message}`;
  }
}

export { explain as explainAppsError };

export function AppsView(p: AppsViewProps) {
  const org = p.shell.organizations.find((o) => o.id === p.shell.organizationId) ?? null;
  const canChange = org?.role === "owner" || org?.role === "admin";
  const moduleOf = (id: string) => p.shell.modules.find((m) => m.app === id) ?? null;
  const device = (row: OrgAppView): string => {
    if (row.app.id === "build") return p.shell.build.open ? "BUILT IN / ON" : "BUILT IN / OFF";
    if (!row.app.surfaces.desktop.available) return "NO DESKTOP SURFACE";
    const m = moduleOf(row.app.id);
    if (!m) return "NOT ACTIVE IN THIS ENVIRONMENT";
    return m.state === "active" ? `INSTALLED ${m.active}` : "UNAVAILABLE";
  };
  const table = (rows: OrgAppView[], action: "enable" | "disable") => (
    <table className="tbl" data-testid={action === "disable" ? "your-apps" : "available-apps"}>
      <thead>
        <tr>
          <th>APP</th>
          <th>KIND</th>
          <th>VERSION</th>
          <th>PRICE</th>
          <th>STATE</th>
          <th>THIS DEVICE</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isApp = row.app.kind === "app";
          return (
            <tr key={row.app.id} data-testid={`app-${row.app.id}`}>
              <th scope="row">
                {row.app.name}
                <span className="fine" style={{ display: "block" }}>
                  {row.app.summary}
                </span>
              </th>
              <td>{upper(row.app.kind)}</td>
              <td>{row.app.currentVersion}</td>
              <td>{BILLING[row.app.billing] ?? upper(row.app.billing)}</td>
              <td>{isApp ? (STATE[row.entitlement.state] ?? upper(row.entitlement.state)) : "PART OF wOS"}</td>
              <td className="dim">{device(row)}</td>
              <td>
                {isApp && canChange ? (
                  <button
                    className={action === "enable" ? "btn btn--primary" : "btn btn--quiet"}
                    type="button"
                    disabled={p.busy !== null || row.entitlement.state === "suspended"}
                    onClick={() => (action === "enable" ? p.onEnable(row) : p.onDisable(row))}
                    data-testid={`${action}-${row.app.id}`}
                  >
                    {p.busy === row.app.id ? "WORKING..." : action === "enable" ? "ENABLE" : "DISABLE"}
                  </button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <>
      <Title label="APPS / ONE wOS" title="YOUR APPS">
        <p>
          wOS is one product. An organization enables apps, and every wOS surface shows the same set. Disabling an app hides it; its data is
          kept.
        </p>
      </Title>
      {p.error ? <Notice label="NOT CHANGED">{p.error}</Notice> : null}
      <Section n="01" title="ORGANIZATION" aside="wOS CLOUD">
        {!p.me ? (
          <Empty title="NOT SIGNED IN TO A wOS ACCOUNT">
            Sign in to your wOS account to manage wOS Cloud apps or use Build. A self-hosted environment works without one.
          </Empty>
        ) : p.shell.organizations.length === 0 ? (
          <Empty title="NO ORGANIZATIONS LISTED">The control plane listed no organization for this account.</Empty>
        ) : (
          <div className="btn-row" data-testid="orgs">
            {p.shell.organizations.map((o) => (
              <button
                key={o.id}
                type="button"
                className={o.id === p.shell.organizationId ? "btn btn--primary" : "btn btn--quiet"}
                aria-pressed={o.id === p.shell.organizationId}
                onClick={() => p.onSelectOrg(o.id)}
              >
                {o.name} / {o.kind === "personal" ? "PERSONAL" : "TEAM"} / {upper(o.role)}
              </button>
            ))}
          </div>
        )}
      </Section>
      {p.me ? (
        <>
          <Section n="02" title="YOUR APPS">
            {p.orgAppsProblem ? (
              <Notice label="COULD NOT LOAD THE APPS">{p.orgAppsProblem}</Notice>
            ) : !p.orgApps ? (
              <Loading what="YOUR APPS" />
            ) : p.orgApps.yourApps.length === 0 ? (
              <Empty title="NO APPS ENABLED">Nothing is enabled for this organization yet.</Empty>
            ) : (
              table(p.orgApps.yourApps, "disable")
            )}
          </Section>
          <Section n="03" title="AVAILABLE APPS">
            {!p.orgApps ? null : p.orgApps.availableApps.length === 0 ? (
              <Empty title="NOTHING ELSE TO ENABLE">The registry lists no other app with a published release.</Empty>
            ) : (
              table(p.orgApps.availableApps, "enable")
            )}
            {!canChange && org ? (
              <p className="fine">You are {upper(org.role)} here: only owners and admins enable or disable apps.</p>
            ) : null}
          </Section>
          <Section n="04" title="BUILD ON THIS DEVICE" aside="S-40">
            <BuildDeviceSection shell={p.shell} onBuildOnDevice={p.onBuildOnDevice} />
          </Section>
        </>
      ) : null}
      <Section n="05" title="THIS ENVIRONMENT" aside={p.shell.environment.descriptor?.name ?? p.shell.environment.url}>
        {p.shell.activeAppsProblem ? (
          <Notice label="NO ACTIVE APPS READ" quiet>
            {p.shell.activeAppsProblem}{" "}
            <button className="btn btn--quiet" type="button" onClick={p.onSettings}>
              SETTINGS / ENVIRONMENT
            </button>
          </Notice>
        ) : !p.shell.activeApps ? (
          <Loading what="THE ENVIRONMENT'S APPS" />
        ) : (
          <table className="tbl" data-testid="active-apps">
            <thead>
              <tr>
                <th>ACTIVE HERE</th>
                <th>VERSION</th>
                <th>WHY ACTIVE</th>
                <th>DESKTOP MODULE</th>
              </tr>
            </thead>
            <tbody>
              {p.shell.activeApps.map((a) => {
                const m = moduleOf(a.id);
                return (
                  <tr key={a.id}>
                    <th scope="row">{a.name}</th>
                    <td>{a.version}</td>
                    <td>{upper(a.source)}</td>
                    <td>
                      {!a.desktop || a.id === "build"
                        ? "NONE"
                        : !m
                          ? "NOT CHECKED YET"
                          : m.state === "active"
                            ? `VERIFIED AND ACTIVE ${m.active}${m.previous ? ` / PREVIOUS ${m.previous}` : ""}`
                            : (m.reason ?? "UNAVAILABLE")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

export function Apps({
  me,
  shell,
  onShell,
  onSettings,
}: {
  me: Me | null;
  shell: ShellState;
  onShell: (s: ShellState) => void;
  onSettings: () => void;
}) {
  const orgId = shell.organizationId;
  const [data, reload] = useLoad(() => (me && orgId ? wos().orgApps(orgId) : Promise.resolve(null)), [me?.id, orgId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = (kind: "enable" | "disable", row: OrgAppView) => {
    if (!orgId) return;
    setBusy(row.app.id);
    setError(null);
    const call =
      kind === "enable"
        ? wos().enableApp(orgId, row.app.id, row.entitlement.state === "available" ? null : row.entitlement.rowVersion)
        : wos().disableApp(orgId, row.app.id, row.entitlement.rowVersion);
    call
      .then(() => wos().shellState().then(onShell))
      .catch((e: unknown) => {
        const { code, message } = splitBridgeError(e);
        setError(explain(code, message));
      })
      .finally(() => {
        setBusy(null);
        reload();
      });
  };
  return (
    <AppsView
      me={me}
      shell={shell}
      orgApps={data.state === "ready" ? data.value : null}
      orgAppsProblem={data.state === "error" ? `${data.code}. ${data.message}` : null}
      busy={busy}
      error={error}
      onSelectOrg={(id) =>
        wos()
          .selectOrganization(id)
          .then(onShell, (e: unknown) => setError(splitBridgeError(e).message))
      }
      onEnable={(row) => change("enable", row)}
      onDisable={(row) => change("disable", row)}
      onBuildOnDevice={(on) =>
        wos()
          .setBuildOnDevice(on)
          .then(onShell, (e: unknown) => setError(splitBridgeError(e).message))
      }
      onSettings={onSettings}
    />
  );
}
