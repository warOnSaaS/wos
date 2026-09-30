/**
 * Local Desktop settings (not account settings: those live on the server, see blockers/B-0003-desktop.md).
 * A small JSON file in Electron's userData directory; never holds secrets.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HOSTS, ModelRef, Uuid } from "@waronsaas/contracts";
import type { LocalSettings } from "../shared/ipc.js";

export interface SettingsStore {
  get(): LocalSettings;
  set(patch: Partial<LocalSettings>): LocalSettings;
}

export function defaultSettings(deviceName: string): LocalSettings {
  return {
    deviceName,
    detachAfterSubmit: true,
    preferredModel: null,
    eventsPollSeconds: 5,
    environmentUrl: HOSTS.core,
    organizationId: null,
    // S-40: Build is off on a device until its user turns it on.
    buildOnDevice: false,
  };
}

function sanitize(raw: unknown, defaults: LocalSettings): LocalSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    deviceName:
      typeof r.deviceName === "string" && r.deviceName.trim().length > 0 && r.deviceName.length <= 64 ? r.deviceName : defaults.deviceName,
    detachAfterSubmit: typeof r.detachAfterSubmit === "boolean" ? r.detachAfterSubmit : defaults.detachAfterSubmit,
    preferredModel: ModelRef.safeParse(r.preferredModel).success ? (r.preferredModel as LocalSettings["preferredModel"]) : null,
    eventsPollSeconds:
      typeof r.eventsPollSeconds === "number" &&
      Number.isInteger(r.eventsPollSeconds) &&
      r.eventsPollSeconds >= 5 &&
      r.eventsPollSeconds <= 300
        ? r.eventsPollSeconds
        : defaults.eventsPollSeconds,
    environmentUrl:
      typeof r.environmentUrl === "string" && environmentUrlProblem(r.environmentUrl) === null ? r.environmentUrl : defaults.environmentUrl,
    organizationId: Uuid.safeParse(r.organizationId).success ? (r.organizationId as string) : null,
    buildOnDevice: typeof r.buildOnDevice === "boolean" ? r.buildOnDevice : defaults.buildOnDevice,
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Settings -> Environment accepts an origin only: https, or http on this machine's loopback (a self-hosted Core
 * started with docker compose, V1 proof step 8). No credentials, path, query or fragment. Returns why it is refused.
 */
export function environmentUrlProblem(raw: string): string | null {
  if (raw.length > 512) return "the address is too long";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (u.username || u.password) return "no user name or password in the address";
  if (u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return "give the server's address only, with no path";
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return null;
  return "use https (http only for a Core on this machine)";
}

/** The canonical form stored in settings: the origin, without a trailing slash. */
export function normalizeEnvironmentUrl(raw: string): string {
  return new URL(raw).origin;
}

export function fileSettingsStore(path: string, defaults: LocalSettings): SettingsStore {
  let current: LocalSettings;
  try {
    current = sanitize(JSON.parse(readFileSync(path, "utf8")), defaults);
  } catch {
    current = { ...defaults };
  }
  return {
    get: () => ({ ...current }),
    set(patch) {
      current = sanitize({ ...current, ...patch }, defaults);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
      return { ...current };
    },
  };
}

export function memorySettingsStore(defaults: LocalSettings): SettingsStore {
  let current = { ...defaults };
  return {
    get: () => ({ ...current }),
    set(patch) {
      current = sanitize({ ...current, ...patch }, defaults);
      return { ...current };
    },
  };
}
