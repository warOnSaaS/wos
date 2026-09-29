/**
 * Public read routes (the website's data). Honest numbers only: every percentage comes from the latest
 * `computeAppProgress` snapshot, zeros when none exists. Run as the anonymous actor, so RLS hides every
 * private row (sealed reviews, emails, leases).
 */
import {
  type AbuSummary,
  type AppFeatureDetail,
  type AppProgress,
  type CatalogFeatureDetail,
  CONTRACTS_VERSION,
  DomainEvent,
  type Progress,
  type RouteResponse,
  type TargetSummary,
  TOKEN_DISCLAIMER,
  ZERO_PROGRESS,
} from "@waronsaas/contracts";
import { inTransaction, type Tx } from "@waronsaas/db";
import { ApiFailure } from "../errors.js";
import type { Handlers } from "../http/router.js";
import { eventWire } from "./account.js";
import { attemptView, iso, isoReq, loadAttempt, num } from "../views.js";

const ANON = { kind: "anonymous", accountId: null } as const;
const PAGE = 50;

const cursorOf = (c: string | undefined): number | null => {
  if (!c) return null;
  const n = Number.parseInt(c, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

interface TargetRow {
  id: string;
  slug: string;
  name: string;
  rank: number;
  what_it_is: string;
  repo_full_name: string;
  product_path: string;
  product_name: string | null;
  hosted_url: string | null;
  self_hostable: boolean;
}

export async function documentSummary(tx: Tx, where: { targetId?: string; featureId?: string }) {
  const rows = where.targetId
    ? await tx<DocRow[]>`${docSelect(tx)} where d.kind = 'roadmap' and d.target_id = ${where.targetId}
                          order by (d.state not in ('merged', 'abandoned')) desc, d.version desc limit 1`
    : await tx<DocRow[]>`${docSelect(tx)} where d.kind = 'feature_contract' and d.catalog_feature_id = ${where.featureId!}
                          order by (d.state not in ('merged', 'abandoned')) desc, d.version desc limit 1`;
  const d = rows[0];
  return d ? docView(d) : null;
}

interface DocRow {
  id: string;
  kind: "roadmap" | "feature_contract";
  version: number;
  state: "drafting";
  round_number: number;
  pr_url: string | null;
  head_sha: string | null;
  updated_at: Date;
}
const docSelect = (tx: Tx) => tx`
  select d.id, d.kind, d.version, d.state, d.round_number, d.head_sha, d.updated_at,
         (select p.url from wos.pull_requests p where p.document_id = d.id order by p.opened_at desc limit 1) as pr_url
    from wos.documents d`;
const docView = (d: DocRow) => ({
  id: d.id,
  kind: d.kind,
  version: d.version,
  state: d.state,
  roundNumber: d.round_number,
  prUrl: d.pr_url,
  headSha: d.head_sha,
  updatedAt: isoReq(d.updated_at),
});

async function latestAppProgress(tx: Tx, targetId: string): Promise<{ progress: Progress; detail: AppProgress | null }> {
  const [p] = await tx<
    {
      mapped_bp: number;
      specified_bp: number;
      built_bp: number;
      roadmap_version: number | null;
      inventory_version: number | null;
      inventory_items: number | null;
      excluded_items: number;
      computed_at: Date;
      detail: AppProgress | null;
    }[]
  >`
    select mapped_bp, specified_bp, built_bp, roadmap_version, inventory_version, inventory_items, excluded_items, computed_at, detail
      from wos.progress_snapshots where target_id = ${targetId} and scope = 'app' order by id desc limit 1`;
  if (!p) return { progress: ZERO_PROGRESS, detail: null };
  return {
    progress: {
      mappedBp: p.mapped_bp,
      specifiedBp: p.specified_bp,
      builtBp: p.built_bp,
      roadmapVersion: p.roadmap_version,
      inventoryVersion: p.inventory_version,
      inventoryItems: p.inventory_items,
      excludedItems: p.excluded_items,
      computedAt: iso(p.computed_at),
    },
    detail: p.detail,
  };
}

async function targetSummary(tx: Tx, t: TargetRow): Promise<TargetSummary> {
  const { progress } = await latestAppProgress(tx, t.id);
  return {
    slug: t.slug,
    name: t.name,
    rank: t.rank,
    whatItIs: t.what_it_is,
    productName: t.product_name,
    repo: t.repo_full_name,
    productPath: t.product_path,
    progress,
    roadmap: await documentSummary(tx, { targetId: t.id }),
    hosted: { available: t.hosted_url !== null, url: t.hosted_url },
    selfHostable: t.self_hostable,
  };
}

async function loadTarget(tx: Tx, slug: string): Promise<TargetRow> {
  const [t] = await tx<TargetRow[]>`select * from wos.targets where slug = ${slug}`;
  if (!t) throw new ApiFailure("NOT_FOUND", `target ${slug} not found`);
  return t;
}

/** ABU summaries for a set of ABU ids (relevantTo from each contract's profiles; latest PR of any attempt). */
export async function abuSummaries(tx: Tx, abuIds: string[]): Promise<Map<string, AbuSummary>> {
  const out = new Map<string, AbuSummary>();
  if (abuIds.length === 0) return out;
  const rows = await tx<
    {
      id: string;
      key: string;
      title: string;
      state: AbuSummary["state"];
      size_points: number;
      depends_on: string[];
      requirements: string[];
      relevant_to: string[];
      repo: string;
      pr_number: number | null;
      pr_url: string | null;
      pr_state: "open" | "merged" | "closed" | null;
    }[]
  >`
    select a.id, a.key, a.title, a.state, a.size_points,
           coalesce((select array_agg(d.key order by d.key) from wos.abu_dependencies e join wos.abus d on d.id = e.depends_on_abu_id where e.abu_id = a.id), '{}') as depends_on,
           coalesce((select array_agg(distinct r.key order by r.key) from wos.abu_requirements ar join wos.requirements r on r.id = ar.requirement_id where ar.abu_id = a.id), '{}') as requirements,
           coalesce((select array_agg(distinct rt.slug order by rt.slug) from wos.abu_requirements ar
                       join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id
                       join wos.targets rt on rt.id = rp.target_id where ar.abu_id = a.id), '{}') as relevant_to,
           a.repo_full_name as repo,
           pr.number as pr_number, pr.url as pr_url, pr.state as pr_state
      from wos.abus a
      left join lateral (select p.number, p.url, p.state from wos.pull_requests p join wos.attempts at on at.id = p.attempt_id
                          where at.abu_id = a.id order by p.opened_at desc limit 1) pr on true
     where a.id in ${tx(abuIds)}`;
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      key: r.key,
      title: r.title,
      state: r.state,
      sizePoints: r.size_points,
      dependsOn: r.depends_on,
      requirements: r.requirements,
      repo: r.repo,
      relevantTo: r.relevant_to,
      claimable: null,
      pr: r.pr_number !== null && r.pr_url && r.pr_state ? { number: r.pr_number, url: r.pr_url, state: r.pr_state } : null,
    });
  }
  return out;
}

async function revealedReviews(tx: Tx, where: { abuId?: string; attemptId?: string }) {
  const rows = await tx<
    {
      id: string;
      round_id: string;
      round_number: number;
      slot: "astra" | "fable";
      handle: string;
      provider: "claude_cli" | "codex_cli";
      model_id: string;
      reasoning: "max";
      verdict: "NO_MATERIAL_GAPS" | "MATERIAL_GAPS";
      head_sha: string;
      independence: "independent";
      revealed_at: Date;
    }[]
  >`
    select v.id, v.round_id, r.round_number, v.slot, ac.handle, v.provider, v.model_id, v.reasoning, v.verdict, v.head_sha,
           v.independence, r.revealed_at
      from wos.reviews v join wos.rounds r on r.id = v.round_id join wos.accounts ac on ac.id = v.account_id
      join wos.attempts at on at.id = r.attempt_id
     where r.state = 'revealed' and ${where.abuId ? tx`at.abu_id = ${where.abuId}` : tx`at.id = ${where.attemptId!}`}
     order by r.round_number, v.slot`;
  return rows.map((r) => ({
    id: r.id,
    roundId: r.round_id,
    roundNumber: r.round_number,
    slot: r.slot,
    reviewerHandle: r.handle,
    provider: r.provider,
    model: modelRef(r.model_id),
    reasoning: r.reasoning,
    verdict: r.verdict,
    headSha: r.head_sha,
    independence: r.independence,
    revealedAt: isoReq(r.revealed_at),
  }));
}

const modelRef = (modelId: string): "fable" | "opus" | "astra" =>
  modelId.includes("astra") ? "astra" : modelId.includes("opus") ? "opus" : "fable";
export { revealedReviews };

async function catalogRefs(tx: Tx, featureId: string) {
  return tx<{ target: string; capability: string; target_id: string }[]>`
    select t.slug as target, c.key as capability, t.id as target_id
      from wos.app_features af join wos.targets t on t.id = af.target_id join wos.capabilities c on c.id = af.capability_id
     where af.catalog_feature_id = ${featureId} and af.state <> 'descoped' order by t.rank`;
}

async function requirementViews(tx: Tx, contractDocId: string | null, onlyTargetId: string | null) {
  if (!contractDocId) return [];
  const reqs = await tx<{ id: string; key: string; kind: string; statement: string; profiles: string[] }[]>`
    select r.id, r.key, r.kind, r.statement,
           coalesce((select array_agg(t.slug order by t.slug) from wos.requirement_profiles rp join wos.targets t on t.id = rp.target_id
                      where rp.requirement_id = r.id), '{}') as profiles
      from wos.requirements r where r.document_id = ${contractDocId}
       ${onlyTargetId ? tx`and exists (select 1 from wos.requirement_profiles rp where rp.requirement_id = r.id and rp.target_id = ${onlyTargetId})` : tx``}
     order by r.key`;
  const out = [];
  for (const r of reqs) {
    const abus = await tx<{ key: string; state: string }[]>`
      select a.key, a.state from wos.abu_requirements ar join wos.abus a on a.id = ar.abu_id
       where ar.requirement_id = ${r.id} and a.state <> 'superseded' order by a.key`;
    out.push({
      key: r.key,
      kind: r.kind,
      statement: r.statement,
      abus: abus.map((a) => a.key),
      built: abus.length > 0 && abus.every((a) => a.state === "merged"),
      profiles: r.profiles,
    });
  }
  return out;
}

export const publicHandlers: Pick<
  Handlers,
  | "getPlatformStatus"
  | "listTargets"
  | "getTarget"
  | "getProgressHistory"
  | "getFeature"
  | "listCatalog"
  | "getCatalogFeature"
  | "getAbu"
  | "listActivity"
  | "getContributor"
  | "getContributorLedger"
  | "getLeaderboard"
> = {
  async getPlatformStatus(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const rows = await tx<{ key: string; value: unknown }[]>`select key, value from wos.platform_settings`;
      const s = new Map(rows.map((r) => [r.key, r.value]));
      const boot = (s.get("bootstrap_mode") ?? {}) as { enabled?: boolean; since?: string | null };
      return {
        bootstrapMode: boot.enabled === true,
        bootstrapSince: boot.since ? new Date(boot.since).toISOString() : null,
        contractsVersion: CONTRACTS_VERSION,
        policyVersion: String(s.get("active_policy") ?? ctx.deps.policy.policyVersion),
        rewardScheduleVersion: String(s.get("active_reward_schedule") ?? ctx.deps.schedule.scheduleVersion),
      };
    });
  },

  async listTargets(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const targets = await tx<TargetRow[]>`select * from wos.targets order by rank`;
      const items = [];
      for (const t of targets) items.push(await targetSummary(tx, t));
      return { items };
    });
  },

  async getTarget(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const t = await loadTarget(tx, ctx.params.slug);
      const summary = await targetSummary(tx, t);
      const { detail } = await latestAppProgress(tx, t.id);
      const capProgress = new Map((detail?.capabilities ?? []).map((c) => [c.capability, c]));
      const featProgress = new Map((detail?.features ?? []).map((f) => [f.feature, f]));
      const caps = await tx<
        { id: string; key: string; title: string; summary: string; weight_bp: number; weight_rationale: string; mapped: boolean }[]
      >`
        select id, key, title, summary, weight_bp, weight_rationale, mapped from wos.capabilities
         where target_id = ${t.id} and not retired order by position, key`;
      const capabilities = [];
      for (const c of caps) {
        const feats = await tx<
          {
            feature_id: string;
            key: string;
            title: string;
            summary: string;
            state: "mapped";
            weight_bp: number;
            weight_rationale: string;
            shared_with: string[];
          }[]
        >`
          select f.id as feature_id, f.key, f.title, f.summary, af.state, af.weight_bp, af.weight_rationale,
                 coalesce((select array_agg(t2.slug order by t2.rank) from wos.app_features o join wos.targets t2 on t2.id = o.target_id
                            where o.catalog_feature_id = f.id and o.target_id <> ${t.id} and o.state <> 'descoped'), '{}') as shared_with
            from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id
           where af.capability_id = ${c.id} and af.state <> 'descoped' order by f.key`;
        const features = [];
        for (const f of feats) {
          const fp = featProgress.get(f.key);
          features.push({
            key: f.key,
            capability: c.key,
            title: f.title,
            summary: f.summary,
            state: f.state,
            weightBp: f.weight_bp,
            weightRationale: f.weight_rationale,
            effectiveAppWeightBp: fp?.effectiveAppWeightBp ?? Math.floor((c.weight_bp * f.weight_bp) / 10_000),
            specifiedBp: fp?.specifiedBp ?? 0,
            builtBp: fp?.builtBp ?? 0,
            relevantPoints: fp?.relevantPoints ?? 0,
            mergedPoints: fp?.mergedPoints ?? 0,
            sharedWith: f.shared_with,
            contract: await documentSummary(tx, { featureId: f.feature_id }),
          });
        }
        const cp = capProgress.get(c.key);
        capabilities.push({
          key: c.key,
          title: c.title,
          summary: c.summary,
          weightBp: c.weight_bp,
          weightRationale: c.weight_rationale,
          mapped: c.mapped,
          specifiedBp: cp?.specifiedBp ?? 0,
          builtBp: cp?.builtBp ?? 0,
          features,
        });
      }
      const excluded = await tx<{ item: string; title: string; reason: string }[]>`
        select i.key as item, i.title, d.excluded_reason as reason
          from wos.inventory_dispositions d join wos.inventory_items i on i.id = d.inventory_item_id
          join wos.inventory_versions v on v.id = d.inventory_version_id
         where v.target_id = ${t.id} and v.state = 'frozen' and d.excluded_reason is not null order by i.key`;
      return { ...summary, capabilities, excluded };
    });
  },

  async getProgressHistory(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const t = await loadTarget(tx, ctx.params.slug);
      const before = cursorOf(ctx.query.cursor);
      const rows = await tx<
        {
          id: string;
          mapped_bp: number;
          specified_bp: number;
          built_bp: number;
          roadmap_version: number | null;
          inventory_version: number | null;
          inventory_items: number | null;
          excluded_items: number;
          computed_at: Date;
        }[]
      >`
        select id, mapped_bp, specified_bp, built_bp, roadmap_version, inventory_version, inventory_items, excluded_items, computed_at
          from wos.progress_snapshots where target_id = ${t.id} and scope = 'app' ${before ? tx`and id < ${before}` : tx``}
         order by id desc limit ${PAGE + 1}`;
      const page = rows.slice(0, PAGE);
      return {
        items: page.map((p) => ({
          mappedBp: p.mapped_bp,
          specifiedBp: p.specified_bp,
          builtBp: p.built_bp,
          roadmapVersion: p.roadmap_version,
          inventoryVersion: p.inventory_version,
          inventoryItems: p.inventory_items,
          excludedItems: p.excluded_items,
          computedAt: isoReq(p.computed_at),
        })),
        nextCursor: rows.length > PAGE ? String(page[page.length - 1]!.id) : null,
      };
    });
  },

  async getFeature(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx): Promise<AppFeatureDetail> => {
      const t = await loadTarget(tx, ctx.params.slug);
      const [f] = await tx<
        {
          feature_id: string;
          key: string;
          title: string;
          summary: string;
          state: "mapped";
          weight_bp: number;
          weight_rationale: string;
          capability: string;
          capability_weight: number;
          contract_doc: string | null;
          shared_with: string[];
        }[]
      >`
        select f.id as feature_id, f.key, f.title, f.summary, af.state, af.weight_bp, af.weight_rationale, c.key as capability,
               c.weight_bp as capability_weight, f.current_contract_document_id as contract_doc,
               coalesce((select array_agg(t2.slug order by t2.rank) from wos.app_features o join wos.targets t2 on t2.id = o.target_id
                          where o.catalog_feature_id = f.id and o.target_id <> ${t.id} and o.state <> 'descoped'), '{}') as shared_with
          from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id join wos.capabilities c on c.id = af.capability_id
         where af.target_id = ${t.id} and f.key = ${ctx.params.feature}`;
      if (!f) throw new ApiFailure("NOT_FOUND", `${ctx.params.slug} does not track ${ctx.params.feature}`);
      const { detail } = await latestAppProgress(tx, t.id);
      const fp = detail?.features.find((x) => x.feature === f.key);
      const requirements = await requirementViews(tx, f.contract_doc, t.id);
      const relevant = f.contract_doc
        ? await tx<{ id: string }[]>`
            select distinct a.id, a.key from wos.abus a join wos.abu_requirements ar on ar.abu_id = a.id
              join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id and rp.document_id = a.document_id
             where a.document_id = ${f.contract_doc} and rp.target_id = ${t.id} and a.state <> 'superseded' order by a.key`
        : [];
      const abus = await abuSummaries(
        tx,
        relevant.map((r) => r.id),
      );
      return {
        key: f.key,
        capability: f.capability,
        title: f.title,
        summary: f.summary,
        state: f.state,
        weightBp: f.weight_bp,
        weightRationale: f.weight_rationale,
        effectiveAppWeightBp: fp?.effectiveAppWeightBp ?? Math.floor((f.capability_weight * f.weight_bp) / 10_000),
        specifiedBp: fp?.specifiedBp ?? 0,
        builtBp: fp?.builtBp ?? 0,
        relevantPoints: fp?.relevantPoints ?? 0,
        mergedPoints: fp?.mergedPoints ?? 0,
        sharedWith: f.shared_with,
        contract: await documentSummary(tx, { featureId: f.feature_id }),
        target: t.slug,
        requirements,
        abus: relevant.map((r) => abus.get(r.id)!).filter(Boolean),
      };
    });
  },

  async listCatalog(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const rows = await tx<
        { id: string; key: string; title: string; summary: string; state: "active" | "aliased"; alias_key: string | null }[]
      >`
        select f.id, f.key, f.title, f.summary, f.state, a.key as alias_key
          from wos.catalog_features f left join wos.catalog_features a on a.id = f.alias_of order by f.key`;
      const items = [];
      for (const r of rows)
        items.push({
          key: r.key,
          title: r.title,
          summary: r.summary,
          state: r.state,
          aliasOf: r.alias_key,
          referencedBy: await referencedBy(tx, r.id),
        });
      return { items };
    });
  },

  async getCatalogFeature(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx): Promise<CatalogFeatureDetail> => {
      const [f] = await tx<
        {
          id: string;
          key: string;
          title: string;
          summary: string;
          state: "active" | "aliased";
          alias_key: string | null;
          contract_doc: string | null;
        }[]
      >`
        select f.id, f.key, f.title, f.summary, f.state, a.key as alias_key, f.current_contract_document_id as contract_doc
          from wos.catalog_features f left join wos.catalog_features a on a.id = f.alias_of where f.key = ${ctx.params.feature}`;
      if (!f) throw new ApiFailure("NOT_FOUND", `catalog feature ${ctx.params.feature} not found`);
      const abuIds = f.contract_doc
        ? await tx<{ id: string }[]>`select id from wos.abus where document_id = ${f.contract_doc} order by key`
        : [];
      const abus = await abuSummaries(
        tx,
        abuIds.map((a) => a.id),
      );
      return {
        key: f.key,
        title: f.title,
        summary: f.summary,
        state: f.state,
        aliasOf: f.alias_key,
        referencedBy: await referencedBy(tx, f.id),
        contract: await documentSummary(tx, { featureId: f.id }),
        requirements: await requirementViews(tx, f.contract_doc, null),
        abus: abuIds.map((a) => abus.get(a.id)!).filter(Boolean),
      };
    });
  },

  async getAbu(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const summaries = await abuSummaries(tx, [ctx.params.id]);
      const abu = summaries.get(ctx.params.id);
      if (!abu) throw new ApiFailure("NOT_FOUND", "ABU not found");
      const ids = await tx<{ id: string }[]>`select id from wos.attempts where abu_id = ${ctx.params.id} order by created_at`;
      const attempts = [];
      for (const a of ids) {
        const row = await loadAttempt(tx, a.id);
        if (row) attempts.push(attemptView(row));
      }
      return { ...abu, attempts, reviews: await revealedReviews(tx, { abuId: ctx.params.id }) };
    });
  },

  async listActivity(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const before = cursorOf(ctx.query.cursor);
      const rows = await tx<Parameters<typeof eventWire>[0][]>`
        select * from wos.events where visibility = 'public'
          ${before ? tx`and id < ${before}` : tx``}
          ${ctx.query.target ? tx`and payload->>'target' = ${ctx.query.target}` : tx``}
         order by id desc limit ${PAGE + 1}`;
      const page = rows.slice(0, PAGE);
      const items = page.flatMap((r) => {
        const parsed = DomainEvent.safeParse(eventWire(r));
        return parsed.success ? [parsed.data] : [];
      });
      return { items, nextCursor: rows.length > PAGE ? String(page[page.length - 1]!.id) : null };
    });
  },

  async getContributor(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx): Promise<RouteResponse<"getContributor">> => {
      const acct = await publicAccount(tx, ctx.params.handle);
      const rows = await tx<
        {
          id: string;
          category: "implementation";
          state: "accepted";
          target: string | null;
          feature: string | null;
          abu: string | null;
          pr_url: string | null;
          independence: "independent";
          accepted_at: Date | null;
        }[]
      >`
        select c.id, c.category, c.state, coalesce(t.slug, (select tt.slug from wos.app_features af join wos.targets tt on tt.id = af.target_id
                  where af.catalog_feature_id = c.catalog_feature_id order by tt.rank limit 1)) as target,
               f.key as feature, a.key as abu, p.url as pr_url, c.independence, c.accepted_at
          from wos.contributions c
          left join wos.targets t on t.id = c.target_id left join wos.catalog_features f on f.id = c.catalog_feature_id
          left join wos.abus a on a.id = c.abu_id left join wos.pull_requests p on p.id = c.pull_request_id
         where c.account_id = ${acct.id} order by c.created_at desc limit 200`;
      return {
        handle: acct.handle,
        githubLogin: acct.github_login,
        displayName: acct.display_name,
        avatarUrl: acct.avatar_url,
        joinedAt: isoReq(acct.created_at),
        leaderboardOptIn: acct.leaderboard_opt_in,
        score: acct.leaderboard_opt_in ? num(acct.score) : null,
        contributions: rows.map((r) => ({
          id: r.id,
          category: r.category,
          state: r.state,
          target: r.target ?? "waronsaas",
          feature: r.feature,
          abu: r.abu,
          prUrl: r.pr_url,
          independence: r.independence,
          acceptedAt: iso(r.accepted_at),
        })),
      };
    });
  },

  async getContributorLedger(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const acct = await publicAccount(tx, ctx.params.handle);
      if (!acct.leaderboard_opt_in) throw new ApiFailure("NOT_FOUND", "this contributor's token history is not public");
      const before = cursorOf(ctx.query.cursor);
      const rows = await tx<
        {
          entry_no: string;
          kind: "award";
          bucket: "held";
          amount: string;
          category: "review" | null;
          memo: string;
          created_at: Date;
          entry_hash: Buffer;
        }[]
      >`
        select entry_no, kind, bucket, amount, category, memo, created_at, entry_hash from wos.ledger_entries
         where account_id = ${acct.id} ${before ? tx`and entry_no < ${before}` : tx``} order by entry_no desc limit ${PAGE + 1}`;
      const page = rows.slice(0, PAGE);
      return {
        items: page.map((r) => ({
          entryNo: num(r.entry_no),
          kind: r.kind,
          bucket: r.bucket,
          amount: num(r.amount),
          category: r.category,
          memo: r.memo,
          createdAt: isoReq(r.created_at),
          entryHash: Buffer.from(r.entry_hash).toString("hex"),
        })),
        nextCursor: rows.length > PAGE ? String(page[page.length - 1]!.entry_no) : null,
      };
    });
  },

  async getLeaderboard(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const offset = cursorOf(ctx.query.cursor) ?? 0;
      const rows = await tx<{ rank: number; handle: string; display_name: string | null; avatar_url: string | null; score: string }[]>`
        select rank, handle, display_name, avatar_url, score from wos.v_leaderboard order by rank, handle offset ${offset} limit ${PAGE + 1}`;
      const page = rows.slice(0, PAGE);
      return {
        items: page.map((r) => ({
          rank: r.rank,
          handle: r.handle,
          displayName: r.display_name,
          avatarUrl: r.avatar_url,
          score: num(r.score),
        })),
        nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
        disclaimer: TOKEN_DISCLAIMER,
      };
    });
  },
};

async function referencedBy(tx: Tx, featureId: string) {
  const [contract] = await tx<
    { id: string | null }[]
  >`select current_contract_document_id as id from wos.catalog_features where id = ${featureId}`;
  const [fk] = await tx<{ key: string }[]>`select key from wos.catalog_features where id = ${featureId}`;
  const refs = await catalogRefs(tx, featureId);
  const out = [];
  for (const r of refs) {
    const [hp] = contract?.id
      ? await tx<
          { has: boolean }[]
        >`select exists (select 1 from wos.requirement_profiles where document_id = ${contract.id} and target_id = ${r.target_id}) as has`
      : [{ has: false }];
    const { detail } = await latestAppProgress(tx, r.target_id);
    const built = detail?.features.find((f) => f.feature === fk?.key)?.builtBp ?? 0;
    out.push({ target: r.target, capability: r.capability, hasProfile: hp?.has ?? false, builtBp: built });
  }
  return out;
}

async function publicAccount(tx: Tx, handle: string) {
  const [a] = await tx<
    {
      id: string;
      handle: string;
      github_login: string | null;
      display_name: string | null;
      avatar_url: string | null;
      created_at: Date;
      leaderboard_opt_in: boolean;
      score: string;
    }[]
  >`
    select a.id, a.handle, a.github_login, a.display_name, a.avatar_url, a.created_at, a.leaderboard_opt_in, b.score
      from wos.accounts a join wos.v_balances b on b.account_id = a.id
     where lower(a.handle) = lower(${handle}) and a.status = 'active'
       and (exists (select 1 from wos.contributions c where c.account_id = a.id)
            or exists (select 1 from wos.attempts t where t.account_id = a.id))`;
  if (!a) throw new ApiFailure("NOT_FOUND", `no contributor ${handle}`);
  return a;
}
