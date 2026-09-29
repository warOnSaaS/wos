import type { ContextManifest } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildContext, checkManifestAgainstPlan, computeManifestSha256, sha256Of } from "../src/index.js";
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
      expect(checkManifestAgainstPlan(manifest, plan), role).toEqual({ ok: true });
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

  it("rejects a malformed manifest by shape", () => {
    const { plan } = scenario("builder");
    expect(reasonsOf(checkManifestAgainstPlan({} as ContextManifest, plan))).toContain("MANIFEST_SHAPE");
  });
});
