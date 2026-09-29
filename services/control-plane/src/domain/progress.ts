/**
 * The `progress` consumer (ROADMAP-PROTOCOL.md section 6): builds `ProgressInput` from the records,
 * calls `computeAppProgress` (contracts, pure), appends snapshots when the input changed, and derives
 * app-feature states (the only writer of that column besides ingestion on merge).
 */
import { type AppProgress, computeAppProgress, type ProgressCapabilityInput, type ProgressInput } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { insertEvent } from "../db/events.js";
import { canonicalJson, sha256Of } from "@waronsaas/contracts/canonical";
import { appFeatureTransition } from "./documents.js";

export async function buildProgressInput(
  tx: Tx,
  targetId: string,
): Promise<{ input: ProgressInput; capabilityIds: Map<string, string>; featureIds: Map<string, string> }> {
  const [t] = await tx<{ slug: string }[]>`select slug from wos.targets where id = ${targetId}`;
  const caps = await tx<{ id: string; key: string; weight_bp: number; mapped: boolean; roadmap_version: number }[]>`
    select id, key, weight_bp, mapped, roadmap_version from wos.capabilities where target_id = ${targetId} and not retired order by key`;
  const capabilityIds = new Map(caps.map((c) => [c.key, c.id]));
  const featureIds = new Map<string, string>();
  if (caps.length === 0) return { input: { target: t!.slug, roadmap: null }, capabilityIds, featureIds };
  const [inv] = await tx<{ id: string; version: number; item_count: number; excluded: number }[]>`
    select v.id, v.version, v.item_count,
           (select count(*)::int from wos.inventory_dispositions d where d.inventory_version_id = v.id and d.excluded_reason is not null) as excluded
      from wos.inventory_versions v where v.target_id = ${targetId} and v.state = 'frozen'`;
  const capabilities: ProgressCapabilityInput[] = [];
  for (const c of caps) {
    const feats = c.mapped
      ? await tx<
          { id: string; key: string; catalog_feature_id: string; weight_bp: number; contract_doc: string | null; version: number | null }[]
        >`
          select af.id, f.key, f.id as catalog_feature_id, af.weight_bp, f.current_contract_document_id as contract_doc, d.version
            from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id
            left join wos.documents d on d.id = f.current_contract_document_id
           where af.capability_id = ${c.id} and af.state <> 'descoped' order by f.key`
      : [];
    const features = [];
    for (const f of feats) {
      featureIds.set(f.key, f.id);
      let contract: ProgressCapabilityInput["features"][number]["contract"] = null;
      if (f.contract_doc) {
        const profile = await tx<{ key: string }[]>`
          select r.key from wos.requirement_profiles rp join wos.requirements r on r.id = rp.requirement_id
           where rp.document_id = ${f.contract_doc} and rp.target_id = ${targetId} order by r.key`;
        const abus = await tx<
          { key: string; size_points: 1 | 2 | 3 | 5 | 8; state: string; requirements: string[]; pr_url: string | null }[]
        >`
          select a.key, a.size_points, a.state,
                 coalesce((select array_agg(distinct r.key order by r.key) from wos.abu_requirements ar join wos.requirements r on r.id = ar.requirement_id
                            where ar.abu_id = a.id), '{}') as requirements,
                 (select p.url from wos.pull_requests p join wos.attempts at on at.id = p.attempt_id where at.abu_id = a.id and p.state = 'merged' limit 1) as pr_url
            from wos.abus a where a.catalog_feature_id = ${f.catalog_feature_id} and a.state <> 'superseded' order by a.key`;
        // The latest recorded acceptance run after the last merged relevant ABU concluded success (B-0007-architect).
        const [acc] = await tx<{ passed: boolean }[]>`
          select coalesce((
            select v.conclusion = 'success' from wos.verification_runs v
             where v.subject = 'profile_acceptance' and v.catalog_feature_id = ${f.catalog_feature_id} and v.profile_target_id = ${targetId}
               and v.created_at >= coalesce((select max(p.merged_at) from wos.pull_requests p join wos.attempts at on at.id = p.attempt_id
                                              join wos.abus a on a.id = at.abu_id where a.catalog_feature_id = ${f.catalog_feature_id}), '-infinity')
             order by v.created_at desc, v.id desc limit 1), false) as passed`;
        contract = {
          version: f.version ?? 1,
          profile: profile.map((p) => p.key),
          abus: abus.map((a) => ({
            key: a.key,
            sizePoints: a.size_points,
            requirements: a.requirements,
            merged: a.state === "merged",
            superseded: false,
            prUrl: a.pr_url,
          })),
          profileAcceptancePassed: acc?.passed ?? false,
        };
      }
      features.push({ feature: f.key, capability: c.key, weightBp: f.weight_bp, contract });
    }
    capabilities.push({ capability: c.key, weightBp: c.weight_bp, features });
  }
  return {
    input: {
      target: t!.slug,
      roadmap: {
        version: Math.max(...caps.map((c) => c.roadmap_version)),
        inventoryVersion: inv?.version ?? 1,
        inventoryItems: inv?.item_count ?? 0,
        excludedItems: inv?.excluded ?? 0,
        capabilities,
      },
    },
    capabilityIds,
    featureIds,
  };
}

/** Recomputes one app. Writes nothing when the newest app snapshot has the same input hash. Returns true when written. */
export async function recomputeTarget(tx: Tx, deps: Deps, targetId: string, causeEventId: number | null): Promise<boolean> {
  const { input, capabilityIds, featureIds } = await buildProgressInput(tx, targetId);
  let progress: AppProgress;
  try {
    progress = computeAppProgress(input);
  } catch (err) {
    deps.log("error", "computeAppProgress rejected the input", {
      target: input.target,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  await deriveAppFeatureStates(tx, targetId, input.target, progress);
  const inputSha = sha256Of(canonicalJson(input));
  const [last] = await tx<{ input_sha256: string }[]>`
    select input_sha256 from wos.progress_snapshots where target_id = ${targetId} and scope = 'app' order by id desc limit 1`;
  if (last?.input_sha256 === inputSha) return false;
  const common = {
    roadmap_version: progress.roadmapVersion,
    inventory_version: progress.inventoryVersion,
    input_sha256: inputSha,
    cause_event_id: causeEventId,
  };
  await tx`
    insert into wos.progress_snapshots (target_id, scope, mapped_bp, specified_bp, built_bp, roadmap_version, inventory_version, inventory_items,
                                        excluded_items, input_sha256, detail, cause_event_id)
    values (${targetId}, 'app', ${progress.mappedBp}, ${progress.specifiedBp}, ${progress.builtBp}, ${common.roadmap_version}, ${common.inventory_version},
            ${progress.inventoryItems}, ${progress.excludedItems}, ${inputSha}, ${tx.json(progress as never)}, ${causeEventId})`;
  for (const c of progress.capabilities) {
    const id = capabilityIds.get(c.capability);
    if (!id) continue;
    await tx`
      insert into wos.progress_snapshots (target_id, scope, capability_id, mapped_bp, specified_bp, built_bp, roadmap_version, inventory_version,
                                          input_sha256, cause_event_id)
      values (${targetId}, 'capability', ${id}, ${c.mapped ? 10_000 : 0}, ${c.specifiedBp}, ${c.builtBp}, ${common.roadmap_version},
              ${common.inventory_version}, ${inputSha}, ${causeEventId})`;
  }
  for (const f of progress.features) {
    const id = featureIds.get(f.feature);
    if (!id) continue;
    await tx`
      insert into wos.progress_snapshots (target_id, scope, app_feature_id, mapped_bp, specified_bp, built_bp, roadmap_version, inventory_version,
                                          input_sha256, cause_event_id)
      values (${targetId}, 'feature', ${id}, 10000, ${f.specifiedBp}, ${f.builtBp}, ${common.roadmap_version}, ${common.inventory_version},
              ${inputSha}, ${causeEventId})`;
  }
  await insertEvent(
    tx,
    {
      type: "progress.recomputed",
      v: 1,
      visibility: "public",
      payload: {
        target: input.target,
        mappedBp: progress.mappedBp,
        specifiedBp: progress.specifiedBp,
        builtBp: progress.builtBp,
        roadmapVersion: progress.roadmapVersion,
        inputSha256: inputSha,
      },
    },
    { aggregateKind: "target", aggregateId: targetId, actor: "system", actorAccountId: null },
  );
  return true;
}

/** Moves app features along the system-actor edges of AppFeatureMachine toward what the records say. */
async function deriveAppFeatureStates(tx: Tx, targetId: string, slug: string, progress: AppProgress): Promise<void> {
  const rows = await tx<
    { id: string; state: string; key: string; catalog_feature_id: string; open_contract: boolean; attempted: boolean }[]
  >`
    select af.id, af.state, f.key, f.id as catalog_feature_id,
           exists (select 1 from wos.documents d where d.catalog_feature_id = f.id and d.kind = 'feature_contract' and d.state not in ('merged', 'abandoned')) as open_contract,
           exists (select 1 from wos.attempts at join wos.abus a on a.id = at.abu_id join wos.abu_requirements ar on ar.abu_id = a.id
                     join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id and rp.target_id = ${targetId}
                    where a.catalog_feature_id = f.id and a.state <> 'superseded') as attempted
      from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id
     where af.target_id = ${targetId} and af.state <> 'descoped'`;
  for (const r of rows) {
    const fp = progress.features.find((f) => f.feature === r.key);
    const af = { id: r.id, state: r.state, target_slug: slug, feature_key: r.key };
    const specified = (fp?.specifiedBp ?? 0) === 10_000;
    if (r.state === "mapped" && r.open_contract) await appFeatureTransition(tx, af, "contract_workflow_linked", "system");
    if ((af.state === "specified" || af.state === "building" || af.state === "built") && r.open_contract) {
      // An open version that lists this app in impactedTargets reopens the profile (FEATURE-CONTRACT.md 5.4).
      const [impacted] = await tx<{ x: number }[]>`
        select 1 as x from wos.tasks t join wos.documents d on d.id = t.document_id
         where d.catalog_feature_id = ${r.catalog_feature_id} and d.state not in ('merged', 'abandoned')
           and t.kind = 'feature_author' and t.carry->'impactedTargets' ? ${slug} limit 1`;
      if (impacted) {
        await appFeatureTransition(tx, af, "profile_reopened", "system");
        continue;
      }
    }
    if (af.state === "specified" && fp?.complete) await appFeatureTransition(tx, af, "profile_complete", "system");
    else if (af.state === "specified" && specified && r.attempted)
      await appFeatureTransition(tx, af, "first_relevant_abu_started", "system");
    if (af.state === "building" && fp?.complete) await appFeatureTransition(tx, af, "profile_complete", "system");
  }
}
