/**
 * Event consumers over the `events` outbox (DOMAIN-MODEL.md section 3). Each consumer processes an
 * event at most once: its effects and the `(event_id, consumer)` marker commit in one transaction.
 * GitHub side effects happen here, after the transaction that recorded the intent.
 */
import {
  CONTRACTS_VERSION,
  DomainEvent,
  type EventConsumer,
  NotImplementedError,
  type ProvenanceRecord,
  type ReasoningLevel,
} from "@waronsaas/contracts";
import { inTransaction, type Tx } from "@waronsaas/db";
import { CONSENSUS_STATUS_CONTEXT, officialBranch, QUALIFIED_STATUS_CONTEXT } from "@waronsaas/github";
import type { Deps } from "../deps.js";
import { eventWire } from "../handlers/account.js";
import { canonicalJson, sha256Prefixed, uuidv7 } from "../util/crypto.js";
import { loadAttempt } from "../views.js";
import { insertEvent } from "../db/events.js";
import { createContribution, insertLedgerEntry } from "./ledger.js";
import { recomputeTarget } from "./progress.js";
import { qualify } from "./review.js";
import { abuTransition, attemptTransition, SYSTEM, taskTransition } from "./work.js";

type EventRow = Parameters<typeof eventWire>[0];

interface Consumer {
  name: EventConsumer;
  types: string[];
  handle(deps: Deps, e: EventRow): Promise<void>;
}

async function markConsumed(tx: Tx, eventId: number | string, consumer: EventConsumer): Promise<void> {
  await tx`insert into wos.event_consumptions (event_id, consumer) values (${eventId}, ${consumer})`;
}

const SYS = { kind: "system" as const, accountId: null };
const payload = <T>(e: EventRow) => e.payload as T;

// ---------------------------------------------------------------------------------------------- github_sync

async function openOrUpdatePr(deps: Deps, e: EventRow, attemptId: string): Promise<void> {
  const attempt = await inTransaction(deps.sql, SYS, (tx) => loadAttempt(tx, attemptId));
  if (attempt?.state !== "qualified" || !attempt.head_sha) {
    await inTransaction(deps.sql, SYS, (tx) => markConsumed(tx, e.id, "github_sync"));
    return;
  }
  const repo = deps.config.productRepo;
  const facts = await inTransaction(deps.sql, SYS, async (tx) => {
    const [round] = await tx<{ id: string; head_sha: string; submission_sha256: string; round_number: number; independence: string }[]>`
      select id, head_sha, submission_sha256, round_number, independence from wos.rounds
       where attempt_id = ${attempt.id} and state = 'revealed' order by round_number desc limit 1`;
    const q = await qualify(tx, attempt, round!);
    const [spec] = await tx<{ title: string; objective: string; feature: string }[]>`
      select a.spec->>'title' as title, a.spec->>'objective' as objective, f.key as feature
        from wos.abus a join wos.catalog_features f on f.id = a.catalog_feature_id where a.id = ${attempt.abu_id}`;
    const [builder] = await tx<{ github_login: string }[]>`select github_login from wos.accounts where id = ${attempt.account_id}`;
    const runs = await tx<{ id: string; role: string; model_id: string; reasoning: ReasoningLevel; manifest_sha256: string }[]>`
      select r.id, m.role, m.model_id, m.reasoning, m.manifest_sha256 from wos.agent_runs r join wos.context_manifests m on m.id = r.manifest_id
       where r.lease_id in (select c.lease_id from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id where cc.commit_sha = ${attempt.head_sha})
          or r.lease_id in (select lease_id from wos.reviews where round_id = ${round!.id})
       order by r.created_at, r.id`;
    const reviews = await tx<
      {
        slot: "astra" | "fable";
        login: string;
        model_id: string;
        reasoning: ReasoningLevel;
        verdict: "NO_MATERIAL_GAPS";
        independence: "independent";
      }[]
    >`
      select v.slot, coalesce(a.github_login, a.handle) as login, v.model_id, v.reasoning, v.verdict, v.independence
        from wos.reviews v join wos.accounts a on a.id = v.account_id where v.round_id = ${round!.id} order by v.slot`;
    const ci = await tx<{ github_check_suite_id: string; conclusion: string }[]>`
      select github_check_suite_id, conclusion from wos.verification_runs where attempt_id = ${attempt.id} and source = 'ci' and head_sha = ${attempt.head_sha}
       order by created_at`;
    return { round: round!, q, spec: spec!, builderLogin: builder?.github_login ?? attempt.builder_handle, runs, reviews, ci };
  });
  if (!facts.q.ok) {
    deps.log("warn", "qualified attempt no longer qualifies; not opening a PR", { attemptId, failed: facts.q.failed });
    await inTransaction(deps.sql, SYS, (tx) => markConsumed(tx, e.id, "github_sync"));
    return;
  }
  const branch = officialBranch(attempt.abu_key, attempt.id);
  await deps.github.setBranch(repo, branch, attempt.head_sha);
  const body = [
    `## ${attempt.abu_key}: ${facts.spec.title}`,
    "",
    facts.spec.objective,
    "",
    "### Qualification (checked by wOS)",
    "",
    "| # | Check | Pass | Evidence |",
    "|---|---|---|---|",
    ...facts.q.checks.map((c) => `| ${c.n} | ${c.check} | ${c.pass ? "yes" : "no"} | ${c.evidence ?? ""} |`),
    "",
    `### Reviews (round ${facts.round.round_number}, ${facts.round.independence})`,
    "",
    ...facts.reviews.map(
      (r) => `- ${r.slot === "astra" ? "Astra" : "Fable"} ${r.reasoning.toUpperCase()} (attested) by @${r.login}: ${r.verdict}`,
    ),
  ].join("\n");
  let prNumber = attempt.pr_number;
  let prUrl = attempt.pr_url;
  if (prNumber === null) {
    const pr = await deps.github.openPullRequest(repo, {
      head: branch,
      base: "main",
      title: `${attempt.abu_key}: ${facts.spec.title}`,
      body,
      draft: false,
      labels: ["wos:implementation", `feature:${facts.spec.feature}`],
      provenance: null,
    });
    prNumber = pr.number;
    prUrl = pr.url;
  }
  await deps.github.setCommitStatus(repo, attempt.head_sha, {
    context: QUALIFIED_STATUS_CONTEXT,
    state: "success",
    description: "Qualified by wOS: two independent reviews, CI green, scope verified",
    targetUrl: `${deps.config.webOrigin}/abus/${attempt.abu_id}`,
  });
  const record: ProvenanceRecord = {
    schema: "wos-provenance.v1",
    contractsVersion: CONTRACTS_VERSION,
    subject: { kind: "implementation", attemptId: attempt.id, abu: attempt.abu_key },
    repo,
    prNumber: prNumber!,
    headSha: attempt.head_sha,
    baseSha: attempt.base_sha,
    authors: [{ accountId: attempt.account_id, githubLogin: facts.builderLogin, role: "builder" }],
    agentRuns: facts.runs.map((r) => ({
      id: r.id,
      role: r.role as "builder",
      model: r.model_id,
      reasoning: r.reasoning,
      manifestSha256: r.manifest_sha256,
    })),
    reviews: facts.reviews.map((r) => ({
      slot: r.slot,
      reviewerLogin: r.login,
      model: r.model_id,
      reasoning: r.reasoning,
      verdict: r.verdict,
      headSha: attempt.head_sha!,
      roundNumber: facts.round.round_number,
      independence: r.independence,
    })),
    ci: facts.ci.map((c) => ({ checkSuiteId: Number(c.github_check_suite_id), conclusion: c.conclusion, headSha: attempt.head_sha! })),
    qualifiedAt: new Date().toISOString(),
  };
  await inTransaction(deps.sql, SYS, async (tx) => {
    const a = await loadAttempt(tx, attempt.id);
    if (a?.state !== "qualified") return markConsumed(tx, e.id, "github_sync");
    const [existing] = await tx<{ id: string }[]>`select id from wos.pull_requests where repo_full_name = ${repo} and number = ${prNumber}`;
    const prId = existing?.id ?? uuidv7();
    if (existing) {
      await tx`update wos.pull_requests set head_sha = ${a.head_sha}, updated_at = now() where id = ${prId}`;
    } else {
      await tx`insert into wos.pull_requests (id, repo_full_name, number, kind, attempt_id, url, head_sha, state)
               values (${prId}, ${repo}, ${prNumber}, 'implementation', ${a.id}, ${prUrl}, ${a.head_sha}, 'open')`;
    }
    await tx`insert into wos.provenance_records (id, pull_request_id, record, record_sha256)
             values (${uuidv7()}, ${prId}, ${tx.json(record as never)}, ${sha256Prefixed(canonicalJson(record))}) on conflict (record_sha256) do nothing`;
    await attemptTransition(tx, a, "pr_opened", SYSTEM, { pr_number: prNumber, pr_url: prUrl });
    await insertEvent(
      tx,
      {
        type: "attempt.pr_opened",
        v: 1,
        visibility: "public",
        payload: { attemptId: a.id, abu: a.abu_key, prNumber: prNumber!, prUrl: prUrl! },
      },
      { aggregateKind: "attempt", aggregateId: a.id, actor: "system", actorAccountId: null },
    );
    const [abu] = await tx<{ catalog_feature_id: string }[]>`select catalog_feature_id from wos.abus where id = ${a.abu_id}`;
    await createContribution(tx, {
      accountId: a.account_id,
      githubUserId: a.github_user_id,
      category: "implementation",
      catalogFeatureId: abu?.catalog_feature_id ?? null,
      abuId: a.abu_id,
      attemptId: a.id,
      pullRequestId: prId,
      independence: facts.round.independence as "independent",
      idempotencyKey: `implementation:${a.id}:${a.account_id}`,
    });
    await markConsumed(tx, e.id, "github_sync");
  });
  await deps.github
    .enableAutoMerge(repo, prNumber!)
    .catch((err: unknown) =>
      deps.log("warn", "enableAutoMerge failed", { attemptId, error: err instanceof Error ? err.message : String(err) }),
    );
}

const githubSync: Consumer = {
  name: "github_sync",
  types: ["attempt.state_changed", "document.round_opened", "document.consensus_reached"],
  async handle(deps, e) {
    if (e.type === "attempt.state_changed") {
      const p = payload<{ attemptId: string; to: string; from: string }>(e);
      if (p.to === "qualified") return openOrUpdatePr(deps, e, p.attemptId);
      if ((p.to === "abandoned" || p.to === "failed") && p.from === "pr_open") {
        const a = await inTransaction(deps.sql, SYS, (tx) => loadAttempt(tx, p.attemptId));
        if (a?.pr_number) await deps.github.closePullRequest(deps.config.productRepo, a.pr_number, `This attempt was ${p.to} in wOS.`);
      }
      return inTransaction(deps.sql, SYS, (tx) => markConsumed(tx, e.id, "github_sync"));
    }
    if (e.type === "document.round_opened") {
      const p = payload<{ documentId: string }>(e);
      const [doc] = await inTransaction(
        deps.sql,
        SYS,
        (tx) =>
          tx<
            {
              id: string;
              kind: string;
              branch: string;
              pr_number: number | null;
              head_sha: string;
              repo: string;
              product_name: string | null;
              slug: string | null;
              key: string | null;
            }[]
          >`
          select d.id, d.kind, d.branch, d.pr_number, d.head_sha, coalesce(t.repo_full_name, ${deps.config.productRepo}) as repo, t.product_name,
                 t.slug, f.key from wos.documents d left join wos.targets t on t.id = d.target_id left join wos.catalog_features f on f.id = d.catalog_feature_id
           where d.id = ${p.documentId}`,
      );
      if (doc && doc.pr_number === null) {
        const title = doc.kind === "roadmap" ? `${doc.product_name ?? doc.slug} Replacement Roadmap` : `${doc.key} Feature Contract`;
        const pr = await deps.github.openPullRequest(doc.repo, {
          head: doc.branch,
          base: "main",
          title,
          body: "Canonical document workflow run by wOS. Only the wOS GitHub App adds commits to this PR.",
          draft: true,
          labels: [doc.kind === "roadmap" ? "wos:roadmap" : "wos:feature-contract"],
          provenance: null,
        });
        await inTransaction(deps.sql, SYS, async (tx) => {
          await tx`update wos.documents set pr_number = ${pr.number}, row_version = row_version + 1 where id = ${doc.id} and pr_number is null`;
          await tx`insert into wos.pull_requests (id, repo_full_name, number, kind, document_id, url, head_sha, state)
                   values (${uuidv7()}, ${doc.repo}, ${pr.number}, ${doc.kind}, ${doc.id}, ${pr.url}, ${doc.head_sha}, 'open')
                   on conflict (repo_full_name, number) do nothing`;
          await markConsumed(tx, e.id, "github_sync");
        });
        return;
      }
      return inTransaction(deps.sql, SYS, (tx) => markConsumed(tx, e.id, "github_sync"));
    }
    if (e.type === "document.consensus_reached") {
      const p = payload<{ documentId: string; headSha: string }>(e);
      const [doc] = await inTransaction(
        deps.sql,
        SYS,
        (tx) =>
          tx<{ repo: string }[]>`select coalesce(t.repo_full_name, ${deps.config.productRepo}) as repo from wos.documents d
                                left join wos.targets t on t.id = d.target_id where d.id = ${p.documentId}`,
      );
      if (doc) {
        await deps.github.setCommitStatus(doc.repo, p.headSha, {
          context: CONSENSUS_STATUS_CONTEXT,
          state: "success",
          description: "Astra and Fable found no material gaps",
          targetUrl: null,
        });
      }
      return inTransaction(deps.sql, SYS, (tx) => markConsumed(tx, e.id, "github_sync"));
    }
  },
};

// ---------------------------------------------------------------------------------------------- task_unlocker

const taskUnlocker: Consumer = {
  name: "task_unlocker",
  types: ["attempt.merged", "abu.state_changed"],
  async handle(deps, e) {
    await inTransaction(deps.sql, SYS, async (tx) => {
      const p = payload<{ attemptId?: string; abuId?: string; to?: string }>(e);
      let abuId: string | null = null;
      if (e.type === "attempt.merged")
        abuId = (await tx<{ abu_id: string }[]>`select abu_id from wos.attempts where id = ${p.attemptId!}`)[0]?.abu_id ?? null;
      else if (p.to === "merged") abuId = p.abuId ?? null;
      if (abuId) await unlockDependents(tx, abuId);
      await markConsumed(tx, e.id, "task_unlocker");
    });
    void deps;
  },
};

/** pending_dependencies -> ready and the build task blocked -> open, for every dependent whose dependencies all merged. */
export async function unlockDependents(tx: Tx, abuId: string): Promise<void> {
  const dependents = await tx<{ id: string; key: string; state: string }[]>`
    select a.id, a.key, a.state from wos.abu_dependencies e join wos.abus a on a.id = e.abu_id where e.depends_on_abu_id = ${abuId}`;
  for (const d of dependents) {
    if (d.state !== "pending_dependencies") continue;
    const [open] = await tx<{ n: number }[]>`
      select count(*)::int as n from wos.abu_dependencies e join wos.abus x on x.id = e.depends_on_abu_id where e.abu_id = ${d.id} and x.state <> 'merged'`;
    if ((open?.n ?? 0) > 0) continue;
    await abuTransition(tx, d, "dependencies_merged", SYSTEM);
    const tasks = await tx<
      { id: string; state: "blocked" }[]
    >`select id, state from wos.tasks where abu_id = ${d.id} and kind = 'abu_build' and state = 'blocked'`;
    for (const t of tasks) await taskTransition(tx, t, "dependencies_met", SYSTEM);
  }
}

// ---------------------------------------------------------------------------------------------- progress

const progressConsumer: Consumer = {
  name: "progress",
  types: ["document.merged", "attempt.merged", "abu.state_changed", "app_feature.state_changed", "attempt.state_changed"],
  async handle(deps, e) {
    await inTransaction(deps.sql, SYS, async (tx) => {
      const p = payload<{ to?: string; from?: string }>(e);
      const relevant =
        e.type === "document.merged" ||
        e.type === "attempt.merged" ||
        (e.type === "abu.state_changed" && (p.to === "superseded" || p.to === "merged")) ||
        e.type === "app_feature.state_changed" ||
        (e.type === "attempt.state_changed" && p.from === "none");
      if (relevant) {
        const targets = await tx<{ target_id: string }[]>`select distinct target_id from wos.capabilities order by target_id`;
        for (const t of targets) await recomputeTarget(tx, deps, t.target_id, Number(e.id));
      }
      await markConsumed(tx, e.id, "progress");
    });
  },
};

// ---------------------------------------------------------------------------------------------- rewards

const rewardsConsumer: Consumer = {
  name: "rewards",
  types: [
    "attempt.merged",
    "document.merged",
    "round.revealed",
    "attempt.pr_opened",
    "contribution.accepted",
    "contribution.reversed",
    "finding.ruled",
  ],
  async handle(deps, e) {
    const parsed = DomainEvent.safeParse(eventWire(e));
    if (!parsed.success) return inTransaction(deps.sql, SYS, (tx) => markConsumed(tx, e.id, "rewards"));
    await inTransaction(deps.sql, SYS, async (tx) => {
      const [boot] = await tx<{ n: number }[]>`
        select count(*)::int as n from wos.contributions where independence = 'bootstrap_self'
           and (attempt_id::text = ${String((e.payload as { attemptId?: string }).attemptId ?? "")}
                or document_id::text = ${String((e.payload as { documentId?: string }).documentId ?? "")})`;
      const contributions = await tx<{ id: string; account_id: string; category: string; state: string; weight: number }[]>`
        select id, account_id, category, state, weight from wos.contributions
         where attempt_id::text = ${String((e.payload as { attemptId?: string }).attemptId ?? "")}
            or document_id::text = ${String((e.payload as { documentId?: string }).documentId ?? "")}
            or id::text = ${String((e.payload as { contributionId?: string }).contributionId ?? "")}`;
      const [now] = await tx<{ now: Date }[]>`select now() as now`;
      const drafts = deps.logic.computeLedgerDrafts(
        parsed.data,
        { now: now!.now.toISOString(), bootstrapSelfReviewed: (boot?.n ?? 0) > 0, contributions },
        deps.schedule,
      );
      for (const d of drafts) await insertLedgerEntry(tx, d, { kind: "system", accountId: null });
      await markConsumed(tx, e.id, "rewards");
    });
  },
};

export const CONSUMERS: readonly Consumer[] = [githubSync, taskUnlocker, progressConsumer, rewardsConsumer];

/** Runs every consumer over unconsumed events (oldest first). Returns how many (event, consumer) pairs were processed. */
export async function runDispatch(deps: Deps, limitPerConsumer = 200): Promise<number> {
  let processed = 0;
  for (const c of CONSUMERS) {
    const rows = await inTransaction(
      deps.sql,
      SYS,
      (tx) =>
        tx<EventRow[]>`
        select e.* from wos.events e
         where e.type in ${tx(c.types)} and not exists (select 1 from wos.event_consumptions x where x.event_id = e.id and x.consumer = ${c.name})
         order by e.id limit ${limitPerConsumer}`,
    );
    for (const e of rows) {
      try {
        await c.handle(deps, e);
        processed++;
      } catch (err) {
        if (err instanceof NotImplementedError) {
          deps.log("warn", `consumer ${c.name} waits for an unimplemented dependency`, { error: err.message });
          break;
        }
        if ((err as { code?: string }).code === "23505") continue; // another run consumed it
        deps.log("error", `consumer ${c.name} failed`, { eventId: Number(e.id), error: err instanceof Error ? err.message : String(err) });
        break;
      }
    }
  }
  return processed;
}
