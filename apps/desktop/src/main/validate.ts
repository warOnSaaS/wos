/**
 * IPC payload validation (S-29: "every IPC handler validates its payload with zod"). Leaf values are
 * checked with the contract's own zod schemas; objects must be plain, with exactly the allowed keys.
 * Anything else throws a ValidationError, which the bridge returns as VALIDATION_FAILED.
 */
import { AbuKey, AppId, FeatureKey, ModelRef, ReviewerSlot, TargetSlug, Uuid } from "@waronsaas/contracts";
import { IPC_CHANNELS, type InvokeChannel, type LocalSettings, type ModuleBounds } from "../shared/ipc.js";
import { environmentUrlProblem, normalizeEnvironmentUrl } from "./settings.js";

export class ValidationError extends Error {
  readonly code = "VALIDATION_FAILED";
}

type Schema<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false } };

function leaf<T>(schema: Schema<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(`${what} is not valid`);
  return r.data;
}

function record(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ValidationError("payload must be a plain object");
  }
  const keys = Object.keys(value);
  for (const k of keys) if (!allowed.includes(k)) throw new ValidationError(`unexpected field ${k}`);
  for (const k of required) if (!(k in value)) throw new ValidationError(`missing field ${k}`);
  return value as Record<string, unknown>;
}

function none(value: unknown): undefined {
  if (value !== undefined && value !== null) record(value, []);
  return undefined;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
const CODE = /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/;

const email: Schema<string> = {
  safeParse: (v) =>
    typeof v === "string" && v.length <= 320 && EMAIL.test(v.trim()) ? { success: true, data: v.trim() } : { success: false },
};
const code: Schema<string> = {
  safeParse: (v) => {
    if (typeof v !== "string" || !CODE.test(v.trim())) return { success: false };
    const c = v.trim().toUpperCase().replace("-", "");
    return { success: true, data: `${c.slice(0, 4)}-${c.slice(4)}` };
  },
};
/** An ABU id (uuid) or "<target>/<abuKey>" (BuildOptions.abu). */
const abuRef: Schema<string> = {
  safeParse: (v) => {
    if (Uuid.safeParse(v).success) return { success: true, data: v as string };
    if (typeof v === "string") {
      const [t, k, ...rest] = v.split("/");
      if (rest.length === 0 && TargetSlug.safeParse(t).success && AbuKey.safeParse(k).success) return { success: true, data: v };
    }
    return { success: false };
  },
};
const url: Schema<string> = {
  safeParse: (v) => (typeof v === "string" && v.length <= 2048 ? { success: true, data: v } : { success: false }),
};
const bool: Schema<boolean> = { safeParse: (v) => (typeof v === "boolean" ? { success: true, data: v } : { success: false }) };
const deviceName: Schema<string> = {
  safeParse: (v) =>
    typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 64 && ![...v].some((ch) => ch.charCodeAt(0) < 0x20)
      ? { success: true, data: v.trim() }
      : { success: false },
};
const pollSeconds: Schema<number> = {
  safeParse: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 5 && v <= 300 ? { success: true, data: v } : { success: false }),
};
const environmentUrl: Schema<string> = {
  safeParse: (v) =>
    typeof v === "string" && environmentUrlProblem(v.trim()) === null
      ? { success: true, data: normalizeEnvironmentUrl(v.trim()) }
      : { success: false },
};
const rowVersion: Schema<number | null> = {
  safeParse: (v) =>
    v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2_147_483_647)
      ? { success: true, data: v as number | null }
      : { success: false },
};
/** A route under an app's routes.ui ("/crm", "/crm/pipeline"); the manifest check happens in main. */
const uiRoute: Schema<string> = {
  safeParse: (v) =>
    typeof v === "string" && v.length <= 200 && /^\/[a-z0-9/_-]*$/.test(v) ? { success: true, data: v } : { success: false },
};
const pixels = (max: number): Schema<number> => ({
  safeParse: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? { success: true, data: v } : { success: false }),
});
function bounds(value: unknown): ModuleBounds {
  const r = record(value, ["x", "y", "width", "height"]);
  return {
    x: leaf(pixels(20_000), r.x, "x"),
    y: leaf(pixels(20_000), r.y, "y"),
    width: leaf(pixels(20_000), r.width, "width"),
    height: leaf(pixels(20_000), r.height, "height"),
  };
}

const eventCursor: Schema<number> = {
  safeParse: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? { success: true, data: v } : { success: false }),
};

export type Payloads = {
  "wos:app-info": undefined;
  "wos:account": undefined;
  "wos:shell-state": undefined;
  "wos:refresh-shell": undefined;
  "wos:set-environment": { url: string | null };
  "wos:environment-sign-in": { email: string };
  "wos:environment-sign-in-code": { code: string };
  "wos:environment-sign-out": undefined;
  "wos:select-organization": { organizationId: string };
  "wos:org-apps": { organizationId: string };
  "wos:enable-app": { organizationId: string; app: string; expectedRowVersion: number | null };
  "wos:disable-app": { organizationId: string; app: string; expectedRowVersion: number | null };
  "wos:set-build-on-device": { on: boolean };
  "wos:show-module": { app: string; route: string; bounds: ModuleBounds };
  "wos:hide-module": undefined;
  "wos:status": undefined;
  "wos:sign-in": { email: string };
  "wos:sign-in-code": { code: string };
  "wos:sign-in-cancel": undefined;
  "wos:link-github": undefined;
  "wos:logout": undefined;
  "wos:list-targets": undefined;
  "wos:get-target": { slug: string };
  "wos:get-feature": { slug: string; feature: string };
  "wos:list-claimable-abus": { slug: string; feature: string };
  "wos:builder-models": undefined;
  "wos:build": { abu: string; model: ModelRef };
  "wos:review": { slot: ReviewerSlot };
  "wos:release": { leaseId: string };
  "wos:runs": undefined;
  "wos:my-work": undefined;
  "wos:my-events": { after: number | undefined };
  "wos:contributions": undefined;
  "wos:get-settings": undefined;
  "wos:set-settings": Partial<LocalSettings>;
  "wos:open-external": { url: string };
};

const C = IPC_CHANNELS;

const entitlementChange = (p: unknown) => {
  const r = record(p, ["organizationId", "app", "expectedRowVersion"]);
  return {
    organizationId: leaf(Uuid, r.organizationId, "organization"),
    app: leaf(AppId, r.app, "app"),
    expectedRowVersion: leaf(rowVersion, r.expectedRowVersion, "row version"),
  };
};

export const VALIDATORS: { [K in InvokeChannel]: (payload: unknown) => Payloads[K] } = {
  [C.appInfo]: none,
  [C.account]: none,
  [C.shellState]: none,
  [C.refreshShell]: none,
  [C.setEnvironment]: (p) => {
    const r = record(p, ["url"]);
    return { url: r.url === null ? null : leaf(environmentUrl, r.url, "environment address") };
  },
  [C.environmentSignIn]: (p) => ({ email: leaf(email, record(p, ["email"]).email, "email") }),
  [C.environmentSignInCode]: (p) => ({ code: leaf(code, record(p, ["code"]).code, "code") }),
  [C.environmentSignOut]: none,
  [C.selectOrganization]: (p) => ({ organizationId: leaf(Uuid, record(p, ["organizationId"]).organizationId, "organization") }),
  [C.orgApps]: (p) => ({ organizationId: leaf(Uuid, record(p, ["organizationId"]).organizationId, "organization") }),
  [C.enableApp]: entitlementChange,
  [C.disableApp]: entitlementChange,
  [C.setBuildOnDevice]: (p) => ({ on: leaf(bool, record(p, ["on"]).on, "on") }),
  [C.showModule]: (p) => {
    const r = record(p, ["app", "route", "bounds"]);
    return { app: leaf(AppId, r.app, "app"), route: leaf(uiRoute, r.route, "route"), bounds: bounds(r.bounds) };
  },
  [C.hideModule]: none,
  [C.status]: none,
  [C.signIn]: (p) => ({ email: leaf(email, record(p, ["email"]).email, "email") }),
  [C.signInCode]: (p) => ({ code: leaf(code, record(p, ["code"]).code, "code") }),
  [C.signInCancel]: none,
  [C.linkGithub]: none,
  [C.logout]: none,
  [C.listTargets]: none,
  [C.getTarget]: (p) => ({ slug: leaf(TargetSlug, record(p, ["slug"]).slug, "target") }),
  [C.getFeature]: (p) => {
    const r = record(p, ["slug", "feature"]);
    return { slug: leaf(TargetSlug, r.slug, "target"), feature: leaf(FeatureKey, r.feature, "feature") };
  },
  [C.listClaimableAbus]: (p) => {
    const r = record(p, ["slug", "feature"]);
    return { slug: leaf(TargetSlug, r.slug, "target"), feature: leaf(FeatureKey, r.feature, "feature") };
  },
  [C.builderModels]: none,
  [C.build]: (p) => {
    const r = record(p, ["abu", "model"]);
    return { abu: leaf(abuRef, r.abu, "ABU"), model: leaf(ModelRef, r.model, "model") };
  },
  [C.review]: (p) => ({ slot: leaf(ReviewerSlot, record(p, ["slot"]).slot, "reviewer slot") }),
  [C.release]: (p) => ({ leaseId: leaf(Uuid, record(p, ["leaseId"]).leaseId, "lease id") }),
  [C.runs]: none,
  [C.myWork]: none,
  [C.myEvents]: (p) => {
    if (p === undefined || p === null) return { after: undefined };
    const r = record(p, ["after"], []);
    return { after: r.after === undefined ? undefined : leaf(eventCursor, r.after, "after") };
  },
  [C.contributions]: none,
  [C.getSettings]: none,
  [C.setSettings]: (p) => {
    const r = record(p, ["deviceName", "detachAfterSubmit", "preferredModel", "eventsPollSeconds"], []);
    const out: Partial<LocalSettings> = {};
    if ("deviceName" in r) out.deviceName = leaf(deviceName, r.deviceName, "device name");
    if ("detachAfterSubmit" in r) out.detachAfterSubmit = leaf(bool, r.detachAfterSubmit, "detachAfterSubmit");
    if ("preferredModel" in r) out.preferredModel = r.preferredModel === null ? null : leaf(ModelRef, r.preferredModel, "model");
    if ("eventsPollSeconds" in r) out.eventsPollSeconds = leaf(pollSeconds, r.eventsPollSeconds, "poll interval");
    return out;
  },
  [C.openExternal]: (p) => ({ url: leaf(url, record(p, ["url"]).url, "url") }),
};

export function validatePayload<K extends InvokeChannel>(channel: K, payload: unknown): Payloads[K] {
  const v = VALIDATORS[channel];
  if (!v) throw new ValidationError(`unknown channel ${String(channel)}`);
  return v(payload) as Payloads[K];
}

export function isInvokeChannel(channel: unknown): channel is InvokeChannel {
  return typeof channel === "string" && Object.hasOwn(VALIDATORS, channel);
}

/** The module host bridge's payloads (S-38): the app id, and for requests an HTTP method, a path and a JSON body. */
export function validateModuleManifestPayload(payload: unknown): { app: string } {
  return { app: leaf(AppId, record(payload, ["app"]).app, "app") };
}

const MAX_MODULE_BODY = 1_000_000;

export function validateModuleRequestPayload(payload: unknown): { app: string; method: string; path: string; body: unknown } {
  const r = record(payload, ["app", "method", "path", "body"]);
  const method = typeof r.method === "string" ? r.method.toUpperCase() : "";
  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) throw new ValidationError("method must be GET, POST, PATCH or DELETE");
  if (typeof r.path !== "string" || r.path.length > 1024) throw new ValidationError("path is not valid");
  let size = 0;
  try {
    size = JSON.stringify(r.body ?? null).length;
  } catch {
    throw new ValidationError("body must be JSON");
  }
  if (size > MAX_MODULE_BODY) throw new ValidationError("body is too large");
  return { app: leaf(AppId, r.app, "app"), method, path: r.path, body: r.body ?? null };
}
