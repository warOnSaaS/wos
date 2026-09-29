/**
 * IPC payload validation (S-29: "every IPC handler validates its payload with zod"). Leaf values are
 * checked with the contract's own zod schemas; objects must be plain, with exactly the allowed keys.
 * Anything else throws a ValidationError, which the bridge returns as VALIDATION_FAILED.
 */
import { AbuKey, FeatureKey, ModelRef, ReviewerSlot, TargetSlug, Uuid } from "@waronsaas/contracts";
import { IPC_CHANNELS, type InvokeChannel, type LocalSettings } from "../shared/ipc.js";

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
const eventCursor: Schema<number> = {
  safeParse: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? { success: true, data: v } : { success: false }),
};

export type Payloads = {
  "wos:app-info": undefined;
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

export const VALIDATORS: { [K in InvokeChannel]: (payload: unknown) => Payloads[K] } = {
  [C.appInfo]: none,
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
