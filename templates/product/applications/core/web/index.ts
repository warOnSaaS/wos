/**
 * wOS Core's web page: Your Apps / Available Apps. On wOS Cloud the rows come from the control plane (`OrgApps`)
 * and owners and admins enable or disable apps; on a self-hosted Core the operator's WOS_APPS decides, so the page
 * lists what is active and says how to change it. Only real registry and environment data is shown.
 */
import { escapeHtml as e } from "../../../modules/core/src/html.js";

export type AppRow = {
  id: string;
  name: string;
  kind: "core" | "app" | "module";
  version: string;
  summary: string;
  status: string;
  /** cloud only: the entitlement rowVersion for optimistic concurrency (null = no row yet). */
  rowVersion: number | null;
  action: "enable" | "disable" | null;
};

export type AppsPageModel = {
  mode: "cloud" | "self_hosted";
  yourApps: AppRow[];
  /** null on a self-hosted Core: activation is the operator's configuration there. */
  availableApps: AppRow[] | null;
  csrf: string;
  notice: string | null;
};

const KIND: Record<AppRow["kind"], string> = { core: "CORE", app: "APP", module: "MODULE" };

function table(rows: AppRow[], csrf: string, empty: string): string {
  if (rows.length === 0) return `<p class="dim">${e(empty)}</p>`;
  const body = rows
    .map((r) => {
      const action = r.action
        ? `<form class="inline" method="post" action="/core/apps/${e(r.id)}/${r.action}"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="rowVersion" value="${r.rowVersion ?? ""}"><button>${r.action === "enable" ? "ENABLE" : "DISABLE"}</button></form>`
        : "";
      return `<tr data-app="${e(r.id)}"><td>${e(r.name)}<br><span class="dim">${e(r.summary)}</span></td><td>${KIND[r.kind]}</td><td>${e(r.version)}</td><td>${e(r.status)}</td><td>${action}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>APP</th><th>KIND</th><th>VERSION</th><th>STATUS</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
}

export function renderAppsPage(m: AppsPageModel): string {
  const notice = m.notice ? `<p class="error">${e(m.notice)}</p>` : "";
  const available =
    m.availableApps === null
      ? `<p>This environment is self-hosted. Its operator decides which apps run with <code>WOS_APPS</code> (for example <code>WOS_APPS=crm</code>) and restarts wOS Core. wOS Cloud entitlements do not apply here.</p>`
      : table(m.availableApps, m.csrf, "No other app is published in the wOS registry yet.");
  return `<h1>APPS</h1>${notice}
<h2>YOUR APPS</h2>${table(m.yourApps, m.csrf, "No app is active for this organization.")}
<h2>AVAILABLE APPS</h2>${available}`;
}
