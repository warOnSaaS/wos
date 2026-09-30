/**
 * The applications compiled into this Core (A10). Validates every manifest, screen and server route at start, so a
 * broken app stops the boot instead of failing at request time.
 */
import { CORE_APP_ID, MobileScreen, satisfiesRange, WosAppManifest } from "../../core-contracts/src/index.js";
import type { BundledApp, BundledAppInput } from "./app-module.js";
import { isDeclared } from "./permissions.js";

export type Bundle = {
  coreVersion: string;
  apps: ReadonlyMap<string, BundledApp>;
  /** The shape `activeAppIds` takes. */
  registry: ReadonlyMap<string, { kind: WosAppManifest["app"]["kind"]; dependencies: readonly { id: string; version: string }[] }>;
};

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export function loadBundle(inputs: readonly BundledAppInput[]): Bundle {
  const apps = new Map<string, BundledApp>();
  for (const input of inputs) {
    const parsed = WosAppManifest.safeParse(input.manifest);
    if (!parsed.success) throw new Error(`invalid wos-app.json: ${parsed.error.message}`);
    const manifest = parsed.data;
    const id = manifest.app.id;
    if (apps.has(id)) throw new Error(`app ${id} is bundled twice`);

    const screens = (input.screens ?? []).map((s, i) => {
      const r = MobileScreen.safeParse(s);
      if (!r.success) throw new Error(`${id}: screen ${i} is not wos-screen.v1: ${r.error.message}`);
      if (r.data.app !== id) throw new Error(`${id}: screen ${r.data.id} belongs to ${r.data.app}`);
      if (!isDeclared(manifest, r.data.permission)) throw new Error(`${id}: screen ${r.data.id} uses undeclared ${r.data.permission}`);
      for (const a of r.data.actions)
        if ("permission" in a && !isDeclared(manifest, a.permission))
          throw new Error(`${id}: action ${a.id} uses undeclared ${a.permission}`);
      return r.data;
    });
    if ((manifest.surfaces.ios.supported || manifest.surfaces.android.supported) && screens.length === 0)
      throw new Error(`${id}: a supported mobile surface needs at least one screen`);

    const server = input.server ?? null;
    if (manifest.surfaces.api.supported !== (server !== null))
      throw new Error(`${id}: server routes exist exactly when the api surface is supported`);
    for (const r of server?.routes ?? []) {
      if (!isDeclared(manifest, r.permission))
        throw new Error(`${id}: route ${r.method} ${r.path} uses undeclared permission ${r.permission}`);
      if (!/^\/[a-z0-9/_:-]*$/.test(r.path)) throw new Error(`${id}: route path ${r.path} is not a relative API path`);
    }
    const web = input.web ?? null;
    if (manifest.surfaces.web.supported !== (web !== null) && id !== CORE_APP_ID)
      throw new Error(`${id}: a web entry exists exactly when the web surface is supported`);

    const migrations = [...(input.migrations ?? [])].sort((a, b) => (a.file < b.file ? -1 : 1));
    if ((manifest.data.migrations === null) !== (migrations.length === 0))
      throw new Error(`${id}: data.migrations is set exactly when the app ships migrations`);
    for (const m of migrations) if (!MIGRATION_FILE.test(m.file)) throw new Error(`${id}: migration ${m.file} is not NNNN_name.sql`);

    apps.set(id, { manifest, server, web, screens, migrations });
  }
  const core = apps.get(CORE_APP_ID);
  if (!core) throw new Error("the core manifest is not bundled");
  const coreVersion = core.manifest.app.version;
  for (const app of apps.values()) {
    for (const dep of app.manifest.requires.apps) {
      const d = apps.get(dep.id);
      if (!d) throw new Error(`${app.manifest.app.id} requires ${dep.id}, which is not bundled`);
      if (!satisfiesRange(d.manifest.app.version, dep.version))
        throw new Error(`${app.manifest.app.id} requires ${dep.id} ${dep.version}; bundled is ${d.manifest.app.version}`);
    }
  }
  const registry = new Map([...apps].map(([id, a]) => [id, { kind: a.manifest.app.kind, dependencies: a.manifest.requires.apps }]));
  return { coreVersion, apps, registry };
}
