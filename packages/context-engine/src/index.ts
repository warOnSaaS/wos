/**
 * @waronsaas/context-engine — deterministic, role-specific context assembly (owner: context-policy workstream).
 * Same inputs => byte-identical prompt and manifest. No clock, no randomness, no environment reads, no
 * filesystem: repository bytes come only through the SnapshotReader (CONTEXT-PROTOCOL.md).
 */
import { createHash } from "node:crypto";
import { canonicalJson, checkPlanAgainstPolicy } from "@waronsaas/agent-policy";
import {
  type AgentRole,
  CONTEXT_FORMAT_VERSION,
  CONTRACTS_VERSION,
  ContextManifest,
  ContextPlan,
  type AgentPolicyDocument,
  type ArtifactSelector,
  type ManifestArtifact,
  type RolePolicy,
  type TaskKind,
} from "@waronsaas/contracts";
import picomatch from "picomatch";
import { TEMPLATE_SOURCES } from "./templates.generated.js";

export { builderArtifactSelectors, type BuilderSelectorInput } from "./selectors.js";

/** Read-only view of the source repo at the plan's source commit, plus server documents. */
export interface SnapshotReader {
  /** Returns null when the path does not exist at the commit. */
  readFile(path: string): Promise<{ bytes: Uint8Array; gitBlobOid: string } | null>;
  /** Sorted list of paths matching a glob at the commit. */
  listFiles(glob: string): Promise<string[]>;
  readServerDocument(ref: string): Promise<Uint8Array>;
}

export interface BuiltContext {
  manifest: ContextManifest;
  /** The full prompt written to the agent CLI's stdin. */
  prompt: string;
}

type ExclusionReason = ContextManifest["excluded"][number]["reason"];
type Sha256 = ContextManifest["manifestSha256"];

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export type ContextBuildErrorCode =
  /** Required artifacts alone exceed the role budget: the ABU must be decomposed (CONTEXT-PROTOCOL.md section 5). */
  | "OVER_CONTEXT_BUDGET"
  | "REQUIRED_ARTIFACT_MISSING"
  /** A required artifact is binary, a secret, policy-excluded or the other slot's current verdict. */
  | "REQUIRED_ARTIFACT_EXCLUDED"
  | "SERVER_DOCUMENT_MISMATCH"
  | "PLAN_INVALID";

export class ContextBuildError extends Error {
  readonly code: ContextBuildErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ContextBuildErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = "ContextBuildError";
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------------------------
// Hashing and estimates
// ---------------------------------------------------------------------------------------------

/** "sha256:<hex>" of raw bytes, or of a string's UTF-8 encoding. */
export function sha256Of(data: Uint8Array | string): Sha256 {
  const hash = createHash("sha256");
  if (typeof data === "string") hash.update(data, "utf8");
  else hash.update(data);
  return `sha256:${hash.digest("hex")}`;
}

/** RFC 8785 canonical JSON + sha256, shared by manifests, agent runs and provenance. */
export function canonicalSha256(value: unknown): string {
  return sha256Of(canonicalJson(value));
}

/** Conservative token estimate used for every budget decision (policy.tokenEstimator). */
export function estimateTokens(text: string, policy: AgentPolicyDocument): number {
  return Math.ceil(text.length / policy.tokenEstimator.charsPerToken) + policy.tokenEstimator.perArtifactOverheadTokens;
}

/** `manifestSha256` for a manifest: sha256 of JCS(manifest without manifestSha256). */
export function computeManifestSha256(manifest: Omit<ContextManifest, "manifestSha256"> | ContextManifest): Sha256 {
  const { manifestSha256: _ignored, ...rest } = manifest as ContextManifest;
  return canonicalSha256(rest) as Sha256;
}

// ---------------------------------------------------------------------------------------------
// Templates, task kinds, policy documents
// ---------------------------------------------------------------------------------------------

export const PROMPT_TEMPLATE_BY_ROLE: Readonly<Record<AgentRole, string>> = {
  roadmap_author: "tpl.roadmap_author.v1",
  roadmap_reviewer_astra: "tpl.roadmap_reviewer.v1",
  roadmap_reviewer_fable: "tpl.roadmap_reviewer.v1",
  feature_author: "tpl.feature_author.v1",
  feature_reviewer_astra: "tpl.feature_reviewer.v1",
  feature_reviewer_fable: "tpl.feature_reviewer.v1",
  builder: "tpl.builder.v1",
  implementation_reviewer_astra: "tpl.implementation_reviewer.v1",
  implementation_reviewer_fable: "tpl.implementation_reviewer.v1",
  conflict_resolver: "tpl.conflict_resolver.v1",
};

/** The source text of a prompt template (templates/<id>.md, embedded at build time). */
export function templateSource(id: string): string {
  const src = TEMPLATE_SOURCES[id];
  if (src === undefined) throw new ContextBuildError("PLAN_INVALID", `unknown prompt template ${id}`);
  return src;
}

export function templateSha256(id: string): Sha256 {
  return sha256Of(templateSource(id));
}

/**
 * The manifest's task kind, derived from the plan (ContextPlan carries no task kind; see
 * B-0001-context-policy). A builder plan that carries a finding ledger is a revision.
 */
export function taskKindForPlan(plan: Pick<ContextPlan, "role" | "artifacts">): TaskKind {
  switch (plan.role) {
    case "roadmap_author":
      return "roadmap_author";
    case "roadmap_reviewer_astra":
    case "roadmap_reviewer_fable":
      return "roadmap_review";
    case "feature_author":
      return "feature_author";
    case "feature_reviewer_astra":
    case "feature_reviewer_fable":
      return "feature_review";
    case "implementation_reviewer_astra":
    case "implementation_reviewer_fable":
      return "implementation_review";
    case "conflict_resolver":
      return "conflict_resolution";
    case "builder":
      return plan.artifacts.some((a) => a.kind === "server_document" && a.ref.startsWith("wos:findings/")) ? "abu_revision" : "abu_build";
  }
}

/** Server ref of a role's policy document. */
export function policyDocumentRef(role: AgentRole, policy: AgentPolicyDocument): string {
  return `wos:policy/${role}@${policy.policyVersion}`;
}

/**
 * The `wos:policy/<role>@<policyVersion>` server document: the role's obligations and
 * materialFindingRules, verbatim, in order. The control plane serves exactly these bytes so the
 * selector's sha256 matches on every client.
 */
export function renderPolicyDocument(role: AgentRole, policy: AgentPolicyDocument): string {
  const rp = rolePolicy(role, policy);
  const lines = [`# wOS policy: ${role} (${policy.policyVersion})`, "", "## Obligations", "", ...numbered(rp.obligations)];
  if (rp.materialFindingRules.length > 0) lines.push("", "## Material finding rules", "", ...numbered(rp.materialFindingRules));
  return `${lines.join("\n")}\n`;
}

function numbered(items: string[]): string[] {
  return items.map((text, i) => `${i + 1}. ${text}`);
}

function rolePolicy(role: AgentRole, policy: AgentPolicyDocument): RolePolicy {
  const rp = policy.roles.find((r) => r.role === role);
  if (!rp) throw new ContextBuildError("PLAN_INVALID", `role ${role} missing from ${policy.policyVersion}`);
  return rp;
}

// ---------------------------------------------------------------------------------------------
// Exclusion rules
// ---------------------------------------------------------------------------------------------

/** Files never placed in a prompt, whatever the plan says (CONTEXT-PROTOCOL.md section 4). */
export const SECRET_PATTERNS: readonly string[] = ["**/.env*", "**/*.pem", "**/*.key", "**/id_*"];
const isSecretPath = picomatch([...SECRET_PATTERNS], { dot: true });

/**
 * True when a server ref is a review verdict of the given (current) round. Such a document is never
 * placed in a reviewer's context (exclusion reason `other_slot_current_round`). V1 convention for
 * verdict refs: `wos:verdict/<roundId>/<slot>` (also `wos:review/...`); see B-0001-context-policy.
 */
export function isCurrentRoundVerdictRef(ref: string, roundId: string | null): boolean {
  if (roundId === null) return false;
  if (!/^wos:(verdicts?|reviews?)\//.test(ref)) return false;
  return ref.split(/[/@]/).includes(roundId);
}

function globMatcher(globs: string[]): (s: string) => boolean {
  if (globs.length === 0) return () => false;
  return picomatch(globs, { dot: true });
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

interface Entry {
  key: string;
  manifestKind: ManifestArtifact["kind"];
  ref: string;
  /** Must be in the context (counts toward the required budget). */
  required: boolean;
  /** True when every requiring occurrence came from a glob: a binary or secret match is dropped, not fatal. */
  soft: boolean;
  gitBlobOid: string | null;
  text: string | null;
  sha256: Sha256 | null;
  bytes: number;
  exclusion: ExclusionReason | null;
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

/** Bytewise (UTF-8) order = Unicode code point order; locale independent, same on every OS. */
export function compareBytewise(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
    const cx = (x.value as string).codePointAt(0) as number;
    const cy = (y.value as string).codePointAt(0) as number;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

function serverKind(ref: string): ManifestArtifact["kind"] {
  if (ref.startsWith("wos:task/")) return "task_spec";
  if (ref.startsWith("wos:policy/")) return "policy";
  return "server_document";
}

function validatePlan(input: ContextPlan, policy: AgentPolicyDocument): ContextPlan {
  const parsed = ContextPlan.safeParse(input);
  if (!parsed.success)
    throw new ContextBuildError("PLAN_INVALID", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const plan = parsed.data;
  const reasons = checkPlanAgainstPolicy(plan, policy);
  if (plan.contextFormatVersion !== CONTEXT_FORMAT_VERSION) {
    reasons.push(`CONTEXT_FORMAT_MISMATCH: engine is ${CONTEXT_FORMAT_VERSION}, plan says ${plan.contextFormatVersion}`);
  }
  if (plan.promptTemplateId !== PROMPT_TEMPLATE_BY_ROLE[plan.role]) {
    reasons.push(`TEMPLATE_MISMATCH: ${plan.role} uses ${PROMPT_TEMPLATE_BY_ROLE[plan.role]}, plan says ${plan.promptTemplateId}`);
  }
  if (TEMPLATE_SOURCES[plan.promptTemplateId] === undefined) reasons.push(`UNKNOWN_TEMPLATE: ${plan.promptTemplateId}`);
  if (reasons.length > 0) throw new ContextBuildError("PLAN_INVALID", reasons.join("; "), { reasons });
  return plan;
}

/** Resolves selectors in plan order (reads bytes); no budget decisions yet. */
async function resolveEntries(plan: ContextPlan, reader: SnapshotReader): Promise<Entry[]> {
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  const policyExcluded = globMatcher(plan.excludeGlobs);

  const addRepoPath = async (path: string, required: boolean, soft: boolean) => {
    const key = `repo:${path}`;
    const seen = byKey.get(key);
    if (seen) {
      // Duplicates keep their first position; a later required occurrence makes it required.
      if (required) {
        seen.soft = seen.required ? seen.soft && soft : soft;
        seen.required = true;
      }
      return;
    }
    const entry: Entry = {
      key,
      manifestKind: "repo_file",
      ref: path,
      required,
      soft,
      gitBlobOid: null,
      text: null,
      sha256: null,
      bytes: 0,
      exclusion: null,
    };
    byKey.set(key, entry);
    entries.push(entry);
    if (isSecretPath(path)) entry.exclusion = "secret_pattern";
    else if (policyExcluded(path)) entry.exclusion = "policy_excluded";
    if (entry.exclusion) return;
    const file = await reader.readFile(path);
    if (file === null) {
      entry.exclusion = "missing_optional";
      return;
    }
    entry.gitBlobOid = file.gitBlobOid;
    entry.sha256 = sha256Of(file.bytes);
    entry.bytes = file.bytes.byteLength;
    entry.text = decodeText(file.bytes);
    if (entry.text === null) entry.exclusion = "binary";
  };

  for (const selector of plan.artifacts) {
    if (selector.kind === "repo_file") {
      await addRepoPath(selector.path, selector.required, false);
    } else if (selector.kind === "repo_glob") {
      const matches = globMatcher([selector.glob]);
      const listed = await reader.listFiles(selector.glob);
      const paths = [...new Set(listed.filter((p) => matches(p)))].sort(compareBytewise);
      for (const path of paths) await addRepoPath(path, selector.required, true);
    } else {
      const key = `server:${selector.ref}`;
      const seen = byKey.get(key);
      if (seen) {
        if (selector.required) {
          seen.soft = false;
          seen.required = true;
        }
        continue;
      }
      const entry: Entry = {
        key,
        manifestKind: serverKind(selector.ref),
        ref: selector.ref,
        required: selector.required,
        soft: false,
        gitBlobOid: null,
        text: null,
        sha256: null,
        bytes: 0,
        exclusion: null,
      };
      byKey.set(key, entry);
      entries.push(entry);
      if (isCurrentRoundVerdictRef(selector.ref, plan.roundId)) entry.exclusion = "other_slot_current_round";
      else if (policyExcluded(selector.ref)) entry.exclusion = "policy_excluded";
      if (entry.exclusion) continue;
      const bytes = await reader.readServerDocument(selector.ref);
      const sha = sha256Of(bytes);
      if (sha !== selector.sha256) {
        throw new ContextBuildError("SERVER_DOCUMENT_MISMATCH", `${selector.ref} has ${sha}, plan expects ${selector.sha256}`, {
          ref: selector.ref,
          expected: selector.sha256,
          actual: sha,
        });
      }
      entry.sha256 = sha;
      entry.bytes = bytes.byteLength;
      entry.text = decodeText(bytes);
      if (entry.text === null) entry.exclusion = "binary";
    }
  }

  for (const e of entries) {
    if (!e.required || e.exclusion === null) continue;
    if (e.exclusion === "missing_optional") {
      if (!e.soft)
        throw new ContextBuildError("REQUIRED_ARTIFACT_MISSING", `${e.ref} does not exist at ${plan.source.commit}`, { ref: e.ref });
    } else if (!e.soft || e.exclusion === "other_slot_current_round") {
      throw new ContextBuildError("REQUIRED_ARTIFACT_EXCLUDED", `${e.ref} is required but excluded (${e.exclusion})`, {
        ref: e.ref,
        reason: e.exclusion,
      });
    }
  }
  return entries;
}

function renderTemplate(source: string, vars: Record<string, string>): string {
  // Split first, then substitute, so text inside substituted values is never re-interpreted.
  const parts = source.split(/\{\{([A-Za-z]+)\}\}/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    if (i % 2 === 0) {
      out += part;
    } else {
      const value = vars[part];
      if (value === undefined) throw new ContextBuildError("PLAN_INVALID", `template variable {{${part}}} is unknown`);
      out += value;
    }
  }
  return out;
}

function renderObligations(plan: ContextPlan, rp: RolePolicy): string {
  return [`Obligations (${plan.policyVersion}, ${rp.role}), verbatim and in order:`, ...numbered(rp.obligations)].join("\n");
}

function renderMaterialRules(plan: ContextPlan, rp: RolePolicy): string {
  if (rp.materialFindingRules.length === 0) return "";
  return [
    `Material finding rules (${plan.policyVersion}, ${rp.role}), verbatim and in order. Each of these MUST be reported as a material finding:`,
    ...numbered(rp.materialFindingRules),
  ].join("\n");
}

function renderBlock(e: Entry): string {
  const tag = (e.sha256 as string).slice("sha256:".length, "sha256:".length + 16);
  const body = e.text as string;
  const newline = body.length === 0 || body.endsWith("\n") ? "" : "\n";
  return `<<<wos:begin kind=${e.manifestKind} ref=${JSON.stringify(e.ref)} sha=${tag}>>>\n${body}${newline}<<<wos:end sha=${tag}>>>\n`;
}

interface Assembly {
  prompt: string;
  artifacts: ManifestArtifact[];
  excluded: ContextManifest["excluded"];
  estimatedTokens: number;
  requiredTokens: number;
}

/** Pure part: budget decisions and rendering over resolved entries. */
function assemble(plan: ContextPlan, entries: Entry[], policy: AgentPolicyDocument): Assembly {
  const rp = rolePolicy(plan.role, policy);
  const source = templateSource(plan.promptTemplateId);
  const vars = {
    role: plan.role,
    policyVersion: plan.policyVersion,
    outputSchema: plan.outputSchema,
    obligations: renderObligations(plan, rp),
    materialFindingRules: renderMaterialRules(plan, rp),
  };
  const frameTokens = estimateTokens(renderTemplate(source, { ...vars, artifacts: "" }), policy);

  const est = new Map<Entry, number>();
  let requiredTokens = frameTokens;
  for (const e of entries) {
    if (e.exclusion !== null) continue;
    const t = estimateTokens(e.text as string, policy);
    est.set(e, t);
    if (e.required) requiredTokens += t;
  }
  if (requiredTokens > plan.budgetTokens) {
    throw new ContextBuildError(
      "OVER_CONTEXT_BUDGET",
      `required artifacts need ${requiredTokens} estimated tokens, the ${plan.role} budget is ${plan.budgetTokens}`,
      { requiredTokens, budgetTokens: plan.budgetTokens },
    );
  }

  // Optional artifacts in plan order while they fit; from the first that does not, the rest are dropped.
  let running = requiredTokens;
  let budgetExhausted = false;
  for (const e of entries) {
    if (e.required || e.exclusion !== null) continue;
    const t = est.get(e) as number;
    if (!budgetExhausted && running + t <= plan.budgetTokens) {
      running += t;
    } else {
      budgetExhausted = true;
      e.exclusion = "over_budget";
    }
  }

  const included = entries.filter((e) => e.exclusion === null);
  const prompt = renderTemplate(source, { ...vars, artifacts: included.map(renderBlock).join("\n") });
  const templateBytes = new TextEncoder().encode(source).byteLength;
  const artifacts: ManifestArtifact[] = [
    {
      kind: "prompt_template",
      ref: plan.promptTemplateId,
      gitBlobOid: null,
      sha256: sha256Of(source),
      bytes: templateBytes,
      estTokens: frameTokens,
    },
    ...included.map((e) => ({
      kind: e.manifestKind,
      ref: e.ref,
      gitBlobOid: e.manifestKind === "repo_file" ? e.gitBlobOid : null,
      sha256: e.sha256 as Sha256,
      bytes: e.bytes,
      estTokens: est.get(e) as number,
    })),
  ];
  const excluded = entries.filter((e) => e.exclusion !== null).map((e) => ({ ref: e.ref, reason: e.exclusion as ExclusionReason }));
  return { prompt, artifacts, excluded, estimatedTokens: running, requiredTokens };
}

/**
 * Materialises a ContextPlan: resolves selectors in plan order, applies exclusions and the budget,
 * renders the prompt from the role template and builds the hashed ContextManifest.
 * Throws ContextBuildError (`OVER_CONTEXT_BUDGET` when the required artifacts alone exceed the budget).
 */
export async function buildContext(plan: ContextPlan, reader: SnapshotReader, policy: AgentPolicyDocument): Promise<BuiltContext> {
  const valid = validatePlan(plan, policy);
  const entries = await resolveEntries(valid, reader);
  const a = assemble(valid, entries, policy);
  const body: Omit<ContextManifest, "manifestSha256"> = {
    schema: "wos-context-manifest.v1",
    contextFormatVersion: CONTEXT_FORMAT_VERSION,
    contractsVersion: CONTRACTS_VERSION,
    policyVersion: valid.policyVersion,
    role: valid.role,
    provider: valid.provider,
    model: { ref: valid.model, modelId: valid.modelId },
    reasoning: valid.reasoning,
    target: valid.target,
    feature: valid.feature,
    task: { id: valid.taskId, kind: taskKindForPlan(valid) },
    abu: valid.abu,
    attemptId: valid.attemptId,
    roundId: valid.roundId,
    source: { repo: valid.source.repo, commit: valid.source.commit },
    promptTemplate: { id: valid.promptTemplateId, sha256: templateSha256(valid.promptTemplateId) },
    artifacts: a.artifacts,
    excluded: a.excluded,
    budget: { limitTokens: valid.budgetTokens, estimatedTokens: a.estimatedTokens },
    outputSchema: valid.outputSchema,
    renderedPromptSha256: sha256Of(a.prompt),
  };
  const manifest: ContextManifest = { ...body, manifestSha256: computeManifestSha256(body) };
  return { manifest, prompt: a.prompt };
}

export interface ContextMeasurement {
  /** Template frame plus every required artifact, in estimated tokens. */
  requiredTokens: number;
  budgetTokens: number;
  overBudget: boolean;
}

/**
 * Required-context estimate for a plan without failing on the budget. The build-graph validator
 * (planning) uses it to emit `OVER_CONTEXT_BUDGET` for ABUs whose builder context cannot fit
 * (CONTEXT-PROTOCOL.md section 5); pair with `builderArtifactSelectors`.
 */
export async function measureContext(plan: ContextPlan, reader: SnapshotReader, policy: AgentPolicyDocument): Promise<ContextMeasurement> {
  const valid = validatePlan(plan, policy);
  const entries = await resolveEntries(valid, reader);
  try {
    const a = assemble(valid, entries, policy);
    return { requiredTokens: a.requiredTokens, budgetTokens: valid.budgetTokens, overBudget: false };
  } catch (e) {
    if (e instanceof ContextBuildError && e.code === "OVER_CONTEXT_BUDGET") {
      return { requiredTokens: e.details.requiredTokens as number, budgetTokens: valid.budgetTokens, overBudget: true };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Server check
// ---------------------------------------------------------------------------------------------

/**
 * Server side: checks a posted manifest against the plan it was issued (CONTEXT-PROTOCOL.md section 7,
 * synchronous part). Failure = `422 MANIFEST_REJECTED`. Git blob oids and server document hashes are
 * confirmed asynchronously by the control plane.
 */
export function checkManifestAgainstPlan(manifest: ContextManifest, plan: ContextPlan): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const parsed = ContextManifest.safeParse(manifest);
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.map((i) => `MANIFEST_SHAPE: ${i.path.join(".")}: ${i.message}`) };
  }
  const m = parsed.data;
  const eq = (field: string, got: unknown, want: unknown) => {
    if (got !== want) reasons.push(`FIELD_MISMATCH: ${field} is ${JSON.stringify(got)}, plan says ${JSON.stringify(want)}`);
  };
  eq("role", m.role, plan.role);
  eq("provider", m.provider, plan.provider);
  eq("model.ref", m.model.ref, plan.model);
  eq("model.modelId", m.model.modelId, plan.modelId);
  eq("reasoning", m.reasoning, plan.reasoning);
  eq("policyVersion", m.policyVersion, plan.policyVersion);
  eq("contextFormatVersion", m.contextFormatVersion, plan.contextFormatVersion);
  eq("target", m.target, plan.target);
  eq("feature", m.feature, plan.feature);
  eq("source.repo", m.source.repo, plan.source.repo);
  eq("source.commit", m.source.commit, plan.source.commit);
  eq("task.id", m.task.id, plan.taskId);
  eq("task.kind", m.task.kind, taskKindForPlan(plan));
  eq("abu", m.abu, plan.abu);
  eq("attemptId", m.attemptId, plan.attemptId);
  eq("roundId", m.roundId, plan.roundId);
  eq("promptTemplate.id", m.promptTemplate.id, plan.promptTemplateId);
  eq("budget.limitTokens", m.budget.limitTokens, plan.budgetTokens);
  eq("outputSchema", m.outputSchema, plan.outputSchema);
  const knownTemplate = TEMPLATE_SOURCES[plan.promptTemplateId];
  if (knownTemplate === undefined) reasons.push(`UNKNOWN_TEMPLATE: ${plan.promptTemplateId}`);
  else eq("promptTemplate.sha256", m.promptTemplate.sha256, sha256Of(knownTemplate));

  const selectors = (plan.artifacts ?? []) as ArtifactSelector[];
  const repoFiles = new Map(selectors.flatMap((s) => (s.kind === "repo_file" ? [[s.path, s] as const] : [])));
  const servers = new Map(selectors.flatMap((s) => (s.kind === "server_document" ? [[s.ref, s] as const] : [])));
  const globs = selectors.flatMap((s) => (s.kind === "repo_glob" ? [s] : []));
  const globMatchers = globs.map((g) => ({ g, match: globMatcher([g.glob]) }));
  const excludedByPlan = globMatcher(plan.excludeGlobs ?? []);

  // Every artifact was selected by the plan, allowed, and appears once.
  const seen = new Set<string>();
  let templateEntries = 0;
  let sum = 0;
  for (const a of m.artifacts) {
    sum += a.estTokens;
    if (a.kind === "prompt_template") {
      templateEntries++;
      if (a.ref !== plan.promptTemplateId) reasons.push(`UNSELECTED_ARTIFACT: template ${a.ref}`);
      continue;
    }
    const key = `${a.kind === "repo_file" ? "repo" : "server"}:${a.ref}`;
    if (seen.has(key)) reasons.push(`DUPLICATE_ARTIFACT: ${a.ref}`);
    seen.add(key);
    if (a.kind === "repo_file") {
      if (!repoFiles.has(a.ref) && !globMatchers.some((x) => x.match(a.ref))) reasons.push(`UNSELECTED_ARTIFACT: ${a.ref}`);
      if (a.gitBlobOid === null) reasons.push(`MISSING_BLOB_OID: ${a.ref}`);
      if (isSecretPath(a.ref)) reasons.push(`SECRET_ARTIFACT: ${a.ref}`);
    } else {
      const s = servers.get(a.ref);
      if (!s) reasons.push(`UNSELECTED_ARTIFACT: ${a.ref}`);
      else if (s.sha256 !== a.sha256) reasons.push(`SERVER_DOCUMENT_MISMATCH: ${a.ref}`);
      if (a.kind !== serverKind(a.ref)) reasons.push(`ARTIFACT_KIND_MISMATCH: ${a.ref} is ${a.kind}`);
    }
    if (excludedByPlan(a.ref)) reasons.push(`EXCLUDED_ARTIFACT_INCLUDED: ${a.ref}`);
    if (isCurrentRoundVerdictRef(a.ref, plan.roundId)) reasons.push(`OTHER_SLOT_CURRENT_ROUND: ${a.ref}`);
  }
  if (templateEntries !== 1) reasons.push(`TEMPLATE_ARTIFACT_COUNT: expected 1, got ${templateEntries}`);

  // Every required selector is represented and nothing required was excluded.
  for (const [path, s] of repoFiles) {
    if (s.required && !seen.has(`repo:${path}`)) reasons.push(`REQUIRED_MISSING: ${path}`);
  }
  for (const [ref, s] of servers) {
    if (s.required && !seen.has(`server:${ref}`)) reasons.push(`REQUIRED_MISSING: ${ref}`);
  }
  for (const x of m.excluded) {
    // A required file or document is never excluded; a required glob's match may only be dropped as content (binary, secret).
    const direct = repoFiles.get(x.ref)?.required === true || servers.get(x.ref)?.required === true;
    const viaGlob =
      (x.reason === "over_budget" || x.reason === "missing_optional") && globMatchers.some((g) => g.g.required && g.match(x.ref));
    if (direct || viaGlob) reasons.push(`REQUIRED_EXCLUDED: ${x.ref} (${x.reason})`);
  }

  if (m.budget.estimatedTokens !== sum)
    reasons.push(`BUDGET_ESTIMATE_MISMATCH: artifacts sum to ${sum}, manifest says ${m.budget.estimatedTokens}`);
  if (m.budget.estimatedTokens > m.budget.limitTokens) {
    reasons.push(`OVER_CONTEXT_BUDGET: ${m.budget.estimatedTokens} > ${m.budget.limitTokens}`);
  }
  if (computeManifestSha256(m) !== m.manifestSha256) reasons.push("MANIFEST_HASH_MISMATCH: manifestSha256 does not recompute");

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
