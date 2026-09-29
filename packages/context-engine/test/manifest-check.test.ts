import type { ContextManifest } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildContext, checkManifestAgainstPlan, computeManifestSha256, sha256Of } from "../src/index.js";
import { computeManifestSha256 as contractsManifestSha256 } from "@waronsaas/contracts/canonical";
import { makeReader, policy, scenario } from "./fixtures.js";

async function built(role: Parameters<typeof scenario>[0] = "builder") {
  const { plan, snap } = scenario(role);
  const { manifest } = await buildContext(plan, makeReader(snap), policy);
  return { plan, manifest };
}

/** Applies a change and re-hashes, so only the semantic check can catch it. */
function tamper(m: ContextManifest, change: (m: ContextManifest) => void): ContextManifest {
  const copy = structuredClone(m);
  change(copy);
  copy.manifestSha256 = computeManifestSha256(copy);
  return copy;
}

const reasonsOf = (r: ReturnType<typeof checkManifestAgainstPlan>) => (r.ok ? [] : r.reasons.map((x) => x.split(":")[0]));

describe("context-engine checkManifestAgainstPlan (CONTEXT-PROTOCOL.md section 7)", () => {
  it("accepts the manifest the engine built for every role", async () => {
    for (const role of ["builder", "roadmap_author", "feature_reviewer_astra", "conflict_resolver"] as const) {
      const { plan, manifest } = await built(role);
      expect(checkManifestAgainstPlan(manifest, plan, { roundNumber: 2 }), role).toEqual({ ok: true });
    }
  });

  it("builder revision plans (with a finding ledger) are abu_revision", async () => {
    const { manifest } = await built("builder");
    expect(manifest.task.kind).toBe("abu_revision");
  });

  const cases: Array<[string, (m: ContextManifest) => void, string]> = [
    [
      "reasoning downgraded",
      (m) => {
        m.reasoning = "medium";
      },
      "FIELD_MISMATCH",
    ],
    [
      "model swapped",
      (m) => {
        m.model = { ref: "fable", modelId: "claude-fable-5-1" };
      },
      "FIELD_MISMATCH",
    ],
    [
      "other commit",
      (m) => {
        m.source.commit = "2222222222222222222222222222222222222222";
      },
      "FIELD_MISMATCH",
    ],
    [
      "budget raised",
      (m) => {
        m.budget.limitTokens = 999_999;
      },
      "FIELD_MISMATCH",
    ],
    [
      "policy version",
      (m) => {
        m.policyVersion = "agent-policy.v2";
      },
      "FIELD_MISMATCH",
    ],
    [
      "template edited",
      (m) => {
        m.promptTemplate.sha256 = sha256Of("edited");
      },
      "FIELD_MISMATCH",
    ],
    [
      "task kind",
      (m) => {
        m.task.kind = "abu_build";
      },
      "FIELD_MISMATCH",
    ],
    [
      "required file dropped",
      (m) => {
        m.artifacts = m.artifacts.filter((a) => a.ref !== "wos.json");
      },
      "REQUIRED_MISSING",
    ],
    ["required file marked over budget", (m) => void m.excluded.push({ ref: "wos.json", reason: "over_budget" }), "REQUIRED_EXCLUDED"],
    ["unselected file added", (m) => void m.artifacts.push({ ...m.artifacts[3]!, ref: "secrets/notes.md" }), "UNSELECTED_ARTIFACT"],
    [
      "secret added through a glob",
      (m) => void m.artifacts.push({ ...m.artifacts[3]!, ref: "modules/contacts/.env.local" }),
      "SECRET_ARTIFACT",
    ],
    [
      "server document swapped",
      (m) => {
        m.artifacts[2]!.sha256 = sha256Of("other task");
      },
      "SERVER_DOCUMENT_MISMATCH",
    ],
    [
      "estimate understated",
      (m) => {
        m.budget.estimatedTokens -= 1;
      },
      "BUDGET_ESTIMATE_MISMATCH",
    ],
    ["duplicate artifact", (m) => void m.artifacts.push(m.artifacts[3]!), "DUPLICATE_ARTIFACT"],
    [
      "repo file without blob oid",
      (m) => {
        m.artifacts[3]!.gitBlobOid = null;
      },
      "MISSING_BLOB_OID",
    ],
  ];
  for (const [name, change, code] of cases) {
    it(`rejects: ${name}`, async () => {
      const { plan, manifest } = await built();
      expect(reasonsOf(checkManifestAgainstPlan(tamper(manifest, change), plan))).toContain(code);
    });
  }

  it("rejects an estimate over the limit and a manifest whose hash does not recompute", async () => {
    const { plan, manifest } = await built();
    const over = tamper(manifest, (m) => {
      m.artifacts[3]!.estTokens += 200_000;
      m.budget.estimatedTokens += 200_000;
    });
    expect(reasonsOf(checkManifestAgainstPlan(over, plan))).toContain("OVER_CONTEXT_BUDGET");
    expect(reasonsOf(checkManifestAgainstPlan({ ...manifest, target: "hubspot" }, plan))).toEqual(
      expect.arrayContaining(["FIELD_MISMATCH", "MANIFEST_HASH_MISMATCH"]),
    );
  });

  it("rejects an artifact matching the plan's excludeGlobs", async () => {
    const { plan, manifest } = await built();
    const strict = { ...plan, excludeGlobs: ["wos.json"] };
    expect(reasonsOf(checkManifestAgainstPlan(manifest, strict))).toContain("EXCLUDED_ARTIFACT_INCLUDED");
  });

  it("rejects any wos:verdict/ ref, even one the plan (wrongly) selected", async () => {
    const { plan, manifest } = await built();
    const ref = `wos:verdict/${plan.taskId}/astra`;
    const withSel = {
      ...plan,
      artifacts: [...plan.artifacts, { kind: "server_document" as const, ref, sha256: sha256Of("v"), required: false }],
    };
    const forged = tamper(manifest, (m) => {
      m.artifacts.push({ kind: "server_document", ref, gitBlobOid: null, sha256: sha256Of("v"), bytes: 1, estTokens: 41 });
      m.budget.estimatedTokens += 41;
    });
    expect(reasonsOf(checkManifestAgainstPlan(forged, withSel))).toContain("RESERVED_VERDICT_REF");
  });

  it("rejects a server document ref that is not in the plan", async () => {
    const { plan, manifest } = await built();
    const forged = tamper(manifest, (m) => {
      m.artifacts.push({
        kind: "server_document",
        ref: "wos:catalog-index@abc",
        gitBlobOid: null,
        sha256: sha256Of("c"),
        bytes: 1,
        estTokens: 41,
      });
      m.budget.estimatedTokens += 41;
    });
    expect(reasonsOf(checkManifestAgainstPlan(forged, plan))).toContain("UNSELECTED_ARTIFACT");
  });

  it("reviewer plans: findings only for revealed rounds (k <= round - 1); the round number is required to accept them", async () => {
    const { plan, manifest } = await built("implementation_reviewer_astra"); // carries wos:findings/<attempt>@1
    expect(checkManifestAgainstPlan(manifest, plan, { roundNumber: 2 })).toEqual({ ok: true });
    expect(reasonsOf(checkManifestAgainstPlan(manifest, plan, { roundNumber: 1 }))).toContain("CURRENT_ROUND_FINDINGS");
    expect(reasonsOf(checkManifestAgainstPlan(manifest, plan))).toContain("ROUND_NUMBER_REQUIRED");
    // Builders see the ledger of the round they are answering; the rule is for reviewers only.
    const b = await built("builder");
    expect(checkManifestAgainstPlan(b.manifest, b.plan)).toEqual({ ok: true });
  });

  it("local documents: only local:verification-output, only when planned", async () => {
    const { plan, snap } = scenario("builder");
    const repair = {
      ...plan,
      artifacts: [
        ...plan.artifacts,
        { kind: "local_document" as const, ref: "local:verification-output" as const, required: false as const },
      ],
    };
    const { manifest } = await buildContext(
      repair,
      makeReader({ ...snap, localOutput: "FAIL modules/contacts/test/contacts.test.ts\n" }),
      policy,
    );
    const local = manifest.artifacts.find((a) => a.kind === "local_document")!;
    expect(local).toMatchObject({
      ref: "local:verification-output",
      gitBlobOid: null,
      sha256: sha256Of("FAIL modules/contacts/test/contacts.test.ts\n"),
    });
    expect(checkManifestAgainstPlan(manifest, repair)).toEqual({ ok: true });
    // The same manifest against the plan without the local selector is refused.
    expect(reasonsOf(checkManifestAgainstPlan(manifest, plan))).toContain("UNSELECTED_ARTIFACT");
    const other = tamper(manifest, (m) => {
      const a = m.artifacts.find((x) => x.kind === "local_document")!;
      a.ref = "local:shell-history";
    });
    expect(reasonsOf(checkManifestAgainstPlan(other, repair))).toContain("LOCAL_DOCUMENT_NOT_ALLOWED");
    // Without the local output (first run) the optional selector is recorded missing.
    const first = await buildContext(repair, makeReader(snap), policy);
    expect(first.manifest.excluded).toContainEqual({ ref: "local:verification-output", reason: "missing_optional" });
  });

  it("the task kind comes from the plan, never inferred", async () => {
    const { plan, snap } = scenario("builder");
    const asBuild = { ...plan, taskKind: "abu_build" as const };
    const { manifest } = await buildContext(asBuild, makeReader(snap), policy);
    expect(manifest.task.kind).toBe("abu_build");
    expect(reasonsOf(checkManifestAgainstPlan(manifest, plan))).toContain("FIELD_MISMATCH");
  });

  it("manifest hashes equal computeManifestSha256 from @waronsaas/contracts/canonical", async () => {
    for (const role of ["builder", "roadmap_reviewer_fable", "feature_author"] as const) {
      const { manifest } = await built(role);
      expect(manifest.manifestSha256).toBe(contractsManifestSha256(manifest));
      expect(manifest.renderedPromptSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("feature work carries target null; roadmap work carries feature null", async () => {
    expect((await built("feature_reviewer_fable")).manifest).toMatchObject({ target: null, feature: "contacts" });
    expect((await built("builder")).manifest).toMatchObject({ target: null, feature: "contacts", abu: "contacts#04" });
    expect((await built("roadmap_author")).manifest).toMatchObject({ target: "salesforce", feature: null });
  });

  it("rejects a malformed manifest by shape", () => {
    const { plan } = scenario("builder");
    expect(reasonsOf(checkManifestAgainstPlan({} as ContextManifest, plan))).toContain("MANIFEST_SHAPE");
  });
});
