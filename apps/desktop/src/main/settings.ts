/**
 * Local Desktop settings (not account settings: those live on the server, see blockers/B-0003-desktop.md).
 * A small JSON file in Electron's userData directory; never holds secrets.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ModelRef } from "@waronsaas/contracts";
import type { LocalSettings } from "../shared/ipc.js";

export interface SettingsStore {
  get(): LocalSettings;
  set(patch: Partial<LocalSettings>): LocalSettings;
}

export function defaultSettings(deviceName: string): LocalSettings {
  return { deviceName, detachAfterSubmit: true, preferredModel: null, eventsPollSeconds: 5 };
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
  };
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
