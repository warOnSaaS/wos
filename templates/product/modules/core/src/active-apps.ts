/**
 * ActiveApps (WOS-APP-PROTOCOL sections 7 and 8). On wOS Cloud the environment token's `apps` claim decides; on a
 * self-hosted Core the operator's WOS_APPS decides and wOS Cloud is never consulted (S-41). Either way only apps
 * compiled into this Core whose `requires.wos` accepts this Core's version are activated.
 */
import { type ActiveApps, activeAppIds, CORE_APP_ID, satisfiesRange } from "../../core-contracts/src/index.js";
import type { Bundle } from "./bundle.js";

export type ActiveApp = ActiveApps["apps"][number];

/** Parses WOS_APPS ("crm,chat"). Only kind-app ids; core is implicit and modules follow the apps that need them. */
export function parseWosApps(value: string | undefined, bundle: Bundle): string[] {
  const ids = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const id of ids) {
    const app = bundle.apps.get(id);
    if (!app) throw new Error(`WOS_APPS names ${id}, which this Core does not bundle (bundled: ${[...bundle.apps.keys()].join(", ")})`);
    if (app.manifest.app.kind === "core") throw new Error("WOS_APPS: core is always active; do not list it");
    if (app.manifest.app.kind === "module") throw new Error(`WOS_APPS: ${id} is a module; it is active while an app that needs it is`);
    if (!app.manifest.hosting.selfHost.supported) throw new Error(`WOS_APPS: ${id} does not support self-hosting`);
  }
  return [...new Set(ids)].sort();
}

function compatible(bundle: Bundle, id: string): boolean {
  const app = bundle.apps.get(id);
  return app !== undefined && satisfiesRange(bundle.coreVersion, app.manifest.requires.wos);
}

function build(bundle: Bundle, ids: readonly string[], source: (id: string) => ActiveApp["source"]): ActiveApp[] {
  return ids.map((id) => {
    const app = bundle.apps.get(id)!;
    return { id, version: app.manifest.app.version, source: source(id), manifest: app.manifest };
  });
}

/** Self-hosted: core, the configured apps and the modules they require. */
export function selfHostedActiveApps(bundle: Bundle, configured: readonly string[]): ActiveApp[] {
  const enabled = configured.filter((id) => compatible(bundle, id));
  const ids = activeAppIds(bundle.registry, enabled);
  const set = new Set(enabled);
  return build(bundle, ids, (id) => (id === CORE_APP_ID ? "core" : set.has(id) ? "self_host_config" : "dependency"));
}

/**
 * wOS Cloud: the token's `apps` claim (core, enabled apps and their modules at issue time). Claimed ids this Core
 * does not bundle (Build, which is never an environment feature, or an app newer than this deployment) are left
 * out, and so is an app whose requirement is not active.
 */
export function cloudActiveApps(bundle: Bundle, claimed: readonly string[]): ActiveApp[] {
  const claimedSet = new Set(claimed);
  const usable = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return true;
    seen.add(id);
    const app = bundle.apps.get(id);
    if (!app || !claimedSet.has(id) || !compatible(bundle, id)) return false;
    return app.manifest.requires.apps.every((d) => usable(d.id, seen));
  };
  const ids = [...new Set([CORE_APP_ID, ...claimed])].filter((id) => id === CORE_APP_ID || usable(id)).sort();
  return build(bundle, ids, (id) => {
    if (id === CORE_APP_ID) return "core";
    return bundle.apps.get(id)!.manifest.app.kind === "module" ? "dependency" : "entitlement";
  });
}
