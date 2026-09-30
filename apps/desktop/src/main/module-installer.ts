/**
 * The desktop module installer (WOS-APP-PROTOCOL section 6; SECURITY S-37, S-38, S-39; WORKSTREAMS 12.4 desktop row).
 *
 * For each app the environment's `ActiveApps` names that supports desktop (never Build: Build is in the binary):
 *   1. resolve the named version through `getAppRelease` (which also reports a yank);
 *   2. download ONE `ModuleBundle`, check `sha256Of(bytes)` against the registry (transport only);
 *   3. trust: `verifyModulePackage` against keys PINNED in this binary, the release's key id and manifest hash, every
 *      file's bytes and sha256, `contents` equal to the file list (the schema), portable paths only;
 *   4. compatibility: the manifest's `requires.wos` against the environment's Core version;
 *   5. write it under `<userData>/modules/<app>/<version>/`, then activate it; the old active becomes `previous`,
 *      the old previous is removed (exactly one previous, S-39).
 * Versions only move forward: an older version is never downloaded; the only way back is the local `previous`.
 * A yanked active version is failed and removed, and `previous` is re-activated if it still verifies.
 *
 * Every state change goes through `ModuleInstallMachine` (findTransition); an illegal one throws. Files are served to
 * the module view only for the ACTIVE version, and each file is re-hashed when it is read.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import {
  type ActiveApps,
  BUILD_APP_ID,
  compareSemVer,
  findTransition,
  ModuleBundle,
  ModuleInstallMachine,
  type ModuleInstallEvent,
  type ModuleInstallState,
  ModulePackage,
  satisfiesRange,
  type WosAppManifest,
} from "@waronsaas/contracts";
import { sha256Of, verifyModulePackage } from "@waronsaas/contracts/canonical";
import type { ModuleStatusView } from "../shared/ipc.js";
import { caseCollision, type DesktopPlatform, joinPackagePath, packagePathProblem, pathFlavour } from "./paths.js";
import type { AppReleaseView } from "./platform-api.js";

export interface ModuleRegistry {
  getAppRelease(app: string, version: string): Promise<AppReleaseView>;
  download(url: string): Promise<Uint8Array>;
}

export interface InstallerDeps {
  /** `<userData>/modules` */
  root: string;
  platform: DesktopPlatform;
  /** keyId -> C-5 public key. Production passes PINNED_MODULE_KEYS; tests pass throwaway keys. */
  pinnedKeys: Readonly<Record<string, string>>;
  registry: ModuleRegistry;
  now?: () => Date;
  log?: (msg: string) => void;
}

/** The verified package of an active module, for the view and the host bridge. */
export interface ActiveModule {
  app: string;
  version: string;
  entry: string;
  manifest: WosAppManifest;
}

export interface ModuleInstaller {
  /** Installs, activates, rolls back or refuses, to match the environment's active apps. Never throws for one app. */
  sync(active: ActiveApps, env: { coreVersion: string }): Promise<ModuleStatusView[]>;
  status(): ModuleStatusView[];
  /** The module view could not load `version`: fail it and roll back to `previous` if that still verifies. */
  reportLoadFailure(app: string, version: string, reason: string): ModuleStatusView;
  /** The active, verified package of `app`, or null. */
  active(app: string): ActiveModule | null;
  /** A file of the ACTIVE version, re-hashed against its package entry; null for anything else. */
  readFile(app: string, version: string, path: string): { bytes: Uint8Array; contentType: string } | null;
}

interface AppState {
  /** version -> ModuleInstallState (removed versions are deleted: removed is terminal). */
  versions: Record<string, Exclude<ModuleInstallState, "removed">>;
  wanted: string | null;
  unavailable: string | null;
  failures: Array<{ version: string; reason: string; at: string }>;
}

interface StateFile {
  schema: "wos-module-state.v1";
  apps: Record<string, AppState>;
}

const MAX_FAILURES = 10;

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
};

export function contentTypeOf(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

class InstallFailure extends Error {}

function strictBase64(text: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new InstallFailure("a file is not standard base64");
  const buf = Buffer.from(text, "base64");
  if (buf.toString("base64") !== text) throw new InstallFailure("a file is not canonical base64");
  return buf;
}

export function createModuleInstaller(deps: InstallerDeps): ModuleInstaller {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const p = pathFlavour(deps.platform);
  const statePath = p.join(deps.root, "state.json");
  const verified = new Map<string, ModulePackage>();

  let state: StateFile = { schema: "wos-module-state.v1", apps: {} };
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as StateFile;
    if (raw?.schema === "wos-module-state.v1" && raw.apps && typeof raw.apps === "object") state = raw;
  } catch {
    // First run, or an unreadable file: start empty (packages on disk are re-verified before any use).
  }

  const save = () => {
    mkdirSync(deps.root, { recursive: true });
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, statePath);
  };
  const appState = (app: string): AppState => {
    if (!Object.hasOwn(state.apps, app)) state.apps[app] = { versions: {}, wanted: null, unavailable: null, failures: [] };
    return state.apps[app]!;
  };
  const versionDir = (app: string, version: string) => p.join(deps.root, app, version);
  const versionIn = (st: AppState, s: ModuleInstallState) => Object.entries(st.versions).find(([, v]) => v === s)?.[0] ?? null;

  /** The ONLY way a version changes state: the machine's transition for (from, event), or a throw. */
  const move = (app: string, version: string, event: ModuleInstallEvent) => {
    const st = appState(app);
    const from = st.versions[version];
    if (!from) throw new Error(`module ${app}@${version} is not installed`);
    const t = findTransition(ModuleInstallMachine, from, event);
    if (!t) throw new Error(`ModuleInstallMachine: no ${event} from ${from} (${app}@${version})`);
    if (t.to === "removed") {
      delete st.versions[version];
      verified.delete(`${app}@${version}`);
      rmSync(versionDir(app, version), { recursive: true, force: true });
    } else st.versions[version] = t.to;
    log(`module ${app}@${version}: ${from} -> ${t.to} (${event})`);
  };

  const recordFailure = (app: string, version: string, reason: string) => {
    const st = appState(app);
    st.failures.push({ version, reason, at: now().toISOString() });
    if (st.failures.length > MAX_FAILURES) st.failures.splice(0, st.failures.length - MAX_FAILURES);
  };

  const view = (app: string): ModuleStatusView => {
    const st = appState(app);
    const active = versionIn(st, "active");
    return {
      app,
      wanted: st.wanted,
      active,
      previous: versionIn(st, "previous"),
      state: active !== null && active === st.wanted && st.unavailable === null ? "active" : "unavailable",
      reason: st.unavailable,
      failures: [...st.failures],
    };
  };

  /** Re-reads and re-verifies a stored package: signature by a pinned key, manifest hash, every file. */
  const verifyStored = (app: string, version: string): ModulePackage => {
    const key = `${app}@${version}`;
    const cached = verified.get(key);
    if (cached) return cached;
    const dir = versionDir(app, version);
    const pkg = ModulePackage.parse(JSON.parse(readFileSync(p.join(dir, "package.json"), "utf8")));
    const reasons = verifyModulePackage(pkg, deps.pinnedKeys);
    if (reasons.length) throw new InstallFailure(reasons.join("; "));
    if (pkg.app !== app || pkg.version !== version) throw new InstallFailure("the stored package is for another app or version");
    for (const f of pkg.files) {
      const bytes = readFileSync(joinPackagePath(deps.platform, p.join(dir, "files"), f.path));
      if (bytes.byteLength !== f.bytes || sha256Of(bytes) !== f.sha256) throw new InstallFailure(`${f.path} changed on disk`);
    }
    verified.set(key, pkg);
    return pkg;
  };

  /** Rolls back to `previous` when it still verifies; otherwise removes it. Returns whether a version is active. */
  const rollback = (app: string): boolean => {
    const st = appState(app);
    const prev = versionIn(st, "previous");
    if (!prev) return false;
    try {
      verifyStored(app, prev);
      move(app, prev, "rollback");
      return true;
    } catch (e) {
      recordFailure(app, prev, `ROLLBACK REFUSED: ${e instanceof Error ? e.message : String(e)}`);
      move(app, prev, "remove");
      return false;
    }
  };

  const install = async (app: string, version: string, release: AppReleaseView, coreVersion: string) => {
    const pkgRef = release.desktopPackage!;
    const bytes = await deps.registry.download(pkgRef.url);
    if (sha256Of(bytes) !== pkgRef.sha256) throw new InstallFailure("the download does not match the registry's sha256");
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new InstallFailure("the package is not JSON");
    }
    const parsed = ModuleBundle.safeParse(json);
    if (!parsed.success)
      throw new InstallFailure(
        `not a wos-module-bundle.v1: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    const bundle = parsed.data;
    const pkg = bundle.package;
    if (pkg.app !== app || pkg.version !== version)
      throw new InstallFailure(`the package is ${pkg.app}@${pkg.version}, not ${app}@${version}`);

    // Trust (S-37): the signature by a pinned key, then the release's key id and manifest hash.
    const reasons = verifyModulePackage(json && (json as { package: unknown }).package, deps.pinnedKeys);
    if (reasons.length) throw new InstallFailure(reasons.join("; "));
    if (pkg.signature.keyId !== pkgRef.keyId) throw new InstallFailure("the package is signed by another key than the registry lists");
    if (pkg.manifestSha256 !== release.manifestSha256) throw new InstallFailure("the package's manifest is not the released manifest");

    // Every file: portable path, exact bytes, exact hash.
    const paths = pkg.files.map((f) => f.path);
    for (const path of paths) {
      const problem = packagePathProblem(path);
      if (problem) throw new InstallFailure(`${path}: ${problem}`);
    }
    const collision = caseCollision(paths);
    if (collision) throw new InstallFailure(`${collision[0]} and ${collision[1]} differ only in case`);
    const content = new Map(bundle.contents.map((c) => [c.path, c.base64]));
    const decoded = new Map<string, Buffer>();
    for (const f of pkg.files) {
      const buf = strictBase64(content.get(f.path)!);
      if (buf.byteLength !== f.bytes) throw new InstallFailure(`${f.path}: ${buf.byteLength} bytes, the package lists ${f.bytes}`);
      if (sha256Of(buf) !== f.sha256) throw new InstallFailure(`${f.path}: sha256 does not match`);
      decoded.set(f.path, buf);
    }

    // Compatibility (WOS-APP-PROTOCOL section 6 step 4). The protocol literal is enforced by the schema.
    if (!satisfiesRange(coreVersion, pkg.manifest.requires.wos))
      throw new InstallFailure(`needs wOS Core ${pkg.manifest.requires.wos}; this environment runs ${coreVersion}`);

    // Stage: write, then record the staged state.
    const dir = versionDir(app, version);
    rmSync(dir, { recursive: true, force: true });
    for (const [path, buf] of decoded) {
      const file = joinPackagePath(deps.platform, p.join(dir, "files"), path);
      mkdirSync(p.dirname(file), { recursive: true });
      writeFileSync(file, buf);
    }
    writeFileSync(p.join(dir, "package.json"), `${JSON.stringify(pkg)}\n`);
    const st = appState(app);
    st.versions[version] = "staged";
    return pkg;
  };

  const syncOne = async (entry: ActiveApps["apps"][number], coreVersion: string) => {
    const app = entry.id;
    const wanted = entry.version;
    const st = appState(app);
    st.wanted = wanted;
    const active = versionIn(st, "active");
    const previous = versionIn(st, "previous");

    let release: AppReleaseView;
    try {
      release = await deps.registry.getAppRelease(app, wanted);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // Offline with the wanted version already active: keep running it; the yank check waits for the next sync.
      st.unavailable = active === wanted ? null : `NO RELEASE FOUND FOR ${app}@${wanted}: ${why}`;
      return;
    }

    if (release.state === "yanked") {
      const reason = `VERSION ${wanted} WAS YANKED${release.yankReason ? `: ${release.yankReason}` : ""}`;
      if (active === wanted) {
        recordFailure(app, wanted, reason);
        move(app, wanted, "fail");
        move(app, wanted, "remove");
        const back = rollback(app);
        st.unavailable = back
          ? `${reason}. ROLLED BACK TO ${versionIn(st, "active")}; the environment still names ${wanted}.`
          : `${reason}. NO PREVIOUS VERSION TO ROLL BACK TO.`;
      } else st.unavailable = `${reason}. wOS Desktop never installs a yanked version.`;
      return;
    }

    if (active === wanted) {
      st.unavailable = null;
      return;
    }

    if (previous === wanted) {
      // The environment went back to the version kept locally: re-activate it, never download.
      try {
        verifyStored(app, wanted);
      } catch (e) {
        recordFailure(app, wanted, `ROLLBACK REFUSED: ${e instanceof Error ? e.message : String(e)}`);
        move(app, wanted, "remove");
        st.unavailable = `THE ENVIRONMENT NAMES ${wanted}, AN OLDER VERSION THAN INSTALLED, AND THE LOCAL COPY NO LONGER VERIFIES.`;
        return;
      }
      if (active) move(app, active, "remove");
      move(app, wanted, "rollback");
      st.unavailable = null;
      return;
    }

    if (active && compareSemVer(wanted, active) < 0) {
      st.unavailable = `DOWNGRADE REFUSED: the environment names ${wanted}, older than the installed ${active}. wOS Desktop never installs an older version (S-39).`;
      return;
    }

    if (!release.desktopPackage) {
      st.unavailable = `${app}@${wanted} HAS NO DESKTOP PACKAGE.`;
      return;
    }

    try {
      const pkg = await install(app, wanted, release, coreVersion);
      if (previous) move(app, previous, "remove");
      if (active) move(app, active, "supersede");
      move(app, wanted, "activate");
      verified.set(`${app}@${wanted}`, pkg);
      st.unavailable = null;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      recordFailure(app, wanted, why);
      if (st.versions[wanted] === "staged") {
        move(app, wanted, "fail");
        move(app, wanted, "remove");
      } else rmSync(versionDir(app, wanted), { recursive: true, force: true });
      st.unavailable = `INSTALL REFUSED FOR ${app}@${wanted}: ${why}`;
    }
  };

  const reportLoadFailure = (app: string, version: string, reason: string): ModuleStatusView => {
    const st = appState(app);
    if (st.versions[version] === "active") {
      recordFailure(app, version, `LOAD FAILED: ${reason}`);
      move(app, version, "fail");
      move(app, version, "remove");
      const back = rollback(app);
      st.unavailable = back
        ? `${version} FAILED TO LOAD (${reason}). ROLLED BACK TO ${versionIn(st, "active")}.`
        : `${version} FAILED TO LOAD (${reason}). NO PREVIOUS VERSION TO ROLL BACK TO.`;
      save();
    }
    return view(app);
  };

  return {
    async sync(active, env) {
      const wanted = active.apps.filter((a) => a.id !== BUILD_APP_ID && a.manifest.surfaces.desktop.supported);
      for (const entry of wanted) {
        try {
          await syncOne(entry, env.coreVersion);
        } catch (e) {
          const st = appState(entry.id);
          st.unavailable = `INSTALLER ERROR: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      // Apps no longer active here are hidden (not wanted); their files stay until the machine's remove guard holds.
      const wantedIds = new Set(wanted.map((a) => a.id));
      for (const [id, st] of Object.entries(state.apps)) if (!wantedIds.has(id)) st.wanted = null;
      save();
      return wanted.map((a) => view(a.id));
    },
    status() {
      return Object.entries(state.apps)
        .filter(([, st]) => st.wanted !== null)
        .map(([id]) => view(id));
    },
    reportLoadFailure,
    active(app) {
      const st = state.apps[app];
      if (!st) return null;
      const version = versionIn(st, "active");
      if (!version || version !== st.wanted || st.unavailable !== null) return null;
      try {
        const pkg = verifyStored(app, version);
        return { app, version, entry: pkg.entry, manifest: pkg.manifest };
      } catch (e) {
        reportLoadFailure(app, version, e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    readFile(app, version, path) {
      const st = state.apps[app];
      if (st?.versions[version] !== "active") return null;
      const pkg = verified.get(`${app}@${version}`);
      if (!pkg) return null;
      const f = pkg.files.find((x) => x.path === path);
      if (!f) return null;
      const file = joinPackagePath(deps.platform, p.join(versionDir(app, version), "files"), f.path);
      if (!existsSync(file)) return null;
      const bytes = readFileSync(file);
      if (bytes.byteLength !== f.bytes || sha256Of(bytes) !== f.sha256) {
        log(`module ${app}@${version}: ${path} changed on disk; refused`);
        return null;
      }
      return { bytes: new Uint8Array(bytes), contentType: contentTypeOf(path) };
    },
  };
}
