import type { AgentRole, ArtifactSelector, ContextManifest } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildContext, checkManifestAgainstPlan, computeManifestSha256, isReservedVerdictRef, sha256Of } from "../src/index.js";
import { COMMIT, docSelector, makeReader, planFor, policy, policyDoc, prng, REPO } from "./fixtures.js";

const REVIEWERS: AgentRole[] = [
  "roadmap_reviewer_astra",
  "roadmap_reviewer_fable",
  "feature_reviewer_astra",
  "feature_reviewer_fable",
  "implementation_reviewer_astra",
  "implementation_reviewer_fable",
];

const uuid = (r: () => number) => {
  const hex = () =>
    Math.floor(r() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-7${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex()}`;
};

/**
 * One generated review round: a reviewer plan whose selectors mix legitimate artifacts with the other
 * slot's CURRENT verdict (as a selected server document, optional or not, and as its sealed text
 * embedded nowhere else), plus verdicts of earlier, revealed rounds which are allowed.
 */
function generateRound(seed: number) {
  const r = prng(seed);
  const role = REVIEWERS[Math.floor(r() * REVIEWERS.length)] as AgentRole;
  const slot = role.endsWith("astra") ? "astra" : "fable";
  const otherSlot = slot === "astra" ? "fable" : "astra";
  const roundId = uuid(r);
  const roundNumber = 2 + Math.floor(r() * 5);
  const subject = uuid(r);
  const secret = `SEALED-VERDICT-${seed}-${Math.floor(r() * 1e9)}`;
  const currentVerdictText = JSON.stringify({ verdict: r() < 0.5 ? "MATERIAL_GAPS" : "NO_MATERIAL_GAPS", summary: secret });
  // The reserved sealed-verdict form, for the other slot and (sometimes) this slot too.
  const verdictRefs = [`wos:verdict/${roundId}/${otherSlot}`, `wos:verdict/${roundId}/${slot}`];
  const pol = policyDoc(role);
  const task = { ref: `wos:task/${uuid(r)}`, text: `{"round":${roundNumber}}` };
  const prior = { ref: `wos:findings/${subject}@${roundNumber - 1}`, text: `prior revealed round ${roundNumber - 1}` };
  const current = { ref: `wos:findings/${subject}@${roundNumber}`, text: `current round ledger ${secret}` };
  const docs: Record<string, string> = { [pol.ref]: pol.text, [task.ref]: task.text, [prior.ref]: prior.text, [current.ref]: current.text };
  const files: Record<string, string> = { "features/contacts/CONTRACT.yaml": "feature: contacts\n", "wos.json": "{}\n" };

  const selectors: ArtifactSelector[] = [docSelector(pol.ref, pol.text), docSelector(task.ref, task.text)];
  const extras: ArtifactSelector[] = [
    { kind: "repo_file", repo: REPO, path: "features/contacts/CONTRACT.yaml", required: true },
    { kind: "repo_file", repo: REPO, path: "wos.json", required: true },
    docSelector(prior.ref, prior.text, r() < 0.5),
  ];
  const injections = verdictRefs.filter(() => r() < 0.6);
  if (injections.length === 0) injections.push(verdictRefs[0] as string);
  for (const ref of injections) {
    docs[ref] = currentVerdictText;
    extras.push(docSelector(ref, currentVerdictText, false));
  }
  // A buggy or malicious plan may also carry the current round's (unrevealed) finding ledger.
  const plansCurrentFindings = r() < 0.3;
  if (plansCurrentFindings) extras.push(docSelector(current.ref, current.text, false));
  // Shuffle the non-policy selectors: the verdict may appear anywhere in plan order.
  for (let i = extras.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [extras[i], extras[j]] = [extras[j] as ArtifactSelector, extras[i] as ArtifactSelector];
  }
  const excludeGlobs = r() < 0.5 ? [`wos:verdict/${roundId}/**`] : [];
  const plan = planFor(role, [...selectors, ...extras], { roundId, excludeGlobs });
  return { plan, reader: makeReader({ files, docs }), secret, roundId, roundNumber, injections, priorRef: prior.ref, plansCurrentFindings };
}

describe("context-engine reviewer isolation (DONE 2, SECURITY.md S-11)", () => {
  it("context-engine R-isolation: a reviewer manifest never contains the other slot's current verdict (500 generated rounds; unrevealed ledgers refused)", async () => {
    for (let seed = 1; seed <= 500; seed++) {
      const g = generateRound(seed);
      const { manifest, prompt } = await buildContext(g.plan, g.reader, policy);
      const refs = manifest.artifacts.map((a) => a.ref);
      for (const ref of refs) expect(isReservedVerdictRef(ref), `seed ${seed}: ${ref}`).toBe(false);
      for (const ref of g.injections) {
        expect(manifest.excluded, `seed ${seed}`).toContainEqual({ ref, reason: "other_slot_current_round" });
      }
      // Earlier, revealed rounds stay visible (mayViewPriorRounds).
      expect(refs, `seed ${seed}`).toContain(g.priorRef);
      const check = checkManifestAgainstPlan(manifest, g.plan, { roundNumber: g.roundNumber });
      if (g.plansCurrentFindings) {
        // The current round's ledger is unrevealed: the server refuses the manifest (CONTEXT-PROTOCOL.md section 2).
        expect(!check.ok && check.reasons.some((x) => x.startsWith("CURRENT_ROUND_FINDINGS")), `seed ${seed}`).toBe(true);
      } else {
        expect(prompt.includes(g.secret), `seed ${seed}: sealed text leaked into the prompt`).toBe(false);
        expect(check, `seed ${seed}`).toEqual({ ok: true });
      }
    }
  }, 60_000); // heavy loop: allow for a loaded CI machine running the whole suite in parallel

  it("the server rejects a manifest that adds the other slot's current verdict, even re-hashed", async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = generateRound(seed);
      const { manifest } = await buildContext(g.plan, g.reader, policy);
      const ref = g.injections[0] as string;
      const selector = g.plan.artifacts.find((a) => a.kind === "server_document" && a.ref === ref)!;
      const forged: ContextManifest = {
        ...manifest,
        artifacts: [
          ...manifest.artifacts,
          {
            kind: "server_document",
            ref,
            gitBlobOid: null,
            sha256: (selector as { sha256: string }).sha256 as ContextManifest["manifestSha256"],
            bytes: 10,
            estTokens: 44,
          },
        ],
        excluded: manifest.excluded.filter((x) => x.ref !== ref),
        budget: { ...manifest.budget, estimatedTokens: manifest.budget.estimatedTokens + 44 },
      };
      forged.manifestSha256 = computeManifestSha256(forged);
      const result = checkManifestAgainstPlan(forged, g.plan, { roundNumber: g.roundNumber });
      expect(result.ok, `seed ${seed}`).toBe(false);
      expect(!result.ok && result.reasons.some((x) => x.startsWith("RESERVED_VERDICT_REF")), `seed ${seed}`).toBe(true);
    }
  });

  it("a plan that marks the other slot's current verdict required is refused, not silently served", async () => {
    const g = generateRound(3);
    const ref = g.injections[0] as string;
    const plan = {
      ...g.plan,
      artifacts: g.plan.artifacts.map((a) => (a.kind === "server_document" && a.ref === ref ? { ...a, required: true } : a)),
    };
    await expect(buildContext(plan, g.reader, policy)).rejects.toThrow(/REQUIRED_ARTIFACT_EXCLUDED/);
  });

  it("the engine never asks the server for the sealed document", async () => {
    const g = generateRound(11);
    const asked: string[] = [];
    const reader = { ...g.reader, readServerDocument: (ref: string) => (asked.push(ref), g.reader.readServerDocument(ref)) };
    await buildContext(g.plan, reader, policy);
    for (const ref of asked) expect(isReservedVerdictRef(ref)).toBe(false);
  });

  it("both slots of one round receive the same artifact set", async () => {
    for (const [a, b] of [
      ["roadmap_reviewer_astra", "roadmap_reviewer_fable"],
      ["feature_reviewer_astra", "feature_reviewer_fable"],
      ["implementation_reviewer_astra", "implementation_reviewer_fable"],
    ] as const) {
      const docFor = (role: AgentRole) => policyDoc(role);
      const task = { ref: "wos:task/x", text: "{}" };
      const build = async (role: AgentRole) => {
        const p = docFor(role);
        const plan = planFor(role, [
          docSelector(p.ref, p.text),
          docSelector(task.ref, task.text),
          { kind: "repo_file", repo: REPO, path: "wos.json", required: true },
        ]);
        const { manifest } = await buildContext(
          plan,
          makeReader({ files: { "wos.json": "{}" }, docs: { [p.ref]: p.text, [task.ref]: task.text } }),
          policy,
        );
        return manifest.artifacts.filter((x) => x.kind === "repo_file" || x.kind === "task_spec").map((x) => [x.ref, x.sha256]);
      };
      expect(await build(a)).toEqual(await build(b));
    }
    expect(sha256Of("")).toMatch(/^sha256:/);
    expect(COMMIT).toHaveLength(40);
  });
});
