/**
 * Canonical document workflows (roadmaps and feature contracts): DocumentMachine persistence, revision
 * validation, round driving and ingestion on merge (ROADMAP-PROTOCOL.md sections 3 and 5,
 * FEATURE-CONTRACT.md section 7).
 */
import {
  type AbuSpec,
  AppFeatureMachine,
  ARTIFACT_PATHS,
  type CatalogEntry,
  type Changeset,
  DocumentMachine,
  type DocumentState,
  type FeatureContract,
  InventoryMachine,
  type Inventory,
  ProposalMachine,
  type RepoManifest,
  RepoManifest as RepoManifestSchema,
  type Roadmap,
  type Surface,
  type BuildGraph,
} from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import { featureBranch, roadmapBranch } from "@waronsaas/github";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { type EventBody, insertEvent } from "../db/events.js";
import { transition } from "../db/transition.js";
import { uuidv7 } from "../util/crypto.js";
import { openRound, subjectAuthors } from "./review.js";
import { caseInsensitiveRepoMap, repoKey } from "./repo-name.js";
import { abuTransition, type ActorRef, createTask, endAttempt, SYSTEM, taskTransition } from "./work.js";
import { loadAttempt } from "../views.js";

export interface DocumentRow {
  id: string;
  kind: "roadmap" | "feature_contract";
  target_id: string | null;
  catalog_feature_id: string | null;
  version: number;
  state: DocumentState;
  round_number: number;
  branch: string;
  pr_number: number | null;
  head_sha: string | null;
  merged_sha: string | null;
  row_version: number;
  target_slug: string | null;
  feature_key: string | null;
  repo: string;
}

export async function loadDocument(tx: Tx, id: string): Promise<DocumentRow | null> {
  const [d] = await tx<DocumentRow[]>`
    select d.*, t.slug as target_slug, f.key as feature_key, d.repo_full_name as repo
      from wos.documents d left join wos.targets t on t.id = d.target_id left join wos.catalog_features f on f.id = d.catalog_feature_id
     where d.id = ${id}`;
  return d ?? null;
}

export async function documentTransition(
  tx: Tx,
  doc: { id: string; state: DocumentState },
  event: (typeof DocumentMachine.transitions)[number]["event"],
  by: ActorRef,
  emit: EventBody | null,
  set?: Record<string, unknown>,
): Promise<void> {
  const t = DocumentMachine.transitions.find((x) => x.from === doc.state && x.event === event);
  if (!t) throw new ApiFailure("CONFLICT", `document is ${doc.state}; ${event} is not possible`);
  await transition(tx, {
    machine: DocumentMachine,
    table: "documents",
    id: doc.id,
    from: doc.state,
    event,
    actor: by.actor,
    actorAccountId: by.accountId,
    set,
    aggregateKind: "document",
    emit: emit ?? {
      type: "document.state_changed",
      v: 1,
      visibility: "public",
      payload: { documentId: doc.id, event, from: doc.state, to: t.to },
    },
  });
}

async function openDocument(
  tx: Tx,
  input:
    | { kind: "roadmap"; targetId: string; slug: string }
    /** `openedFor`: the app whose merged roadmap opened this contract version (document.opened.target). */
    | { kind: "feature_contract"; featureId: string; key: string; openedFor: string },
  by: ActorRef,
  openedBy: string | null,
  carry: unknown,
): Promise<{ documentId: string; taskId: string; version: number }> {
  // ROADMAP-PROTOCOL section 3: version = last MERGED version + 1 (validation expects the same number). An abandoned
  // opening of that version keeps its row and its branch, so a re-opening gets the next free branch name for it.
  const subject =
    input.kind === "roadmap"
      ? tx`kind = 'roadmap' and target_id = ${input.targetId}`
      : tx`kind = 'feature_contract' and catalog_feature_id = ${input.featureId}`;
  const [v] = await tx<
    { n: number }[]
  >`select coalesce(max(version) filter (where state = 'merged'), 0)::int + 1 as n from wos.documents where ${subject}`;
  const version = v!.n;
  const [prior] = await tx<{ n: number }[]>`select count(*)::int as n from wos.documents where ${subject} and version = ${version}`;
  const opening = (prior?.n ?? 0) + 1;
  const id = uuidv7();
  const base = input.kind === "roadmap" ? roadmapBranch(input.slug, version) : featureBranch(input.key, version);
  const branch = opening === 1 ? base : `${base}-${opening}`;
  // repo_full_name: a roadmap lives in its target's repo, a contract in its catalog feature's (migration 0003).
  await tx`
    insert into wos.documents (id, kind, target_id, catalog_feature_id, version, state, branch, opened_by, repo_full_name)
    values (${id}, ${input.kind}, ${input.kind === "roadmap" ? input.targetId : null}, ${input.kind === "roadmap" ? null : input.featureId},
            ${version}, 'drafting', ${branch}, ${openedBy},
            ${
              input.kind === "roadmap"
                ? tx`(select repo_full_name from wos.targets where id = ${input.targetId})`
                : tx`(select repo_full_name from wos.catalog_features where id = ${input.featureId})`
            })`;
  await insertEvent(
    tx,
    {
      type: "document.opened",
      v: 1,
      visibility: "public",
      payload: {
        documentId: id,
        kind: input.kind,
        // contracts 3.1.0: contracts have no target; relevantTo names the apps they serve (integration glue).
        target: input.kind === "roadmap" ? input.slug : null,
        feature: input.kind === "roadmap" ? null : input.key,
        relevantTo: [input.kind === "roadmap" ? input.slug : input.openedFor],
        version,
      },
    },
    { aggregateKind: "document", aggregateId: id, actor: by.actor, actorAccountId: by.accountId },
  );
  const taskId = await createTask(
    tx,
    input.kind === "roadmap"
      ? { kind: "roadmap_author", state: "open", targetId: input.targetId, documentId: id, carry }
      : { kind: "feature_author", state: "open", catalogFeatureId: input.featureId, documentId: id, carry },
    by,
  );
  return { documentId: id, taskId, version };
}

/** Maintainer `openRoadmap`: 409 if an open roadmap exists (documents_one_open_roadmap). */
export async function openRoadmap(tx: Tx, slug: string, reason: string, by: ActorRef): Promise<{ documentId: string; taskId: string }> {
  const [t] = await tx<{ id: string }[]>`select id from wos.targets where slug = ${slug}`;
  if (!t) throw new ApiFailure("NOT_FOUND", `target ${slug} not found`);
  const [open] =
    await tx`select 1 as x from wos.documents where kind = 'roadmap' and target_id = ${t.id} and state not in ('merged', 'abandoned')`;
  if (open) throw new ApiFailure("CONFLICT", `${slug} already has an open roadmap workflow`);
  const r = await openDocument(tx, { kind: "roadmap", targetId: t.id, slug }, by, by.accountId, { reason });
  return { documentId: r.documentId, taskId: r.taskId };
}

// ---------------------------------------------------------------------------------------------- revisions

const decode = (f: Changeset["files"][number]) => (f.op === "upsert" ? Buffer.from(f.contentBase64, "base64").toString("utf8") : null);

/** Reads a file of the revision: the changeset's content when it touches the path, else the repo at `commit`. */
async function revisionFile(deps: Deps, repo: string, commit: string, changeset: Changeset, path: string): Promise<string | null> {
  const f = changeset.files.find((x) => x.path === path);
  if (f) return decode(f);
  const bytes = await deps.github.readFileAt(repo, commit, path);
  return bytes ? Buffer.from(bytes).toString("utf8") : null;
}

/** Paths an author may write for this document (ROADMAP-PROTOCOL.md 2.4, FEATURE-CONTRACT.md "Allowed paths"). */
export async function documentScope(
  deps: Deps,
  doc: DocumentRow,
  changeset: Changeset,
  existingPaths: ReadonlySet<string>,
): Promise<string[]> {
  if (doc.kind === "feature_contract") {
    const k = doc.feature_key!;
    return [ARTIFACT_PATHS.featureContract(k), ARTIFACT_PATHS.buildGraph(k), `${ARTIFACT_PATHS.acceptanceDir(k)}/**`];
  }
  const slug = doc.target_slug!;
  const paths = [`roadmaps/${slug}/**`];
  const roadmapText = changeset.files.find((f) => f.path === ARTIFACT_PATHS.roadmap(slug));
  const text = roadmapText ? decode(roadmapText) : null;
  const parsed = text ? deps.logic.parseRoadmapYaml(text) : null;
  if (parsed?.ok) {
    for (const k of parsed.value.newCatalogFeatures) paths.push(ARTIFACT_PATHS.catalogEntry(k));
  } else if (parsed) {
    // The roadmap does not parse, so newCatalogFeatures is unknown: allow only NEW catalog files and let
    // validation report the schema errors to the author (validation_failed) instead of a scope refusal.
    for (const f of changeset.files) {
      if (/^catalog\/[a-z][a-z0-9-]*\.yaml$/.test(f.path) && !existingPaths.has(f.path)) paths.push(f.path);
    }
  }
  return paths;
}

export async function repoManifestAt(deps: Deps, repo: string, commit: string): Promise<RepoManifest | null> {
  const bytes = await deps.github.readFileAt(repo, commit, ARTIFACT_PATHS.repoManifest);
  if (!bytes) return null;
  try {
    const parsed = RepoManifestSchema.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Deterministic document validation after the App committed the revision (schema + validators). */
export async function validateDocumentRevision(
  tx: Tx,
  deps: Deps,
  doc: DocumentRow,
  changeset: Changeset,
  headSha: string,
): Promise<Array<{ path: string; code: string; message: string }>> {
  const errors: Array<{ path: string; code: string; message: string }> = [];
  const read = (p: string) => revisionFile(deps, doc.repo, headSha, changeset, p);
  if (doc.kind === "roadmap") {
    const slug = doc.target_slug!;
    const [rt, it] = [await read(ARTIFACT_PATHS.roadmap(slug)), await read(ARTIFACT_PATHS.inventory(slug))];
    if (rt === null) errors.push({ path: ARTIFACT_PATHS.roadmap(slug), code: "MISSING_FILE", message: "ROADMAP.yaml is required" });
    if (it === null) errors.push({ path: ARTIFACT_PATHS.inventory(slug), code: "MISSING_FILE", message: "INVENTORY.yaml is required" });
    if (rt === null || it === null) return errors;
    const roadmap = deps.logic.parseRoadmapYaml(rt);
    const inventory = deps.logic.parseInventoryYaml(it);
    if (!roadmap.ok)
      for (const e of roadmap.errors)
        errors.push({ path: `${ARTIFACT_PATHS.roadmap(slug)}:${e.path}`, code: "SCHEMA", message: e.message });
    if (!inventory.ok)
      for (const e of inventory.errors)
        errors.push({ path: `${ARTIFACT_PATHS.inventory(slug)}:${e.path}`, code: "SCHEMA", message: e.message });
    if (!roadmap.ok || !inventory.ok) return errors;
    const catalog = new Map<string, CatalogEntry>();
    const rows = await tx<{ key: string; title: string; summary: string; alias_key: string | null }[]>`
      select f.key, f.title, f.summary, a.key as alias_key from wos.catalog_features f left join wos.catalog_features a on a.id = f.alias_of
       where f.repo_full_name = ${doc.repo}`;
    for (const r of rows)
      catalog.set(r.key, { schema: "wos-catalog-entry.v1", key: r.key, title: r.title, summary: r.summary, aliasOf: r.alias_key });
    for (const k of roadmap.value.newCatalogFeatures) {
      const text = await read(ARTIFACT_PATHS.catalogEntry(k));
      if (text === null) {
        errors.push({
          path: ARTIFACT_PATHS.catalogEntry(k),
          code: "MISSING_FILE",
          message: `new catalog feature ${k} needs its catalog file`,
        });
        continue;
      }
      const entry = deps.logic.parseCatalogEntryYaml(text);
      if (entry.ok) catalog.set(k, entry.value);
      else
        for (const e of entry.errors)
          errors.push({ path: `${ARTIFACT_PATHS.catalogEntry(k)}:${e.path}`, code: "SCHEMA", message: e.message });
    }
    const [prev] = await tx<{ v: number | null }[]>`
      select max(version)::int as v from wos.documents where kind = 'roadmap' and target_id = ${doc.target_id} and state = 'merged'`;
    for (const e of deps.logic.validateRoadmap(roadmap.value, inventory.value, catalog, prev?.v ?? null)) {
      errors.push({ path: ARTIFACT_PATHS.roadmap(slug), code: e.code, message: e.message });
    }
    // First-run fix B2: an in-scope surface names a registered repository (any case; stored lowercase). Unknown ones would
    // only fail at materialisation, after the merge, where nothing can fix them.
    const registered = new Set(
      (await tx<{ repo_full_name: string }[]>`select repo_full_name from wos.repositories`).map((r) => r.repo_full_name),
    );
    for (const sf of roadmap.value.surfaces) {
      if (sf.status === "in_scope" && sf.repo && !registered.has(repoKey(sf.repo)))
        errors.push({
          path: `${ARTIFACT_PATHS.roadmap(slug)}:surfaces.${sf.surface}.repo`,
          code: "SURFACE_REPO_UNKNOWN",
          message: `surface ${sf.surface} names repository ${sf.repo}, which is not a registered warOnSaaS repository (${[...registered].sort().join(", ")})`,
        });
    }
    return errors;
  }
  const key = doc.feature_key!;
  const [ct, gt] = [await read(ARTIFACT_PATHS.featureContract(key)), await read(ARTIFACT_PATHS.buildGraph(key))];
  if (ct === null) errors.push({ path: ARTIFACT_PATHS.featureContract(key), code: "MISSING_FILE", message: "CONTRACT.yaml is required" });
  if (gt === null) errors.push({ path: ARTIFACT_PATHS.buildGraph(key), code: "MISSING_FILE", message: "BUILD-GRAPH.yaml is required" });
  if (ct === null || gt === null) return errors;
  const contract = deps.logic.parseFeatureContractYaml(ct);
  const graph = deps.logic.parseBuildGraphYaml(gt);
  if (!contract.ok)
    for (const e of contract.errors)
      errors.push({ path: `${ARTIFACT_PATHS.featureContract(key)}:${e.path}`, code: "SCHEMA", message: e.message });
  if (!graph.ok)
    for (const e of graph.errors) errors.push({ path: `${ARTIFACT_PATHS.buildGraph(key)}:${e.path}`, code: "SCHEMA", message: e.message });
  if (!contract.ok || !graph.ok) return errors;
  const manifest = await repoManifestAt(deps, doc.repo, headSha);
  if (!manifest) return [{ path: ARTIFACT_PATHS.repoManifest, code: "MISSING_FILE", message: "wos.json missing or invalid at the head" }];
  const estimate = (abuKey: string) => {
    const a = graph.value.abus.find((x) => x.key === abuKey);
    return a ? Math.ceil((ct.length + JSON.stringify(a).length) / deps.policy.tokenEstimator.charsPerToken) : 0;
  };
  // contracts 4.2.0 (B-0002-planning), integration glue: contract-level rules against the latest merged version.
  const [prevDoc] = await tx<{ merged_sha: string }[]>`
    select merged_sha from wos.documents where kind = 'feature_contract' and catalog_feature_id = ${doc.catalog_feature_id}
       and state = 'merged' order by version desc limit 1`;
  const prevText = prevDoc ? await deps.github.readFileAt(doc.repo, prevDoc.merged_sha, ARTIFACT_PATHS.featureContract(key)) : null;
  const prevParsed = prevText ? deps.logic.parseFeatureContractYaml(new TextDecoder().decode(prevText)) : null;
  for (const i of deps.logic.validateFeatureContract(contract.value, prevParsed?.ok ? prevParsed.value : null)) {
    errors.push({ path: ARTIFACT_PATHS.featureContract(key), code: i.code, message: i.message });
  }
  // Context (FEATURE-CONTRACT.md section 9): the repository registry, the contract's repo, and each profile app's surfaces in scope.
  const repos = await tx<{ repo_full_name: string; family: "platform" | "product" }[]>`select repo_full_name, family from wos.repositories`;
  const surfaceRows = await tx<{ slug: string; surface: Surface }[]>`
    select t.slug, s.surface from wos.app_feature_surfaces s join wos.app_features af on af.id = s.app_feature_id
      join wos.targets t on t.id = af.target_id
     where af.catalog_feature_id = ${doc.catalog_feature_id} and af.state <> 'descoped'
       and t.slug in ${tx(contract.value.profiles.map((p) => p.target).concat(["-"]))}
     order by t.slug, s.surface`;
  const surfacesInScope = new Map<string, Surface[]>();
  for (const r of surfaceRows) surfacesInScope.set(r.slug, [...(surfacesInScope.get(r.slug) ?? []), r.surface]);
  const context = {
    repositories: caseInsensitiveRepoMap(repos.map((r) => [r.repo_full_name, r.family] as const)),
    contractRepo: doc.repo,
    surfacesInScope,
  };
  for (const i of deps.logic.validateBuildGraph(graph.value, contract.value, manifest, estimate, deps.policy, context)) {
    errors.push({ path: `${ARTIFACT_PATHS.buildGraph(key)}${i.abu ? `:${i.abu}` : ""}`, code: i.code, message: i.message });
  }
  return errors;
}

/**
 * Records a committed revision: `revision_submitted`, then `validation_passed` (new round on the head)
 * or `validation_failed` (a new author task carrying the errors). All in the caller's transaction.
 */
export async function afterDocumentRevision(
  tx: Tx,
  _deps: Deps,
  doc: DocumentRow,
  input: {
    taskId: string;
    headSha: string;
    submissionSha256: string;
    errors: Array<{ path: string; code: string; message: string }>;
    by: ActorRef;
  },
): Promise<void> {
  await documentTransition(
    tx,
    doc,
    "revision_submitted",
    input.by,
    {
      type: "document.revision_submitted",
      v: 1,
      visibility: "public",
      payload: { documentId: doc.id, taskId: input.taskId, headSha: input.headSha },
    },
    { head_sha: input.headSha },
  );
  const validating = { id: doc.id, state: "validating" as const };
  if (input.errors.length > 0) {
    await documentTransition(tx, validating, "validation_failed", SYSTEM, {
      type: "document.validation_failed",
      v: 1,
      visibility: "public",
      payload: { documentId: doc.id, headSha: input.headSha, errorCount: input.errors.length },
    });
    await createAuthorTask(tx, doc, { validatorErrors: input.errors });
    return;
  }
  const authors = await subjectAuthors(tx, { attempt_id: null, document_id: doc.id });
  const round = await openRound(
    tx,
    doc.kind === "roadmap"
      ? { kind: "roadmap", documentId: doc.id, targetId: doc.target_id! }
      : { kind: "feature_contract", documentId: doc.id, catalogFeatureId: doc.catalog_feature_id! },
    input.headSha,
    input.submissionSha256,
    authors,
    SYSTEM,
  );
  await documentTransition(
    tx,
    validating,
    "validation_passed",
    SYSTEM,
    {
      type: "document.round_opened",
      v: 1,
      visibility: "public",
      payload: { documentId: doc.id, roundId: round.roundId, roundNumber: round.roundNumber, headSha: input.headSha },
    },
    { round_number: round.roundNumber },
  );
}

async function createAuthorTask(tx: Tx, doc: DocumentRow, carry: unknown): Promise<string> {
  return createTask(
    tx,
    doc.kind === "roadmap"
      ? { kind: "roadmap_author", state: "open", targetId: doc.target_id, documentId: doc.id, carry }
      : { kind: "feature_author", state: "open", catalogFeatureId: doc.catalog_feature_id, documentId: doc.id, carry },
    SYSTEM,
  );
}

/** Drives the document after its round was revealed (DOMAIN-MODEL.md 4.3). */
export async function documentAfterReveal(
  tx: Tx,
  deps: Deps,
  documentId: string,
  round: { id: string; round_number: number; head_sha: string; second_seat?: "fable" | "human" },
  outcome: "consensus" | "gaps",
  reviewerIds: string[],
): Promise<void> {
  const doc = await loadDocument(tx, documentId);
  if (doc?.state !== "in_review") return;
  if (outcome === "consensus") {
    await documentTransition(tx, doc, "round_consensus", SYSTEM, {
      type: "document.consensus_reached",
      v: 1,
      visibility: "public",
      payload: { documentId, roundId: round.id, headSha: round.head_sha },
    });
    return;
  }
  const max = doc.kind === "roadmap" ? deps.policy.limits.roadmapMaxRounds : deps.policy.limits.featureContractMaxRounds;
  const [disputed] = await tx<{ n: number }[]>`
    select count(*)::int as n from wos.findings where document_id = ${documentId} and state in ('open', 'disputed')
       and dispute_rounds >= ${deps.policy.limits.disputeEscalationRounds}`;
  if (round.round_number >= max || (disputed?.n ?? 0) > 0) {
    await documentTransition(tx, doc, "round_limit_reached", SYSTEM, {
      type: "document.escalated",
      v: 1,
      visibility: "public",
      payload: { documentId, roundId: round.id },
    });
    // D53 / D58: under the fable_unavailable fallback every conflict goes to the human, never to a (Fable) resolver
    // task. A maintainer who is neither an author nor a reviewer of the subject rules with submitHumanRuling.
    if (round.second_seat === "human") return;
    const authors = await subjectAuthors(tx, { attempt_id: null, document_id: documentId });
    await createTask(
      tx,
      {
        kind: "conflict_resolution",
        state: "open",
        documentId,
        targetId: doc.target_id,
        catalogFeatureId: doc.catalog_feature_id,
        excludedAccountIds: [...new Set([...authors, ...reviewerIds])],
      },
      SYSTEM,
    );
    return;
  }
  await documentTransition(tx, doc, "round_gaps", SYSTEM, null);
  await createAuthorTask(tx, doc, { round: round.round_number });
}

// ---------------------------------------------------------------------------------------------- ingestion on merge

async function appFeatureTransition(
  tx: Tx,
  af: { id: string; state: string; target_slug: string; feature_key: string },
  event: (typeof AppFeatureMachine.transitions)[number]["event"],
  actor: "system" | "github",
): Promise<boolean> {
  const t = AppFeatureMachine.transitions.find((x) => x.from === af.state && x.event === event);
  if (!t) return false;
  await transition(tx, {
    machine: AppFeatureMachine,
    table: "app_features",
    id: af.id,
    from: af.state as never,
    event,
    actor,
    actorAccountId: null,
    aggregateKind: "app_feature",
    emit: {
      type: "app_feature.state_changed",
      v: 1,
      visibility: "public",
      payload: { target: af.target_slug, feature: af.feature_key, from: af.state, to: t.to },
    },
  });
  af.state = t.to;
  return true;
}
export { appFeatureTransition };

export interface MergedRoadmapFiles {
  roadmap: Roadmap;
  inventory: Inventory;
  catalog: Map<string, CatalogEntry>;
}

export async function readMergedRoadmap(deps: Deps, doc: DocumentRow, mergeSha: string): Promise<MergedRoadmapFiles> {
  const slug = doc.target_slug!;
  const text = async (p: string) => {
    const b = await deps.github.readFileAt(doc.repo, mergeSha, p);
    if (!b) throw new Error(`${p} missing at ${mergeSha}`);
    return Buffer.from(b).toString("utf8");
  };
  const roadmap = deps.logic.parseRoadmapYaml(await text(ARTIFACT_PATHS.roadmap(slug)));
  const inventory = deps.logic.parseInventoryYaml(await text(ARTIFACT_PATHS.inventory(slug)));
  if (!roadmap.ok || !inventory.ok) throw new Error("merged roadmap does not parse");
  const catalog = new Map<string, CatalogEntry>();
  for (const k of roadmap.value.newCatalogFeatures) {
    const e = deps.logic.parseCatalogEntryYaml(await text(ARTIFACT_PATHS.catalogEntry(k)));
    if (!e.ok) throw new Error(`catalog/${k}.yaml does not parse`);
    catalog.set(k, e.value);
  }
  return { roadmap: roadmap.value, inventory: inventory.value, catalog };
}

/** ROADMAP-PROTOCOL.md section 5, in the webhook's transaction. Idempotent: the consensus guard fails on replay. */
export async function materialiseRoadmap(
  tx: Tx,
  _deps: Deps,
  doc: DocumentRow,
  merge: { sha: string; prNumber: number },
  files: MergedRoadmapFiles,
): Promise<void> {
  const GH: ActorRef = { actor: "github", accountId: null };
  const { roadmap, inventory } = files;
  await documentTransition(
    tx,
    doc,
    "pr_merged",
    GH,
    {
      type: "document.merged",
      v: 1,
      visibility: "public",
      payload: { documentId: doc.id, kind: "roadmap", mergeSha: merge.sha, prNumber: merge.prNumber },
    },
    { merged_sha: merge.sha, merged_at: new Date() },
  );
  const targetId = doc.target_id!;
  const slug = doc.target_slug!;
  await tx`update wos.targets set product_name = ${roadmap.productName}, row_version = row_version + 1 where id = ${targetId}`;

  // 1. inventory version: proposed -> frozen, the previous frozen -> superseded.
  let [inv] = await tx<{ id: string; state: string }[]>`
    select id, state from wos.inventory_versions where target_id = ${targetId} and version = ${inventory.version}`;
  if (!inv) {
    const id = uuidv7();
    await tx`insert into wos.inventory_versions (id, target_id, version, state, document_id, head_sha, item_count)
             values (${id}, ${targetId}, ${inventory.version}, 'proposed', ${doc.id}, ${merge.sha}, ${inventory.items.length})`;
    for (const item of inventory.items) {
      await tx`insert into wos.inventory_items (id, inventory_version_id, key, area, title, source_url)
               values (${uuidv7()}, ${id}, ${item.key}, ${item.area}, ${item.title}, ${inventory.sources[item.source]?.url ?? ""})`;
    }
    inv = { id, state: "proposed" };
  }
  if (inv.state === "proposed") {
    // inventory_versions has no row_version: the guard is the state itself (InventoryMachine).
    const old = await tx<{ id: string }[]>`
      update wos.inventory_versions set state = 'superseded' where target_id = ${targetId} and state = 'frozen' returning id`;
    for (const o of old) await inventoryEvent(tx, o.id, "frozen", "superseded");
    const frozen =
      await tx`update wos.inventory_versions set state = 'frozen', frozen_at = now() where id = ${inv.id} and state = 'proposed' returning id`;
    if (frozen.length === 0) throw new ApiFailure("CONFLICT", "inventory version changed concurrently");
    await inventoryEvent(tx, inv.id, "proposed", "frozen");
  }

  // 2. capabilities
  const capIds = new Map<string, string>();
  for (const [i, c] of roadmap.capabilities.entries()) {
    const [row] = await tx<{ id: string }[]>`
      insert into wos.capabilities (id, target_id, key, title, summary, position, weight_bp, weight_rationale, mapped, roadmap_version, retired)
      values (${uuidv7()}, ${targetId}, ${c.key}, ${c.title}, ${c.summary}, ${i}, ${c.weightBp}, ${c.weightRationale}, ${c.features.length > 0},
              ${roadmap.version}, false)
      on conflict (target_id, key) do update set title = excluded.title, summary = excluded.summary, position = excluded.position,
        weight_bp = excluded.weight_bp, weight_rationale = excluded.weight_rationale, mapped = excluded.mapped,
        roadmap_version = excluded.roadmap_version, retired = false
      returning id`;
    capIds.set(c.key, row!.id);
  }
  await tx`update wos.capabilities set retired = true where target_id = ${targetId} and key not in ${tx(roadmap.capabilities.map((c) => c.key))}`;

  // D13: the app's surfaces (in scope with repo and app shell path, or excluded with a reason).
  await tx`delete from wos.target_surfaces where target_id = ${targetId}`;
  for (const sf of roadmap.surfaces) {
    await tx`insert into wos.target_surfaces (target_id, surface, status, reason, repo_full_name, path, roadmap_version)
             values (${targetId}, ${sf.surface}, ${sf.status}, ${sf.status === "excluded" ? sf.reason : null},
                     ${sf.status === "in_scope" ? repoKey(sf.repo!) : null}, ${sf.status === "in_scope" ? sf.path : null}, ${roadmap.version})`;
  }

  // 3. new catalog features
  for (const k of roadmap.newCatalogFeatures) {
    const entry = files.catalog.get(k)!;
    const created = await tx`
      insert into wos.catalog_features (id, key, title, summary, state, created_by_document_id, repo_full_name)
      values (${uuidv7()}, ${k}, ${entry.title}, ${entry.summary}, 'active', ${doc.id}, ${doc.repo}) on conflict (key) do nothing returning id`;
    if (created.length > 0) {
      await insertEvent(
        tx,
        { type: "catalog.feature_added", v: 1, visibility: "public", payload: { feature: k, proposedBy: slug } },
        { aggregateKind: "catalog_feature", aggregateId: k, actor: "github", actorAccountId: null },
      );
    }
  }

  // 4-5. app features: upsert referenced, descope the rest.
  const referenced = new Map<string, { capability: string; ref: Roadmap["capabilities"][number]["features"][number] }>();
  for (const c of roadmap.capabilities) for (const f of c.features) referenced.set(f.feature, { capability: c.key, ref: f });
  const featureIds = new Map<string, string>();
  for (const [key, { capability, ref }] of referenced) {
    const [f] = await tx<{ id: string }[]>`select id from wos.catalog_features where key = ${key} and repo_full_name = ${doc.repo}`;
    if (!f) throw new Error(`roadmap references unknown catalog feature ${key} in ${doc.repo}`);
    featureIds.set(key, f.id);
    const [afRow] = await tx<{ id: string }[]>`
      insert into wos.app_features (id, target_id, catalog_feature_id, capability_id, state, weight_bp, weight_rationale, app_notes, phase,
                                    first_roadmap_version, roadmap_version)
      values (${uuidv7()}, ${targetId}, ${f.id}, ${capIds.get(capability)!}, 'mapped', ${ref.weightBp}, ${ref.weightRationale}, ${ref.appNotes},
              ${ref.phase}, ${roadmap.version}, ${roadmap.version})
      on conflict (target_id, catalog_feature_id) do update set capability_id = excluded.capability_id, weight_bp = excluded.weight_bp,
        weight_rationale = excluded.weight_rationale, app_notes = excluded.app_notes, phase = excluded.phase,
        roadmap_version = excluded.roadmap_version, row_version = wos.app_features.row_version + 1
      returning id`;
    // D13: the feature's reasoned surface weights and its key journeys, frozen with this roadmap version.
    await tx`update wos.app_features set journeys = ${tx.json(ref.journeys as never)} where id = ${afRow!.id}`;
    await tx`delete from wos.app_feature_surfaces where app_feature_id = ${afRow!.id}`;
    for (const sw of ref.surfaces) {
      await tx`insert into wos.app_feature_surfaces (app_feature_id, surface, weight_bp, weight_rationale, roadmap_version)
               values (${afRow!.id}, ${sw.surface}, ${sw.weightBp}, ${sw.weightRationale}, ${roadmap.version})`;
    }
    await insertEvent(
      tx,
      {
        type: "app_feature.tracked",
        v: 1,
        visibility: "public",
        payload: { target: slug, feature: key, capability, roadmapVersion: roadmap.version, weightBp: ref.weightBp },
      },
      { aggregateKind: "app_feature", aggregateId: `${slug}/${key}`, actor: "github", actorAccountId: null },
    );
  }
  const stale = await tx<{ id: string; state: string; feature_key: string }[]>`
    select af.id, af.state, f.key as feature_key from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id
     where af.target_id = ${targetId} and af.state <> 'descoped'`;
  for (const s of stale) {
    if (!referenced.has(s.feature_key)) await appFeatureTransition(tx, { ...s, target_slug: slug }, "descoped", "github");
  }

  // 6. dispositions for the frozen inventory
  const items = await tx<{ id: string; key: string }[]>`select id, key from wos.inventory_items where inventory_version_id = ${inv.id}`;
  for (const item of items) {
    const excluded = roadmap.excluded.find((e) => e.item === item.key);
    const cap = roadmap.capabilities.find((c) => c.inventoryItems.includes(item.key));
    const feat = cap?.features.find((f) => f.inventoryItems.includes(item.key));
    const [af] = feat
      ? await tx<
          { id: string }[]
        >`select id from wos.app_features where target_id = ${targetId} and catalog_feature_id = ${featureIds.get(feat.feature)!}`
      : [];
    await tx`
      insert into wos.inventory_dispositions (inventory_version_id, inventory_item_id, capability_id, app_feature_id, excluded_reason, roadmap_version)
      values (${inv.id}, ${item.id}, ${cap ? capIds.get(cap.key)! : null}, ${af?.id ?? null}, ${cap ? null : (excluded?.reason ?? "not placed")},
              ${roadmap.version})
      on conflict (inventory_version_id, inventory_item_id) do update set capability_id = excluded.capability_id,
        app_feature_id = excluded.app_feature_id, excluded_reason = excluded.excluded_reason, roadmap_version = excluded.roadmap_version`;
  }

  // 7. open or link the Feature Contract workflow of every referenced feature (D11).
  for (const [key, featureId] of featureIds) {
    const [af] = await tx<{ id: string; state: string }[]>`
      select id, state from wos.app_features where target_id = ${targetId} and catalog_feature_id = ${featureId}`;
    if (af?.state !== "mapped") continue;
    const ref = { ...af, target_slug: slug, feature_key: key };
    const [openDoc] = await tx<{ id: string }[]>`
      select id from wos.documents where kind = 'feature_contract' and catalog_feature_id = ${featureId} and state not in ('merged', 'abandoned')`;
    if (openDoc) {
      await tx`update wos.tasks set carry = coalesce(carry, '{}'::jsonb) || jsonb_build_object('addProfilesFor',
                 coalesce(carry->'addProfilesFor', '[]'::jsonb) || to_jsonb(${slug}::text)), row_version = row_version + 1
                where document_id = ${openDoc.id} and kind = 'feature_author' and state in ('open', 'leased')`;
      await appFeatureTransition(tx, ref, "contract_workflow_linked", "system");
      continue;
    }
    const [merged] = await tx<
      { id: string }[]
    >`select current_contract_document_id as id from wos.catalog_features where id = ${featureId}`;
    if (merged?.id) {
      const [has] =
        await tx`select 1 as x from wos.requirement_profiles where document_id = ${merged.id} and target_id = ${targetId} limit 1`;
      if (has) {
        await appFeatureTransition(tx, ref, "profile_merged", "github");
        continue;
      }
    }
    await openDocument(tx, { kind: "feature_contract", featureId, key, openedFor: slug }, SYSTEM, null, {
      addProfilesFor: [slug],
      impactedTargets: merged?.id ? [slug] : [],
    });
    await appFeatureTransition(tx, ref, "contract_workflow_linked", "system");
  }

  // Proposals incorporated by this version.
  for (const pid of roadmap.proposals) {
    const [p] = await tx<{ id: string; state: string }[]>`select id, state from wos.proposals where id = ${pid}`;
    if (p?.state === "accepted") {
      await transition(tx, {
        machine: ProposalMachine,
        table: "proposals",
        id: p.id,
        from: "accepted",
        event: "incorporate",
        actor: "github",
        actorAccountId: null,
        aggregateKind: "proposal",
        emit: {
          type: "proposal.state_changed",
          v: 1,
          visibility: "public",
          payload: { proposalId: p.id, from: "accepted", to: "incorporated" },
        },
      });
    }
  }
}

export interface MergedContractFiles {
  contract: FeatureContract;
  graph: BuildGraph;
  contractText: string;
}

export async function readMergedContract(deps: Deps, doc: DocumentRow, mergeSha: string): Promise<MergedContractFiles> {
  const key = doc.feature_key!;
  const text = async (p: string) => {
    const b = await deps.github.readFileAt(doc.repo, mergeSha, p);
    if (!b) throw new Error(`${p} missing at ${mergeSha}`);
    return Buffer.from(b).toString("utf8");
  };
  const contractText = await text(ARTIFACT_PATHS.featureContract(key));
  const contract = deps.logic.parseFeatureContractYaml(contractText);
  const graph = deps.logic.parseBuildGraphYaml(await text(ARTIFACT_PATHS.buildGraph(key)));
  if (!contract.ok || !graph.ok) throw new Error("merged contract does not parse");
  return { contract: contract.value, graph: graph.value, contractText };
}

const sameSpec = (a: AbuSpec, b: AbuSpec) => JSON.stringify(a) === JSON.stringify(b);

/** FEATURE-CONTRACT.md section 7: requirements, profiles, ABUs, build tasks, app features -> specified. */
export async function ingestContract(
  tx: Tx,
  deps: Deps,
  doc: DocumentRow,
  merge: { sha: string; prNumber: number },
  files: MergedContractFiles,
): Promise<void> {
  const GH: ActorRef = { actor: "github", accountId: null };
  const featureId = doc.catalog_feature_id!;
  await documentTransition(
    tx,
    doc,
    "pr_merged",
    GH,
    {
      type: "document.merged",
      v: 1,
      visibility: "public",
      payload: { documentId: doc.id, kind: "feature_contract", mergeSha: merge.sha, prNumber: merge.prNumber },
    },
    { merged_sha: merge.sha, merged_at: new Date() },
  );
  await tx`update wos.catalog_features set current_contract_document_id = ${doc.id}, row_version = row_version + 1 where id = ${featureId}`;
  const reqIds = new Map<string, string>();
  for (const r of files.contract.requirements) {
    const id = uuidv7();
    await tx`insert into wos.requirements (id, document_id, catalog_feature_id, key, kind, statement)
             values (${id}, ${doc.id}, ${featureId}, ${r.key}, ${r.kind}, ${r.statement})`;
    reqIds.set(r.key, id);
    for (const sf of r.surfaces) await tx`insert into wos.requirement_surfaces (requirement_id, surface) values (${id}, ${sf})`;
  }
  const profileTargets: string[] = [];
  for (const p of files.contract.profiles) {
    const [t] = await tx<{ id: string }[]>`select id from wos.targets where slug = ${p.target}`;
    if (!t) continue;
    profileTargets.push(t.id);
    for (const k of p.requirements) {
      const rid = reqIds.get(k);
      if (rid) await tx`insert into wos.requirement_profiles (document_id, target_id, requirement_id) values (${doc.id}, ${t.id}, ${rid})`;
    }
  }
  // ABUs: carried over unchanged keep their rows; changed or removed ones are superseded; new ones created.
  const existing = await tx<{ id: string; key: string; state: string; spec: AbuSpec }[]>`
    select id, key, state, spec from wos.abus where catalog_feature_id = ${featureId} and state <> 'superseded'`;
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const abuIds = new Map<string, string>();
  const fresh: AbuSpec[] = [];
  for (const spec of files.graph.abus) {
    const old = byKey.get(spec.key);
    if (old && sameSpec(old.spec, spec)) {
      abuIds.set(spec.key, old.id);
      byKey.delete(spec.key);
      for (const k of spec.requirements) {
        const rid = reqIds.get(k);
        if (rid) await tx`insert into wos.abu_requirements (abu_id, requirement_id) values (${old.id}, ${rid}) on conflict do nothing`;
      }
    } else fresh.push(spec);
  }
  for (const gone of byKey.values()) {
    if (gone.state === "in_progress") {
      const [live] = await tx<{ id: string }[]>`
        select id from wos.attempts where abu_id = ${gone.id} and state not in ('merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded')`;
      const attempt = live ? await loadAttempt(tx, live.id) : null;
      if (attempt) await endAttempt(tx, deps, attempt, "supersede", SYSTEM, `ABU superseded by contract v${doc.version}`);
    }
    if (gone.state !== "merged" && gone.state !== "needs_decomposition") {
      await abuTransition(tx, gone, "supersede", SYSTEM);
      const tasks = await tx<{ id: string; state: "open" | "blocked" }[]>`
        select id, state from wos.tasks where abu_id = ${gone.id} and kind = 'abu_build' and state in ('open', 'blocked')`;
      for (const t of tasks) await taskTransition(tx, t, "cancel", SYSTEM);
    }
  }
  for (const spec of fresh) {
    const id = uuidv7();
    abuIds.set(spec.key, id);
    const est = Math.max(
      1,
      Math.ceil((files.contractText.length + JSON.stringify(spec).length) / deps.policy.tokenEstimator.charsPerToken),
    );
    await tx`insert into wos.abus (id, catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens, repo_full_name)
             values (${id}, ${featureId}, ${doc.id}, ${spec.key}, ${spec.title}, ${spec.sizePoints}, 'pending_dependencies',
                     ${tx.json(spec as never)}, ${est}, ${doc.repo})`;
    for (const k of spec.requirements) {
      const rid = reqIds.get(k);
      if (rid) await tx`insert into wos.abu_requirements (abu_id, requirement_id) values (${id}, ${rid})`;
    }
    await insertEvent(
      tx,
      { type: "abu.created", v: 1, visibility: "public", payload: { abuId: id, abu: spec.key, feature: files.contract.feature } },
      { aggregateKind: "abu", aggregateId: id, actor: "github", actorAccountId: null },
    );
  }
  for (const spec of fresh) {
    const id = abuIds.get(spec.key)!;
    for (const dep of spec.dependsOn) {
      const depId = abuIds.get(dep);
      if (depId) await tx`insert into wos.abu_dependencies (abu_id, depends_on_abu_id) values (${id}, ${depId})`;
    }
  }
  for (const spec of fresh) {
    const id = abuIds.get(spec.key)!;
    const [pending] = await tx<{ n: number }[]>`
      select count(*)::int as n from wos.abu_dependencies e join wos.abus d on d.id = e.depends_on_abu_id
       where e.abu_id = ${id} and d.state <> 'merged'`;
    const ready = (pending?.n ?? 0) === 0;
    if (ready) await abuTransition(tx, { id, key: spec.key, state: "pending_dependencies" }, "dependencies_merged", SYSTEM);
    await createTask(tx, { kind: "abu_build", state: ready ? "open" : "blocked", abuId: id, catalogFeatureId: featureId }, SYSTEM);
  }
  // App features of every profile app -> specified.
  const afs = await tx<{ id: string; state: string; target_slug: string; feature_key: string }[]>`
    select af.id, af.state, t.slug as target_slug, f.key as feature_key
      from wos.app_features af join wos.targets t on t.id = af.target_id join wos.catalog_features f on f.id = af.catalog_feature_id
     where af.catalog_feature_id = ${featureId} and af.target_id in ${tx(profileTargets.length ? profileTargets : ["00000000-0000-0000-0000-000000000000"])}`;
  for (const af of afs) {
    if (af.state === "mapped" || af.state === "specifying") await appFeatureTransition(tx, af, "profile_merged", "github");
  }
}

async function inventoryEvent(tx: Tx, id: string, from: string, to: string): Promise<void> {
  const t = InventoryMachine.transitions.find((x) => x.from === from && x.to === to);
  if (!t) throw new Error(`inventory ${from} -> ${to} is not a transition`);
  await insertEvent(
    tx,
    { type: "inventory_version.state_changed", v: 1, visibility: "public", payload: { id, event: t.event, from, to } },
    { aggregateKind: "inventory_version", aggregateId: id, actor: "github", actorAccountId: null },
  );
}
