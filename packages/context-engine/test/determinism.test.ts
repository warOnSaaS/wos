import { AgentRole } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildContext, canonicalSha256, checkManifestAgainstPlan, compareBytewise, computeManifestSha256, sha256Of } from "../src/index.js";
import { makeReader, policy, scenario } from "./fixtures.js";

describe("context-engine determinism (DONE 1)", () => {
  it("context-engine R-determinism: same plan and snapshot give byte-identical prompt and manifest across 100 runs", async () => {
    for (const role of AgentRole.options) {
      const { plan, snap } = scenario(role);
      const first = await buildContext(plan, makeReader(snap), policy);
      for (let run = 0; run < 100; run++) {
        // Every run lists glob matches in a different order: the engine must not depend on it.
        const again = await buildContext(structuredClone(plan), makeReader({ ...snap, shuffleSeed: run + 1 }), structuredClone(policy));
        expect(again.prompt === first.prompt, `${role} run ${run} prompt`).toBe(true);
        expect(JSON.stringify(again.manifest), `${role} run ${run} manifest`).toBe(JSON.stringify(first.manifest));
      }
      expect(checkManifestAgainstPlan(first.manifest, plan, { roundNumber: 2 }), role).toEqual({ ok: true });
      expect(first.manifest.renderedPromptSha256).toBe(sha256Of(first.prompt));
      expect(first.manifest.manifestSha256).toBe(computeManifestSha256(first.manifest));
    }
  }, 60_000); // heavy loop: allow for a loaded CI machine running the whole suite in parallel

  it("golden hashes: identical on macOS and Linux (CI runs the same assertion on ubuntu)", async () => {
    const golden: Record<string, { manifest: string; prompt: string }> = {};
    for (const role of AgentRole.options) {
      const { plan, snap } = scenario(role);
      const { manifest } = await buildContext(plan, makeReader(snap), policy);
      golden[role] = { manifest: manifest.manifestSha256, prompt: manifest.renderedPromptSha256 };
    }
    expect(golden).toMatchSnapshot();
  });

  it("orders glob matches bytewise (code points), not by UTF-16 units or locale", async () => {
    const { plan, snap } = scenario("builder");
    const fullwidthA = `modules/contacts/src/${String.fromCodePoint(0xff21)}.ts`;
    const emoji = `modules/contacts/src/${String.fromCodePoint(0x1f600)}.ts`;
    const upper = "modules/contacts/src/Z.ts";
    const files = { ...snap.files, [emoji]: "e\n", [fullwidthA]: "a\n", [upper]: "Z\n" };
    const { manifest } = await buildContext(plan, makeReader({ ...snap, files, shuffleSeed: 7 }), policy);
    const refs = manifest.artifacts.map((a) => a.ref).filter((r) => r.startsWith("modules/contacts/src/"));
    expect(refs).toEqual([
      upper,
      "modules/contacts/src/index.ts",
      "modules/contacts/src/z.ts",
      "modules/contacts/src/ÿ-last.ts",
      fullwidthA,
      emoji,
    ]);
    expect(compareBytewise(fullwidthA, emoji)).toBe(-1);
    expect(fullwidthA < emoji).toBe(false); // UTF-16 order would differ
  });

  it("the prompt carries no clock, host, user, absolute path or environment value", async () => {
    // Sentinel values instead of the machine's own: on CI the user is "runner", an ordinary word the templates may use.
    const saved = { USER: process.env.USER, HOSTNAME: process.env.HOSTNAME };
    process.env.USER = "wos-sentinel-user-7f3a91";
    process.env.HOSTNAME = "wos-sentinel-host-c20e4b";
    try {
      for (const role of AgentRole.options) {
        const { plan, snap } = scenario(role);
        const { prompt } = await buildContext(plan, makeReader(snap), policy);
        expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        expect(prompt).not.toMatch(/\/Users\/|\/home\/|C:\\/);
        for (const v of [process.env.USER, process.env.HOSTNAME, process.cwd()]) {
          expect(prompt.includes(v), `${role} leaks ${v}`).toBe(false);
        }
      }
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("reads bytes exactly as committed: CRLF, BOM and trailing whitespace are preserved and hashed raw", async () => {
    const { plan, snap } = scenario("feature_author");
    const raw = "\ufeffschema: x\r\nfeature: contacts  \r\n";
    const files = { ...snap.files, "features/contacts/CONTRACT.yaml": raw };
    const { prompt, manifest } = await buildContext(plan, makeReader({ ...snap, files }), policy);
    expect(prompt).toContain(raw);
    const art = manifest.artifacts.find((a) => a.ref === "features/contacts/CONTRACT.yaml")!;
    expect(art.sha256).toBe(sha256Of(raw));
    expect(art.bytes).toBe(new TextEncoder().encode(raw).byteLength);
  });

  it("manifestSha256 is sha256 of the RFC 8785 JSON without the field", async () => {
    const { plan, snap } = scenario("roadmap_reviewer_astra");
    const { manifest } = await buildContext(plan, makeReader(snap), policy);
    const { manifestSha256, ...rest } = manifest;
    expect(manifestSha256).toBe(canonicalSha256(rest));
    expect(canonicalSha256({ b: 1, a: 2 })).toBe(sha256Of('{"a":2,"b":1}'));
  });
});
