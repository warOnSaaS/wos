import { createHash } from "node:crypto";
import {
  AGENT_POLICY_V1,
  type AgentRole,
  type ArtifactSelector,
  type ContextPlan,
  type ReasoningLevel,
  type TaskKind,
} from "@waronsaas/contracts";
import picomatch from "picomatch";
import { PROMPT_TEMPLATE_BY_ROLE, renderPolicyDocument, type SnapshotReader, sha256Of } from "../src/index.js";

export const policy = AGENT_POLICY_V1;
export const REPO = "waronsaas/suite";
export const COMMIT = "1111111111111111111111111111111111111111";
export const ROUND = "0190f000-0000-7000-8000-000000000004";
export const OTHER_ROUND = "0190f000-0000-7000-8000-0000000000ff";

const enc = new TextEncoder();

/** The git blob id of some bytes, as `git hash-object` computes it. */
export function gitBlobOid(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FakeSnapshot {
  files: Record<string, string | Uint8Array>;
  docs: Record<string, string | Uint8Array>;
  /** Shuffle listFiles output (the engine must sort it itself). */
  shuffleSeed?: number;
  /** `local:verification-output` bytes, when this is a local repair run. */
  localOutput?: string;
}

export const TASK_KIND_BY_ROLE: Record<AgentRole, TaskKind> = {
  roadmap_author: "roadmap_author",
  roadmap_reviewer_astra: "roadmap_review",
  roadmap_reviewer_fable: "roadmap_review",
  feature_author: "feature_author",
  feature_reviewer_astra: "feature_review",
  feature_reviewer_fable: "feature_review",
  builder: "abu_build",
  implementation_reviewer_astra: "implementation_review",
  implementation_reviewer_fable: "implementation_review",
  conflict_resolver: "conflict_resolution",
};

export interface CountingReader extends SnapshotReader {
  reads: string[];
}

export function makeReader(snap: FakeSnapshot): CountingReader {
  const bytesOf = (v: string | Uint8Array) => (typeof v === "string" ? enc.encode(v) : v);
  const rand = snap.shuffleSeed === undefined ? null : prng(snap.shuffleSeed);
  const reads: string[] = [];
  return {
    reads,
    async readFile(path) {
      reads.push(path);
      const v = snap.files[path];
      if (v === undefined) return null;
      const bytes = bytesOf(v);
      return { bytes, gitBlobOid: gitBlobOid(bytes) };
    },
    async listFiles(glob) {
      const m = picomatch(glob, { dot: true });
      const out = Object.keys(snap.files).filter((p) => m(p));
      if (rand) {
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [out[i], out[j]] = [out[j] as string, out[i] as string];
        }
      } else {
        out.sort();
      }
      return out;
    },
    async readLocalDocument() {
      return snap.localOutput === undefined ? null : enc.encode(snap.localOutput);
    },
    async readServerDocument(ref) {
      const v = snap.docs[ref];
      if (v === undefined) throw new Error(`no server document ${ref}`);
      return bytesOf(v);
    },
  };
}

export function docSelector(ref: string, content: string | Uint8Array, required = true): ArtifactSelector {
  return { kind: "server_document", ref, sha256: sha256Of(content), required };
}

export function policyDoc(role: AgentRole): { ref: string; text: string } {
  return { ref: `wos:policy/${role}@${policy.policyVersion}`, text: renderPolicyDocument(role, policy) };
}

export function planFor(role: AgentRole, artifacts: ArtifactSelector[], overrides: Partial<ContextPlan> = {}): ContextPlan {
  const rp = policy.roles.find((r) => r.role === role)!;
  const model = policy.models.find((m) => m.ref === rp.allowedModels[0])!;
  const reasoning: ReasoningLevel = rp.reasoning.required === "max" ? model.maxReasoning : rp.reasoning.required;
  const impl = role === "builder" || role.startsWith("implementation_");
  return {
    schema: "wos-context-plan.v1",
    taskId: "0190f000-0000-7000-8000-000000000001",
    taskKind: TASK_KIND_BY_ROLE[role],
    leaseId: "0190f000-0000-7000-8000-000000000002",
    role,
    model: model.ref,
    modelId: model.modelId,
    provider: model.provider,
    reasoning,
    policyVersion: policy.policyVersion,
    contextFormatVersion: "ctx-1",
    // Roadmap work is scoped to one app; everything else to the shared feature (contracts 3.0.0).
    target: role.startsWith("roadmap_") ? "salesforce" : null,
    feature: role.startsWith("roadmap_") ? null : "contacts",
    abu: impl ? "contacts#04" : null,
    attemptId: impl ? "0190f000-0000-7000-8000-000000000003" : null,
    roundId: rp.reviewerSlot ? ROUND : null,
    source: { repo: REPO, commit: COMMIT },
    artifacts,
    excludeGlobs: [],
    promptTemplateId: PROMPT_TEMPLATE_BY_ROLE[role],
    budgetTokens: rp.contextBudgetTokens,
    outputSchema: rp.outputSchema,
    allowedCommands: role === "builder" ? [["npm", "test"]] : [],
    ...overrides,
  };
}

/** A small but realistic product repo snapshot and a plan per role over it. */
export function scenario(role: AgentRole): { plan: ContextPlan; snap: FakeSnapshot } {
  const pol = policyDoc(role);
  const task = { ref: "wos:task/0190f000-0000-7000-8000-000000000001", text: `{"kind":"${role}","round":2}\n` };
  const findings = { ref: "wos:findings/0190f000-0000-7000-8000-000000000003@1", text: "# Findings\n\n- f1 resolved\n" };
  const files: Record<string, string | Uint8Array> = {
    "wos.json": '{"schema":"wos-repo.v1"}\n',
    "features/contacts/CONTRACT.yaml": "schema: wos-feature-contract.v1\nfeature: contacts\n",
    "features/contacts/BUILD-GRAPH.yaml": "schema: wos-build-graph.v1\n",
    "modules/contacts/src/index.ts": "export const contacts = [];\n",
    "modules/contacts/src/ÿ-last.ts": "// sorts after z in byte order\n",
    "modules/contacts/src/z.ts": "export const z = 1;\n",
    "modules/contacts/src/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    "modules/contacts/.env.local": "SECRET=1\n",
    "modules/contacts/test/contacts.test.ts": "it('works', () => {});\n",
    "roadmaps/salesforce/INVENTORY.yaml": "items: []\n",
    "roadmaps/salesforce/ROADMAP.yaml": "capabilities: []\n",
    "catalog/contacts.yaml": "key: contacts\n",
  };
  const docs: Record<string, string> = { [pol.ref]: pol.text, [task.ref]: task.text, [findings.ref]: findings.text };
  const base: ArtifactSelector[] = [docSelector(pol.ref, pol.text), docSelector(task.ref, task.text)];
  let artifacts: ArtifactSelector[];
  if (role === "builder" || role.startsWith("implementation_")) {
    artifacts = [
      ...base,
      { kind: "repo_file", repo: REPO, path: "features/contacts/CONTRACT.yaml", required: true },
      { kind: "repo_file", repo: REPO, path: "wos.json", required: true },
      { kind: "repo_glob", repo: REPO, glob: "modules/contacts/**", required: true },
      docSelector(findings.ref, findings.text),
      { kind: "repo_file", repo: REPO, path: "features/contacts/BUILD-GRAPH.yaml", required: false },
    ];
  } else if (role.startsWith("roadmap_")) {
    artifacts = [
      ...base,
      { kind: "repo_file", repo: REPO, path: "roadmaps/salesforce/INVENTORY.yaml", required: true },
      { kind: "repo_file", repo: REPO, path: "roadmaps/salesforce/ROADMAP.yaml", required: true },
      { kind: "repo_glob", repo: REPO, glob: "catalog/*.yaml", required: false },
    ];
  } else {
    artifacts = [
      ...base,
      { kind: "repo_file", repo: REPO, path: "features/contacts/CONTRACT.yaml", required: true },
      { kind: "repo_file", repo: REPO, path: "features/contacts/BUILD-GRAPH.yaml", required: true },
      { kind: "repo_file", repo: REPO, path: "wos.json", required: true },
      { kind: "repo_glob", repo: REPO, glob: "catalog/*.yaml", required: false },
    ];
  }
  const taskKind = role === "builder" ? "abu_revision" : TASK_KIND_BY_ROLE[role];
  return { plan: planFor(role, artifacts, { taskKind }), snap: { files, docs } };
}
