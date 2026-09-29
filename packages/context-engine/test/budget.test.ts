import type { AbuSpec, ArtifactSelector } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildContext, builderArtifactSelectors, ContextBuildError, estimateTokens, measureContext, sha256Of } from "../src/index.js";
import { literalGlob } from "../src/selectors.js";
import { docSelector, makeReader, planFor, policy, policyDoc, REPO, scenario } from "./fixtures.js";

const abu = (over: Partial<AbuSpec> = {}): AbuSpec => ({
  repo: "waronsaas/product",
  key: "contacts#04",
  title: "Contact list API",
  objective: "Serve the contact list over the API with paging and sorting.",
  requirements: ["R-001"],
  dependsOn: [],
  sizePoints: 3,
  scope: { write: ["modules/contacts/src/**", "modules/contacts/test/list.test.ts"], read: ["modules/shared/**"] },
  resources: [],
  acceptance: { checks: [{ id: "unit", run: ["npm", "test"] }], tests: ["modules/contacts/test/list.test.ts"] },
  ...over,
});

function builderCase(files: Record<string, string>, spec: AbuSpec = abu()) {
  const pol = policyDoc("builder");
  const task = { ref: "wos:task/0190f000-0000-7000-8000-000000000001", text: JSON.stringify({ abu: spec.key }) };
  const artifacts = builderArtifactSelectors({
    repo: REPO,
    feature: "contacts",
    abu: spec,
    policyDocument: { ref: pol.ref, sha256: sha256Of(pol.text) },
    taskDocument: { ref: task.ref, sha256: sha256Of(task.text) },
  });
  const base = { "wos.json": "{}\n", "features/contacts/CONTRACT.yaml": "feature: contacts\n", ...files };
  return { plan: planFor("builder", artifacts), reader: makeReader({ files: base, docs: { [pol.ref]: pol.text, [task.ref]: task.text } }) };
}

const bigFile = (tokens: number) => "x".repeat(tokens * 3);

describe("context-engine budget (DONE 3, CONTEXT-PROTOCOL.md section 5)", () => {
  it("context-engine R-budget: an ABU whose required artifacts exceed the builder budget is OVER_CONTEXT_BUDGET", async () => {
    // Write-scope files are required for the builder; 130k estimated tokens > 120k budget.
    const { plan, reader } = builderCase({ "modules/contacts/src/huge.ts": bigFile(130_000) });
    const err = await buildContext(plan, reader, policy).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContextBuildError);
    expect((err as ContextBuildError).code).toBe("OVER_CONTEXT_BUDGET");
    expect((err as ContextBuildError).details.budgetTokens).toBe(120_000);
    expect((err as ContextBuildError).details.requiredTokens as number).toBeGreaterThan(120_000);

    // The measurement planning's build-graph validator uses reports the same thing without throwing.
    const m = await measureContext(plan, builderCase({ "modules/contacts/src/huge.ts": bigFile(130_000) }).reader, policy);
    expect(m).toMatchObject({ overBudget: true, budgetTokens: 120_000 });
    expect(m.requiredTokens).toBe((err as ContextBuildError).details.requiredTokens);
  });

  it("an ABU that fits is measured under budget and builds", async () => {
    const { plan, reader } = builderCase({ "modules/contacts/src/list.ts": bigFile(50_000) });
    const m = await measureContext(plan, reader, policy);
    expect(m.overBudget).toBe(false);
    const { manifest } = await buildContext(plan, builderCase({ "modules/contacts/src/list.ts": bigFile(50_000) }).reader, policy);
    expect(manifest.budget.estimatedTokens).toBe(m.requiredTokens);
    expect(manifest.budget.estimatedTokens).toBe(manifest.artifacts.reduce((s, a) => s + a.estTokens, 0));
  });

  it("the boundary is inclusive: required tokens equal to the budget build", async () => {
    const probe = builderCase({ "modules/contacts/src/a.ts": "" });
    const m0 = await measureContext(probe.plan, probe.reader, policy);
    const room = 120_000 - m0.requiredTokens; // the empty file already costs its 40-token overhead
    const exact = builderCase({ "modules/contacts/src/a.ts": bigFile(room) });
    const m = await measureContext(exact.plan, exact.reader, policy);
    expect(m).toMatchObject({ requiredTokens: 120_000, overBudget: false });
    const over = builderCase({ "modules/contacts/src/a.ts": `${bigFile(room)}x` });
    expect((await measureContext(over.plan, over.reader, policy)).overBudget).toBe(true);
  });

  it("optional artifacts are dropped from the end once one does not fit, and recorded over_budget", async () => {
    const files = {
      "modules/contacts/src/a.ts": bigFile(60_000),
      "modules/shared/1.ts": bigFile(30_000),
      "modules/shared/2.ts": bigFile(40_000), // does not fit after 1.ts
      "modules/shared/3.ts": "tiny\n", // would fit, but is after the first overflow
      "features/contacts/BUILD-GRAPH.yaml": "tiny\n",
    };
    const { plan, reader } = builderCase(files);
    const { manifest, prompt } = await buildContext(plan, reader, policy);
    const refs = manifest.artifacts.map((a) => a.ref);
    expect(refs).toContain("modules/shared/1.ts");
    expect(manifest.excluded).toEqual([
      { ref: "modules/shared/2.ts", reason: "over_budget" },
      { ref: "modules/shared/3.ts", reason: "over_budget" },
      { ref: "features/contacts/BUILD-GRAPH.yaml", reason: "over_budget" },
    ]);
    expect(manifest.budget.estimatedTokens).toBeLessThanOrEqual(manifest.budget.limitTokens);
    expect(prompt).not.toContain('ref="modules/shared/2.ts"');
  });

  it("files are never partially truncated: an included artifact is whole", async () => {
    const content = `${bigFile(10_000)}\nEND-OF-FILE\n`;
    const { plan, reader } = builderCase({ "modules/shared/x.ts": content });
    const { prompt, manifest } = await buildContext(plan, reader, policy);
    expect(prompt).toContain(content);
    expect(manifest.artifacts.find((a) => a.ref === "modules/shared/x.ts")?.estTokens).toBe(estimateTokens(content, policy));
  });

  it("exclusions: binary, secret patterns, policy globs and missing optional files", async () => {
    const { plan, snap } = scenario("builder");
    const withExtra: ArtifactSelector[] = [
      ...plan.artifacts,
      { kind: "repo_file", repo: REPO, path: "docs/missing.md", required: false },
      { kind: "repo_file", repo: REPO, path: "wos.lock.json", required: false },
    ];
    const { manifest } = await buildContext(
      { ...plan, artifacts: withExtra, excludeGlobs: ["**/*.lock.json"] },
      makeReader({ ...snap, files: { ...snap.files, "wos.lock.json": "{}" } }),
      policy,
    );
    expect(manifest.excluded).toEqual(
      expect.arrayContaining([
        { ref: "modules/contacts/.env.local", reason: "secret_pattern" },
        { ref: "modules/contacts/src/logo.png", reason: "binary" },
        { ref: "docs/missing.md", reason: "missing_optional" },
        { ref: "wos.lock.json", reason: "policy_excluded" },
      ]),
    );
    expect(manifest.artifacts.map((a) => a.ref)).not.toContain("modules/contacts/.env.local");
  });

  it("invalid UTF-8 counts as binary", async () => {
    const { plan, snap } = scenario("builder");
    const files = { ...snap.files, "modules/contacts/src/latin1.ts": new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]) };
    const { manifest } = await buildContext(plan, makeReader({ ...snap, files }), policy);
    expect(manifest.excluded).toContainEqual({ ref: "modules/contacts/src/latin1.ts", reason: "binary" });
  });

  it("a missing required file aborts; a required file that is a secret aborts", async () => {
    const { plan, snap } = scenario("feature_author");
    const files = { ...snap.files };
    delete files["wos.json"];
    await expect(buildContext(plan, makeReader({ ...snap, files }), policy)).rejects.toThrow(/REQUIRED_ARTIFACT_MISSING/);
    const secretPlan = {
      ...plan,
      artifacts: [...plan.artifacts, { kind: "repo_file" as const, repo: REPO, path: "deploy/id_rsa", required: true }],
    };
    await expect(buildContext(secretPlan, makeReader({ ...snap, files: { ...snap.files, "deploy/id_rsa": "k" } }), policy)).rejects.toThrow(
      /REQUIRED_ARTIFACT_EXCLUDED/,
    );
  });

  it("a server document whose bytes do not match the plan's sha256 aborts", async () => {
    const { plan, snap } = scenario("roadmap_author");
    const task = plan.artifacts[1] as { ref: string };
    await expect(buildContext(plan, makeReader({ ...snap, docs: { ...snap.docs, [task.ref]: "tampered" } }), policy)).rejects.toThrow(
      /SERVER_DOCUMENT_MISMATCH/,
    );
  });

  it("a plan that contradicts the policy is refused before anything is read", async () => {
    const { plan, snap } = scenario("builder");
    const reader = makeReader(snap);
    await expect(buildContext({ ...plan, budgetTokens: 500_000 }, reader, policy)).rejects.toThrow(/BUDGET_MISMATCH/);
    await expect(buildContext({ ...plan, promptTemplateId: "tpl.roadmap_author.v1" }, reader, policy)).rejects.toThrow(/TEMPLATE_MISMATCH/);
    await expect(buildContext({ ...plan, contextFormatVersion: "ctx-0" }, reader, policy)).rejects.toThrow(/CONTEXT_FORMAT_MISMATCH/);
    await expect(buildContext({ ...plan, reasoning: "medium" }, reader, policy)).rejects.toThrow(/REASONING_BELOW_FLOOR/);
    expect(reader.reads).toEqual([]);
  });

  it("duplicate paths keep their first position; a later required selector makes them required", async () => {
    const pol = policyDoc("feature_author");
    const plan = planFor("feature_author", [
      docSelector(pol.ref, pol.text),
      { kind: "repo_glob", repo: REPO, glob: "features/**", required: false },
      { kind: "repo_file", repo: REPO, path: "features/contacts/CONTRACT.yaml", required: true },
    ]);
    const files = { "features/contacts/CONTRACT.yaml": "a\n", "features/contacts/BUILD-GRAPH.yaml": "b\n" };
    const { manifest } = await buildContext(plan, makeReader({ files, docs: { [pol.ref]: pol.text } }), policy);
    expect(manifest.artifacts.map((a) => a.ref)).toEqual([
      "tpl.feature_author.v1",
      pol.ref,
      "features/contacts/BUILD-GRAPH.yaml",
      "features/contacts/CONTRACT.yaml",
    ]);
  });

  it("builderArtifactSelectors follows the protocol order and escapes literal paths", () => {
    const sel = builderArtifactSelectors({
      repo: REPO,
      feature: "contacts",
      abu: abu({ scope: { write: ["modules/contacts/src/[id].ts", "modules/contacts/(ui)/**"], read: ["modules/shared/**"] } }),
      policyDocument: { ref: "wos:policy/builder@agent-policy.v1", sha256: sha256Of("p") },
      taskDocument: { ref: "wos:task/t", sha256: sha256Of("t") },
      findings: { ref: "wos:findings/a@1", sha256: sha256Of("f") },
      ci: { ref: "wos:ci/a@h", sha256: sha256Of("c") },
    });
    expect(
      sel.map((s) =>
        s.kind === "repo_glob" ? `glob:${s.glob}:${s.required}` : s.kind === "repo_file" ? `file:${s.path}:${s.required}` : `doc:${s.ref}`,
      ),
    ).toEqual([
      "doc:wos:policy/builder@agent-policy.v1",
      "doc:wos:task/t",
      "file:features/contacts/CONTRACT.yaml:true",
      "file:wos.json:true",
      "glob:modules/contacts/src/\\[id\\].ts:true",
      "glob:modules/contacts/\\(ui\\)/**:true",
      "glob:modules/contacts/test/list.test.ts:true",
      "doc:wos:findings/a@1",
      "doc:wos:ci/a@h",
      "glob:modules/shared/**:false",
      "file:features/contacts/BUILD-GRAPH.yaml:false",
    ]);
    expect(literalGlob("a/[b]*.ts")).toBe("a/\\[b\\]\\*.ts");
  });

  it("an acceptance test that does not exist yet at base is not an error", async () => {
    const { plan, reader } = builderCase({});
    const { manifest } = await buildContext(plan, reader, policy);
    expect(manifest.artifacts.map((a) => a.ref)).not.toContain("modules/contacts/test/list.test.ts");
    expect(manifest.task.kind).toBe("abu_build");
  });
});
