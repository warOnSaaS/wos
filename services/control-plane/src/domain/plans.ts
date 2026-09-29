/**
 * ContextPlans (CONTEXT-PROTOCOL.md sections 2-3): the server decides WHAT goes into every agent's
 * context. Server documents are rendered here deterministically (canonical JSON, sorted keys) and
 * referenced from the plan by ref + sha256.
 */
import {
  type AbuSpec,
  type AgentRole,
  ARTIFACT_PATHS,
  type ArtifactSelector,
  CONTEXT_FORMAT_VERSION,
  type ContextPlan,
  type ModelSpec,
  type ReasoningLevel,
  type RepoManifest,
  PROMPT_TEMPLATE_BY_ROLE,
} from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { canonicalJson, sha256Of } from "@waronsaas/contracts/canonical";
import type { TaskRow } from "../views.js";

export const SECRET_EXCLUDE_GLOBS = ["**/.env*", "**/*.pem", "**/*.key", "**/id_*"];

// contracts 4.2.0: the one role-to-template map lives in contracts (integration glue).
const TEMPLATE_BY_ROLE = PROMPT_TEMPLATE_BY_ROLE;

/** Renders a server document by ref, or null when the ref is unknown. Deterministic for fixed database state. */
export async function renderServerDocument(tx: Tx, deps: Deps, ref: string): Promise<string | null> {
  let m = /^wos:policy\/([a-z_]+)@(.+)$/.exec(ref);
  if (m) {
    const role = deps.policy.roles.find((r) => r.role === m![1]);
    if (!role || m[2] !== deps.policy.policyVersion) return null;
    return canonicalJson({
      role: role.role,
      policyVersion: deps.policy.policyVersion,
      obligations: role.obligations,
      materialFindingRules: role.materialFindingRules,
    });
  }
  m = /^wos:task\/([0-9a-f-]{36})$/.exec(ref);
  if (m) return renderTaskSpec(tx, m[1]!);
  m = /^wos:findings\/([0-9a-f-]{36})@(\d+)$/.exec(ref);
  if (m) return renderFindings(tx, m[1]!, Number(m[2]));
  m = /^wos:validator-errors\/([0-9a-f-]{36})$/.exec(ref);
  if (m) {
    const [t] = await tx<{ carry: unknown }[]>`select carry from wos.tasks where id = ${m[1]!}`;
    return t ? canonicalJson({ errors: t.carry ?? [] }) : null;
  }
  m = /^wos:proposals\/([a-z0-9-]+)$/.exec(ref);
  if (m) {
    const rows = await tx<{ id: string; title: string; body: string; state: string }[]>`
      select p.id, p.title, p.body, p.state from wos.proposals p
        left join wos.targets t on t.id = p.target_id left join wos.catalog_features f on f.id = p.catalog_feature_id
       where (t.slug = ${m[1]!} or f.key = ${m[1]!}) and p.state in ('open', 'accepted') order by p.id`;
    return canonicalJson({ proposals: rows });
  }
  m = /^wos:catalog-index@([0-9a-f]{40})$/.exec(ref);
  if (m) {
    const rows = await tx<{ key: string; title: string; summary: string; alias_of: string | null; apps: string[] }[]>`
      select f.key, f.title, f.summary, a.key as alias_of,
             coalesce(array_agg(t.slug order by t.slug) filter (where t.slug is not null), '{}') as apps
        from wos.catalog_features f
        left join wos.catalog_features a on a.id = f.alias_of
        left join wos.app_features af on af.catalog_feature_id = f.id and af.state <> 'descoped'
        left join wos.targets t on t.id = af.target_id
       group by f.key, f.title, f.summary, a.key order by f.key`;
    return canonicalJson({ commit: m[1], catalog: rows.map((r) => ({ ...r, aliasOf: r.alias_of, alias_of: undefined })) });
  }
  m = /^wos:app-refs\/([a-z0-9-]+)$/.exec(ref);
  if (m) {
    const rows = await tx<{ target: string; capability: string; weight_bp: number; weight_rationale: string; app_notes: string }[]>`
      select t.slug as target, c.key as capability, af.weight_bp, af.weight_rationale, af.app_notes
        from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id
        join wos.targets t on t.id = af.target_id join wos.capabilities c on c.id = af.capability_id
       where f.key = ${m[1]!} and af.state <> 'descoped' order by t.slug`;
    return canonicalJson({ feature: m[1], refs: rows });
  }
  m = /^wos:diff\/([0-9a-f-]{36})@([0-9a-f]{40})$/.exec(ref);
  if (m) {
    // V1 stand-in: the candidate's file manifest. The unified diff needs a GitHub compare (B-0001).
    const [c] = await tx<{ parent_sha: string; file_manifest: unknown; submission_sha256: string }[]>`
      select c.parent_sha, c.file_manifest, c.submission_sha256 from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id
       join wos.tasks t on t.id = c.task_id where t.attempt_id = ${m[1]!} and cc.commit_sha = ${m[2]!}`;
    return c
      ? canonicalJson({
          attemptId: m[1],
          headSha: m[2],
          parent: c.parent_sha,
          submissionSha256: c.submission_sha256,
          files: c.file_manifest,
        })
      : null;
  }
  m = /^wos:ci\/([0-9a-f-]{36})@([0-9a-f]{40})$/.exec(ref);
  if (m) {
    const rows = await tx<{ conclusion: string; github_check_suite_id: string | null; details: unknown }[]>`
      select conclusion, github_check_suite_id, details from wos.verification_runs
       where attempt_id = ${m[1]!} and head_sha = ${m[2]!} and source = 'ci' order by created_at, id`;
    return canonicalJson({
      attemptId: m[1],
      headSha: m[2],
      runs: rows.map((r) => ({ ...r, github_check_suite_id: String(r.github_check_suite_id) })),
    });
  }
  m = /^wos:dispute\/([0-9a-f-]{36})$/.exec(ref);
  if (m) {
    const [t] = await tx<{ document_id: string | null; attempt_id: string | null; carry: unknown }[]>`
      select document_id, attempt_id, carry from wos.tasks where id = ${m[1]!}`;
    if (!t) return null;
    const subject = t.document_id ?? t.attempt_id;
    const findings = subject ? await findingLedger(tx, subject, Number.MAX_SAFE_INTEGER, true) : [];
    return canonicalJson({ taskId: m[1], carry: t.carry ?? null, findings });
  }
  return null;
}

async function renderTaskSpec(tx: Tx, taskId: string): Promise<string | null> {
  const [t] = await tx<
    {
      id: string;
      kind: string;
      role: string;
      reviewer_slot: string | null;
      abu_id: string | null;
      attempt_id: string | null;
      document_id: string | null;
      round_id: string | null;
      carry: unknown;
    }[]
  >`select id, kind, role, reviewer_slot, abu_id, attempt_id, document_id, round_id, carry from wos.tasks where id = ${taskId}`;
  if (!t) return null;
  const spec: Record<string, unknown> = { taskId: t.id, kind: t.kind, role: t.role, reviewerSlot: t.reviewer_slot };
  const abuId =
    t.abu_id ??
    (t.attempt_id
      ? ((await tx<{ abu_id: string }[]>`select abu_id from wos.attempts where id = ${t.attempt_id}`)[0]?.abu_id ?? null)
      : null);
  if (abuId) {
    const [abu] = await tx<
      { key: string; spec: AbuSpec; document_id: string }[]
    >`select key, spec, document_id from wos.abus where id = ${abuId}`;
    if (abu) {
      spec.abu = abu.spec;
      const deps = await tx<{ spec: AbuSpec }[]>`
        select d.spec from wos.abu_dependencies e join wos.abus d on d.id = e.depends_on_abu_id where e.abu_id = ${abuId} order by d.key`;
      spec.dependencies = deps.map((d) => d.spec);
    }
  }
  if (t.attempt_id) {
    const [a] = await tx<
      { base_sha: string; repair_count: number }[]
    >`select base_sha, repair_count from wos.attempts where id = ${t.attempt_id}`;
    spec.attempt = { id: t.attempt_id, baseSha: a?.base_sha ?? null, repairCount: a?.repair_count ?? 0 };
  }
  if (t.round_id) {
    const [r] = await tx<{ round_number: number; head_sha: string; submission_sha256: string }[]>`
      select round_number, head_sha, submission_sha256 from wos.rounds where id = ${t.round_id}`;
    spec.round = r ? { id: t.round_id, number: r.round_number, headSha: r.head_sha, submissionSha256: r.submission_sha256 } : null;
    const [summary] = await tx<{ summary: unknown }[]>`
      select c.summary from wos.changesets c join wos.candidate_commits cc on cc.changeset_id = c.id
        join wos.rounds r on r.head_sha = cc.commit_sha where r.id = ${t.round_id} order by c.created_at desc limit 1`;
    spec.subjectSummary = summary?.summary ?? null;
  }
  if (t.document_id) {
    const [d] = await tx<{ kind: string; version: number; branch: string; head_sha: string | null; round_number: number }[]>`
      select kind, version, branch, head_sha, round_number from wos.documents where id = ${t.document_id}`;
    spec.document = d
      ? { id: t.document_id, kind: d.kind, version: d.version, branch: d.branch, headSha: d.head_sha, roundNumber: d.round_number }
      : null;
  }
  if (t.carry !== null && t.carry !== undefined) spec.carry = t.carry;
  return canonicalJson(spec);
}

async function findingLedger(tx: Tx, subjectId: string, upToRound: number, includeDisputedOnly: boolean) {
  const rows = await tx<
    {
      id: string;
      round_number: number;
      slot: string;
      severity: string;
      category: string;
      title: string;
      detail: string;
      state: string;
      suggested_resolution: string;
    }[]
  >`
    select f.id, r.round_number, v.slot, f.severity, f.category, f.title, f.detail, f.state, f.suggested_resolution
      from wos.findings f join wos.rounds r on r.id = f.round_id join wos.reviews v on v.id = f.review_id
     where (f.document_id = ${subjectId} or f.attempt_id = ${subjectId}) and r.state = 'revealed' and r.round_number <= ${upToRound}
       ${includeDisputedOnly ? tx`and f.state in ('open', 'disputed')` : tx``}
     order by r.round_number, f.id`;
  const out = [];
  for (const f of rows) {
    const responses = await tx<{ source: string; action: string; note: string }[]>`
      select source, action, note from wos.finding_responses where finding_id = ${f.id} order by created_at, id`;
    out.push({ ...f, responses });
  }
  return out;
}

async function renderFindings(tx: Tx, subjectId: string, upToRound: number): Promise<string> {
  return canonicalJson({ subjectId, upToRound, findings: await findingLedger(tx, subjectId, upToRound, false) });
}

export interface PlanInput {
  task: TaskRow;
  leaseId: string;
  /** The attempt this context belongs to (builds, revisions, implementation reviews). */
  attemptId: string | null;
  role: AgentRole;
  model: ModelSpec;
  reasoning: ReasoningLevel;
  source: { repo: string; commit: string };
  abu: AbuSpec | null;
  /** Round number of the prior revealed round whose findings this context carries (0 = none). */
  priorRound: number;
  subjectId: string | null;
  repoManifest: RepoManifest | null;
  /** Head sha of the implementation under review (reviewers) or after ci_failed (revisions). */
  headSha: string | null;
  ciFailed: boolean;
}

async function serverDoc(tx: Tx, deps: Deps, ref: string, required: boolean): Promise<ArtifactSelector | null> {
  const text = await renderServerDocument(tx, deps, ref);
  if (text === null) return null;
  return { kind: "server_document", ref, sha256: sha256Of(text), required };
}

const repoFile = (repo: string, path: string, required: boolean): ArtifactSelector => ({ kind: "repo_file", repo, path, required });
const repoGlob = (repo: string, glob: string, required: boolean): ArtifactSelector => ({ kind: "repo_glob", repo, glob, required });

/** The ordered artifact list of CONTEXT-PROTOCOL.md section 3 for the plan's role. */
export async function buildPlan(tx: Tx, deps: Deps, input: PlanInput): Promise<ContextPlan> {
  const { task, role, source } = input;
  const repo = source.repo;
  const feature = task.feature_key;
  const target = task.target_slug;
  const policyRole = deps.policy.roles.find((r) => r.role === role);
  if (!policyRole) throw new Error(`policy has no role ${role}`);
  const docs: Array<Promise<ArtifactSelector | null>> = [];
  const push = (p: ArtifactSelector | Promise<ArtifactSelector | null> | null) => docs.push(Promise.resolve(p));
  push(serverDoc(tx, deps, `wos:policy/${role}@${deps.policy.policyVersion}`, true));
  push(serverDoc(tx, deps, `wos:task/${task.id}`, true));
  const allowedCommands: string[][] = [];

  if (role === "builder") {
    const abu = input.abu!;
    push(repoFile(repo, ARTIFACT_PATHS.featureContract(feature!), true));
    push(repoFile(repo, ARTIFACT_PATHS.repoManifest, true));
    for (const w of abu.scope.write) push(repoGlob(repo, w, true));
    for (const t of abu.acceptance.tests) push(repoGlob(repo, t, true));
    if (input.priorRound > 0 && input.subjectId) push(serverDoc(tx, deps, `wos:findings/${input.subjectId}@${input.priorRound}`, true));
    if (input.ciFailed && input.headSha && input.subjectId) push(serverDoc(tx, deps, `wos:ci/${input.subjectId}@${input.headSha}`, true));
    // B-0007-github-build (integration glue): repair runs see why their local checks failed.
    push({ kind: "local_document", ref: "local:verification-output", required: false });
    for (const r of abu.scope.read) push(repoGlob(repo, r, false));
    push(repoFile(repo, ARTIFACT_PATHS.buildGraph(feature!), false));
    for (const step of input.repoManifest?.verify ?? []) allowedCommands.push(step.run);
    for (const check of abu.acceptance.checks) allowedCommands.push(check.run);
  } else if (role === "roadmap_author" || role === "roadmap_reviewer_astra" || role === "roadmap_reviewer_fable") {
    const author = role === "roadmap_author";
    if (!target) throw new Error(`roadmap task ${task.id} has no target`);
    push(repoFile(repo, ARTIFACT_PATHS.inventory(target), !author));
    push(repoFile(repo, ARTIFACT_PATHS.roadmap(target), !author));
    push(serverDoc(tx, deps, `wos:catalog-index@${source.commit}`, true));
    if (input.priorRound > 0 && input.subjectId) push(serverDoc(tx, deps, `wos:findings/${input.subjectId}@${input.priorRound}`, true));
    if (author && task.carry) push(serverDoc(tx, deps, `wos:validator-errors/${task.id}`, true));
    if (author) push(serverDoc(tx, deps, `wos:proposals/${target}`, true));
    push(repoGlob(repo, "catalog/*.yaml", false));
  } else if (role === "feature_author" || role === "feature_reviewer_astra" || role === "feature_reviewer_fable") {
    const author = role === "feature_author";
    push(repoFile(repo, ARTIFACT_PATHS.catalogEntry(feature!), true));
    push(serverDoc(tx, deps, `wos:app-refs/${feature}`, true));
    push(repoFile(repo, ARTIFACT_PATHS.featureContract(feature!), !author));
    push(repoFile(repo, ARTIFACT_PATHS.buildGraph(feature!), !author));
    push(repoFile(repo, ARTIFACT_PATHS.repoManifest, true));
    if (input.priorRound > 0 && input.subjectId) push(serverDoc(tx, deps, `wos:findings/${input.subjectId}@${input.priorRound}`, true));
    if (author && task.carry) push(serverDoc(tx, deps, `wos:validator-errors/${task.id}`, true));
    push(serverDoc(tx, deps, `wos:proposals/${feature}`, true));
    push(repoGlob(repo, `${ARTIFACT_PATHS.module(feature!)}/**`, false));
  } else if (role === "implementation_reviewer_astra" || role === "implementation_reviewer_fable") {
    const abu = input.abu!;
    push(serverDoc(tx, deps, `wos:diff/${input.subjectId}@${input.headSha}`, true));
    push(repoFile(repo, ARTIFACT_PATHS.featureContract(feature!), true));
    for (const w of abu.scope.write) push(repoGlob(repo, w, true));
    for (const t of abu.acceptance.tests) push(repoGlob(repo, t, true));
    push(serverDoc(tx, deps, `wos:ci/${input.subjectId}@${input.headSha}`, true));
    if (input.priorRound > 0 && input.subjectId) push(serverDoc(tx, deps, `wos:findings/${input.subjectId}@${input.priorRound}`, true));
    for (const r of abu.scope.read) push(repoGlob(repo, r, false));
  } else if (role === "conflict_resolver") {
    push(serverDoc(tx, deps, `wos:dispute/${task.id}`, true));
    if (feature) push(serverDoc(tx, deps, `wos:app-refs/${feature}`, false));
  }
  const artifacts = (await Promise.all(docs)).filter((a): a is ArtifactSelector => a !== null);
  return {
    schema: "wos-context-plan.v1",
    taskId: task.id,
    taskKind: task.kind,
    leaseId: input.leaseId,
    role,
    model: input.model.ref,
    modelId: input.model.modelId,
    provider: input.model.provider,
    reasoning: input.reasoning,
    policyVersion: deps.policy.policyVersion,
    contextFormatVersion: CONTEXT_FORMAT_VERSION,
    target,
    feature,
    abu: task.abu_key,
    attemptId: input.attemptId ?? task.attempt_id,
    roundId: task.round_id,
    // contracts 3.1.0 roundNumber for review plans (the current round = prior + 1), integration glue.
    ...(role.includes("_reviewer_") && task.round_id ? { roundNumber: input.priorRound + 1 } : {}),
    source,
    artifacts,
    excludeGlobs: SECRET_EXCLUDE_GLOBS,
    promptTemplateId: TEMPLATE_BY_ROLE[role],
    // D15 (contracts 4.1.0), integration glue: the per-model override when the policy has one.
    budgetTokens:
      policyRole.budgetOverrides.find((o) => o.model === input.model.ref)?.contextBudgetTokens ?? policyRole.contextBudgetTokens,
    outputSchema: policyRole.outputSchema,
    allowedCommands,
  };
}
