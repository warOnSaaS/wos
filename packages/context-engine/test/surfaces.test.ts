import type { AgentRole } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildContext, checkManifestAgainstPlan, featureArtifactSelectors, roadmapArtifactSelectors, sha256Of } from "../src/index.js";
import { makeReader, planFor, policy, policyDoc, REPO, TASK_KIND_BY_ROLE } from "./fixtures.js";

const INVENTORY = `schema: wos-inventory.v1
surfaces:
  - surface: web
    evidence: [0]
  - surface: ios
    evidence: [1]
  - surface: android
    evidence: [2]
`;
const ROADMAP = `schema: wos-roadmap.v1
surfaces:
  - { surface: web, status: in_scope }
  - { surface: ios, status: in_scope }
  - { surface: android, status: excluded, reason: "no public Android app for this edition" }
capabilities:
  - key: crm
    features:
      - feature: contacts
        surfaces: [{ surface: web, weightBp: 6000 }, { surface: ios, weightBp: 4000 }]
        journeys:
          - { surface: web, title: "Find a contact and log a call" }
          - { surface: ios, title: "Call a contact from the phone and log it" }
`;
const APP_REFS = `# App refs: contacts
- target: salesforce
  surfaces: [{ surface: web, weightBp: 6000 }, { surface: ios, weightBp: 4000 }]
  journeys: ["web: Find a contact and log a call", "ios: Call a contact from the phone and log it"]
`;

const docOf = (ref: string, text: string) => ({ ref, sha256: sha256Of(text) });

function roadmapCase(role: "roadmap_author" | "roadmap_reviewer_astra" | "roadmap_reviewer_fable", catalogBytes = "key: contacts\n") {
  const pol = policyDoc(role);
  const task = { ref: "wos:task/t1", text: '{"round":2}' };
  const index = { ref: "wos:catalog-index@abc", text: "contacts\n" };
  const findings = { ref: "wos:findings/d1@1", text: "prior findings\n" };
  const artifacts = roadmapArtifactSelectors({
    role,
    repo: REPO,
    target: "salesforce",
    policyDocument: docOf(pol.ref, pol.text),
    taskDocument: docOf(task.ref, task.text),
    catalogIndex: docOf(index.ref, index.text),
    findings: docOf(findings.ref, findings.text),
    proposals: role === "roadmap_author" ? docOf("wos:proposals/salesforce", "[]") : null,
    referencedCatalogKeys: ["contacts"],
  });
  const plan = planFor(role, artifacts, { roundNumber: role === "roadmap_author" ? null : 2 });
  const files = {
    "roadmaps/salesforce/INVENTORY.yaml": INVENTORY,
    "roadmaps/salesforce/ROADMAP.yaml": ROADMAP,
    "catalog/contacts.yaml": catalogBytes,
  };
  const docs = {
    [pol.ref]: pol.text,
    [task.ref]: task.text,
    [index.ref]: index.text,
    [findings.ref]: findings.text,
    "wos:proposals/salesforce": "[]",
  };
  return { plan, reader: makeReader({ files, docs }) };
}

function featureCase(role: "feature_author" | "feature_reviewer_astra" | "feature_reviewer_fable") {
  const pol = policyDoc(role);
  const task = { ref: "wos:task/t2", text: '{"round":2}' };
  const artifacts = featureArtifactSelectors({
    role,
    repo: REPO,
    feature: "contacts",
    policyDocument: docOf(pol.ref, pol.text),
    taskDocument: docOf(task.ref, task.text),
    appRefs: docOf("wos:app-refs/contacts", APP_REFS),
    dependsOnFeatures: ["accounts"],
  });
  const plan = planFor(role, artifacts, {
    taskKind: TASK_KIND_BY_ROLE[role as AgentRole],
    roundNumber: role === "feature_author" ? null : 2,
  });
  const files = { "catalog/contacts.yaml": "key: contacts\n", "wos.json": "{}\n", "features/contacts/CONTRACT.yaml": "journeys: []\n" };
  return { plan, reader: makeReader({ files, docs: { [pol.ref]: pol.text, [task.ref]: task.text, "wos:app-refs/contacts": APP_REFS } }) };
}

describe("context-engine D13: roadmap and feature contexts carry surfaces and journeys", () => {
  for (const role of ["roadmap_author", "roadmap_reviewer_astra", "roadmap_reviewer_fable"] as const) {
    it(`context-engine R-surfaces: ${role} context includes the inventory and roadmap surfaces and journeys verbatim, required`, async () => {
      const { plan, reader } = roadmapCase(role);
      const { prompt, manifest } = await buildContext(plan, reader, policy);
      expect(prompt).toContain(INVENTORY);
      expect(prompt).toContain(ROADMAP);
      const rp = policy.roles.find((r) => r.role === role)!;
      for (const text of [...rp.obligations, ...rp.materialFindingRules].filter((t) => /surface|journey|trade dress/i.test(t))) {
        expect(prompt, text.slice(0, 40)).toContain(text);
      }
      for (const path of ["roadmaps/salesforce/INVENTORY.yaml", "roadmaps/salesforce/ROADMAP.yaml"]) {
        expect(manifest.artifacts.map((a) => a.ref)).toContain(path);
      }
      expect(checkManifestAgainstPlan(manifest, plan)).toEqual({ ok: true });
    });
  }

  it("surfaces are never truncated: an oversized optional catalog entry is dropped, the roadmap stays", async () => {
    const { plan, reader } = roadmapCase("roadmap_reviewer_fable", "x".repeat(600_000));
    const { prompt, manifest } = await buildContext(plan, reader, policy);
    expect(manifest.excluded).toContainEqual({ ref: "catalog/contacts.yaml", reason: "over_budget" });
    expect(prompt).toContain(ROADMAP);
  });

  it("a reviewer context without the roadmap at the head aborts; an author's first draft does not", async () => {
    const r = roadmapCase("roadmap_reviewer_astra");
    await expect(buildContext(r.plan, makeReader({ files: {}, docs: {} }), policy)).rejects.toThrow();
    const a = roadmapCase("roadmap_author");
    const pol = policyDoc("roadmap_author");
    const docs = {
      [pol.ref]: pol.text,
      "wos:task/t1": '{"round":2}',
      "wos:catalog-index@abc": "contacts\n",
      "wos:findings/d1@1": "prior findings\n",
      "wos:proposals/salesforce": "[]",
    };
    const { manifest } = await buildContext(a.plan, makeReader({ files: {}, docs }), policy);
    expect(manifest.artifacts.map((x) => x.ref)).not.toContain("roadmaps/salesforce/ROADMAP.yaml");
  });

  for (const role of ["feature_author", "feature_reviewer_astra", "feature_reviewer_fable"] as const) {
    it(`context-engine R-surfaces: ${role} context includes every app's surfaces and journeys (wos:app-refs), required`, async () => {
      const { plan, reader } = featureCase(role);
      const { prompt, manifest } = await buildContext(plan, reader, policy);
      expect(prompt).toContain(APP_REFS);
      expect(plan.artifacts.find((s) => s.kind === "server_document" && s.ref === "wos:app-refs/contacts")?.required).toBe(true);
      expect(manifest.artifacts.map((a) => a.ref)).toContain("wos:app-refs/contacts");
      const rp = policy.roles.find((r) => r.role === role)!;
      for (const text of [...rp.obligations, ...rp.materialFindingRules].filter((t) => /surface|journey/i.test(t))) {
        expect(prompt, text.slice(0, 40)).toContain(text);
      }
      expect(manifest.excluded).toContainEqual({ ref: "features/accounts/CONTRACT.yaml", reason: "missing_optional" });
      expect(checkManifestAgainstPlan(manifest, plan)).toEqual({ ok: true });
    });
  }
});
