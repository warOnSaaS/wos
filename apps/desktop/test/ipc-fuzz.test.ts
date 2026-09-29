/**
 * S-29 "IPC fuzz": every channel validates its payload; hostile or malformed payloads never reach the
 * orchestrator, the public API, the settings store or the shell.
 */
import { AGENT_POLICY_V1, type Orchestrator } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { createDesktopCore } from "../src/main/core.js";
import type { PublicApi } from "../src/main/public-api.js";
import { defaultSettings, memorySettingsStore } from "../src/main/settings.js";
import { isInvokeChannel, VALIDATORS, validatePayload } from "../src/main/validate.js";
import { IPC_CHANNELS, type InvokeChannel } from "../src/shared/ipc.js";
import { APP_INFO } from "./support.js";

const HOSTILE: unknown[] = [
  null,
  42,
  "string",
  true,
  [],
  [1, 2],
  () => 1,
  new Date(),
  Object.create({ inherited: 1 }),
  { __proto__: { polluted: true } },
  JSON.parse('{"__proto__": {"polluted": true}}'),
  { constructor: { prototype: { polluted: true } } },
  { slug: "../../etc", feature: "x" },
  { slug: "salesforce", feature: "contacts", extra: 1 },
  { email: "a@b.co", extra: "x" },
  { email: "not-an-email" },
  { email: `${"x".repeat(400)}@b.co` },
  { code: "ABCD-EFGH-IJKL" },
  { code: "' OR 1=1 --" },
  { abu: "../../etc/passwd", model: "opus" },
  { abu: "salesforce/contacts#04", model: "gpt-4" },
  { abu: "salesforce/contacts#04", model: "fable", more: 1 },
  { abu: { $ne: null }, model: "opus" },
  { slot: "opus" },
  { leaseId: "not-a-uuid" },
  { url: 42 },
  { url: "x".repeat(5000) },
  { after: -1 },
  { after: 1.5 },
  { after: "1" },
  { deviceName: "" },
  { deviceName: "a\u0000b" },
  { detachAfterSubmit: "yes" },
  { preferredModel: "gpt" },
  { eventsPollSeconds: 0 },
  { apiBaseUrl: "https://evil.example" },
];

function trap(): { calls: string[]; orchestrator: Orchestrator; publicApi: PublicApi; opened: string[] } {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get:
      (_t, p) =>
      (...args: unknown[]) => {
        calls.push(`${String(p)}(${JSON.stringify(args).slice(0, 80)})`);
        return Promise.resolve(null);
      },
  };
  return { calls, orchestrator: new Proxy({}, handler) as Orchestrator, publicApi: new Proxy({}, handler) as PublicApi, opened: [] };
}

describe("IPC payload validation", () => {
  it("every invoke channel has a validator and nothing else does", () => {
    const channels = Object.values(IPC_CHANNELS).filter((c) => c !== IPC_CHANNELS.events);
    expect(Object.keys(VALIDATORS).sort()).toEqual([...channels].sort());
    expect(isInvokeChannel("wos:events")).toBe(false);
    expect(isInvokeChannel("__proto__")).toBe(false);
    expect(isInvokeChannel("constructor")).toBe(false);
  });

  const withPayload: InvokeChannel[] = [
    "wos:sign-in",
    "wos:sign-in-code",
    "wos:get-target",
    "wos:get-feature",
    "wos:list-claimable-abus",
    "wos:build",
    "wos:review",
    "wos:release",
    "wos:open-external",
  ];

  it.each(withPayload)("%s refuses every hostile payload before any side effect", async (channel) => {
    const t = trap();
    const settings = memorySettingsStore(defaultSettings("dev"));
    const core = createDesktopCore({
      orchestrator: t.orchestrator,
      publicApi: t.publicApi,
      settings,
      policy: AGENT_POLICY_V1,
      appInfo: APP_INFO,
      emit: () => undefined,
      openExternal: async (u) => {
        t.opened.push(u);
      },
    });
    for (const payload of HOSTILE) {
      await expect(core.invoke(channel, payload), `${channel} ${JSON.stringify(payload)?.slice(0, 60)}`).rejects.toBeDefined();
    }
    expect(t.calls).toEqual([]);
    expect(t.opened).toEqual([]);
    expect(settings.get()).toEqual(defaultSettings("dev"));
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("no-payload channels refuse any non-empty payload", () => {
    for (const ch of ["wos:status", "wos:logout", "wos:list-targets", "wos:runs", "wos:link-github"] as const) {
      expect(() => validatePayload(ch, { anything: 1 })).toThrow(/unexpected field/);
      expect(() => validatePayload(ch, "x")).toThrow(/plain object/);
      expect(validatePayload(ch, undefined)).toBeUndefined();
    }
  });

  it("set-settings refuses hostile payloads without touching the store", async () => {
    const settings = memorySettingsStore(defaultSettings("dev"));
    const t = trap();
    const core = createDesktopCore({
      orchestrator: t.orchestrator,
      publicApi: t.publicApi,
      settings,
      policy: AGENT_POLICY_V1,
      appInfo: APP_INFO,
      emit: () => undefined,
      openExternal: async () => undefined,
    });
    for (const p of HOSTILE.filter((x) => !(x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0))) {
      await core.invoke("wos:set-settings", p).catch(() => undefined);
    }
    expect(settings.get()).toEqual(defaultSettings("dev"));
  });

  it("accepts the valid shapes", () => {
    expect(validatePayload("wos:sign-in", { email: " dev@example.com " })).toEqual({ email: "dev@example.com" });
    expect(validatePayload("wos:sign-in-code", { code: "abcdefgh" })).toEqual({ code: "ABCD-EFGH" });
    expect(validatePayload("wos:build", { abu: "salesforce/contacts#04", model: "sol" })).toEqual({
      abu: "salesforce/contacts#04",
      model: "sol",
    });
    expect(validatePayload("wos:build", { abu: "0192ab3c-0000-7000-8000-000000000001", model: "astra" }).model).toBe("astra");
    expect(validatePayload("wos:review", { slot: "fable" })).toEqual({ slot: "fable" });
    expect(validatePayload("wos:my-events", undefined)).toEqual({ after: undefined });
    expect(validatePayload("wos:my-events", { after: 7 })).toEqual({ after: 7 });
  });

  it("random fuzz: no payload makes a validator throw anything but a validation error", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const atoms = [null, undefined, 0, -1, 1e308, Number.NaN, "", "a", "wos://auth", "opus", "salesforce", {}, [], true];
    const gen = (depth: number): unknown => {
      if (depth > 2 || rnd() < 0.4) return atoms[Math.floor(rnd() * atoms.length)];
      const o: Record<string, unknown> = {};
      const keys = ["email", "code", "slug", "feature", "abu", "model", "slot", "leaseId", "url", "after", "deviceName", "x"];
      for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) o[keys[Math.floor(rnd() * keys.length)]!] = gen(depth + 1);
      return o;
    };
    for (let i = 0; i < 3000; i++) {
      const ch = Object.keys(VALIDATORS)[i % Object.keys(VALIDATORS).length] as InvokeChannel;
      const p = gen(0);
      try {
        validatePayload(ch, p);
      } catch (e) {
        expect((e as { code?: string }).code, `${ch} ${String(e)}`).toBe("VALIDATION_FAILED");
      }
    }
  });
});
