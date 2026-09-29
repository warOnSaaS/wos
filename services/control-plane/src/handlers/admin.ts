/**
 * Maintainer routes (every override writes a public event with its reason), proposals and blockers
 * (GitHub Issues opened by the App, G-17), and the machine endpoints (webhook, cron).
 */
import { AttemptMachine, type DocumentState, RoundMachine } from "@waronsaas/contracts";
import { inTransaction, type Tx } from "@waronsaas/db";
import { ApiFailure } from "../errors.js";
import { insertEvent } from "../db/events.js";
import { transition } from "../db/transition.js";
import type { Caller, Handlers } from "../http/router.js";
import { uuidv7 } from "../util/crypto.js";
import { sha256Of } from "@waronsaas/contracts/canonical";
import { loadAttempt, queryTasks } from "../views.js";
import { revokeAllSessions } from "./account.js";
import { runDispatch } from "../domain/consumers.js";
import { documentTransition, loadDocument, openRoadmap } from "../domain/documents.js";
import { contributionTransition, createContribution, insertLedgerEntry, settleKeyedContribution } from "../domain/ledger.js";
import { openRound } from "../domain/review.js";
import { endBootstrap, runSweep } from "../domain/sweep.js";
import { processDelivery, retryDeliveries, storeDelivery } from "../domain/webhooks.js";
import {
  abuTransition,
  afterLeaseLost,
  createTask as newTask,
  endAttempt,
  endLease,
  type ActorRef,
  taskTransition,
} from "../domain/work.js";

const asMaintainerTx = (c: Caller) => ({ kind: "maintainer" as const, accountId: c.accountId });
const maintainer = (c: Caller): ActorRef => ({ actor: "maintainer", accountId: c.accountId });
const asContributor = (c: Caller) => ({ kind: "contributor" as const, accountId: c.accountId });

/** Cancels every live task of a subject (revoking active leases) and any open round. */
async function cancelSubjectWork(tx: Tx, where: { documentId?: string; attemptId?: string }, by: ActorRef, reason: string): Promise<void> {
  const tasks = await tx<{ id: string; state: "open" | "blocked" | "leased" }[]>`
    select id, state from wos.tasks where state in ('open', 'blocked', 'leased')
       and ${where.documentId ? tx`document_id = ${where.documentId}` : tx`attempt_id = ${where.attemptId!}`}`;
  for (const t of tasks) {
    if (t.state === "leased") {
      const [l] = await tx<
        { id: string; task_id: string }[]
      >`select id, task_id from wos.leases where task_id = ${t.id} and state = 'active'`;
      if (l) await endLease(tx, l, "revoke", by, reason);
    }
    await taskTransition(tx, t, "cancel", by);
  }
  const rounds = await tx<{ id: string }[]>`
    select id from wos.rounds where state = 'awaiting_reviews' and ${where.documentId ? tx`document_id = ${where.documentId}` : tx`attempt_id = ${where.attemptId!}`}`;
  for (const r of rounds) {
    await transition(tx, {
      machine: RoundMachine,
      table: "rounds",
      id: r.id,
      from: "awaiting_reviews",
      event: "cancel",
      actor: by.actor,
      actorAccountId: by.accountId,
      aggregateKind: "round",
      emit: { type: "round.cancelled", v: 1, visibility: "public", payload: { roundId: r.id, reason } },
    });
  }
}

async function accountByHandle(tx: Tx, handle: string): Promise<{ id: string; github_user_id: string | null }> {
  const [a] = await tx<
    { id: string; github_user_id: string | null }[]
  >`select id, github_user_id from wos.accounts where lower(handle) = lower(${handle})`;
  if (!a) throw new ApiFailure("NOT_FOUND", `no account with handle ${handle}`);
  return a;
}

export const adminHandlers: Pick<
  Handlers,
  "openRoadmap" | "confirmRuling" | "maintainerAction" | "createProposal" | "createBlocker" | "githubWebhook" | "cronSweep" | "cronDispatch"
> = {
  async openRoadmap(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, asMaintainerTx(caller), (tx) =>
      openRoadmap(tx, ctx.params.slug, ctx.body.reason, maintainer(caller)),
    );
  },

  async confirmRuling(ctx) {
    const caller = ctx.caller!;
    const { deps } = ctx;
    await inTransaction(deps.sql, asMaintainerTx(caller), async (tx) => {
      const [r] = await tx<
        {
          id: string;
          task_id: string;
          state: string;
          body: { rulings: Array<{ findingId: string; decision: "upheld" | "overruled" }> };
          row_version: number;
        }[]
      >`
        select id, task_id, state, body, row_version from wos.rulings where id = ${ctx.params.id}`;
      if (!r) throw new ApiFailure("NOT_FOUND", "ruling not found");
      if (r.state !== "awaiting_maintainer") throw new ApiFailure("CONFLICT", `ruling is ${r.state}`);
      const decided = await tx`
        update wos.rulings set state = ${ctx.body.accept ? "confirmed" : "rejected"}, decided_by = ${caller.accountId}, decided_at = now(),
               note = ${ctx.body.note}, row_version = row_version + 1
         where id = ${r.id} and state = 'awaiting_maintainer' and row_version = ${r.row_version} returning id`;
      if (decided.length === 0) throw new ApiFailure("CONFLICT", "ruling changed concurrently");
      const [task] = await queryTasks(tx, "where t.id = $1", [r.task_id]);
      await settleKeyedContribution(
        tx,
        `architecture_resolution:${r.id}`,
        ctx.body.accept ? "accept" : "reject",
        "maintainer",
        caller.accountId,
        ctx.body.note,
      );
      if (!ctx.body.accept) {
        // Rejected: a new resolver task opens (REVIEW-PROTOCOL.md section 8.3).
        await newTask(
          tx,
          {
            kind: "conflict_resolution",
            state: "open",
            documentId: task?.document_id ?? null,
            attemptId: task?.attempt_id ?? null,
            blockerId: task?.blocker_id ?? null,
            targetId: task?.target_id ?? null,
            catalogFeatureId: task?.catalog_feature_id ?? null,
            excludedAccountIds: task?.excluded_account_ids ?? [],
          },
          maintainer(caller),
        );
        return;
      }
      for (const f of r.body.rulings) {
        await tx`update wos.findings set state = ${f.decision}, row_version = row_version + 1 where id = ${f.findingId} and state in ('open', 'disputed')`;
        await settleKeyedContribution(
          tx,
          `review_finding:${f.findingId}`,
          f.decision === "upheld" ? "accept" : "reject",
          "system",
          caller.accountId,
          `finding ${f.decision} by a confirmed ruling`,
        );
        await tx`insert into wos.finding_responses (id, finding_id, account_id, source, action, note)
                 values (${uuidv7()}, ${f.findingId}, ${caller.accountId}, 'maintainer', ${f.decision}, ${ctx.body.note})`;
        await insertEvent(
          tx,
          {
            type: "finding.ruled",
            v: 1,
            visibility: "public",
            payload: { findingId: f.findingId, decision: f.decision, confirmedBy: caller.accountId },
          },
          { aggregateKind: "finding", aggregateId: f.findingId, actor: "maintainer", actorAccountId: caller.accountId },
        );
      }
      if (task?.document_id) {
        const doc = await loadDocument(tx, task.document_id);
        if (doc?.state === "escalated") {
          const [open] = await tx<{ n: number }[]>`
            select count(*)::int as n from wos.findings where document_id = ${doc.id} and state in ('open', 'disputed')`;
          const upheld = r.body.rulings.some((x) => x.decision === "upheld");
          if (upheld || (open?.n ?? 0) > 0) {
            await documentTransition(tx, doc, "ruling_upheld", maintainer(caller), null);
            await newTask(
              tx,
              doc.kind === "roadmap"
                ? { kind: "roadmap_author", state: "open", targetId: doc.target_id, documentId: doc.id, carry: { ruling: r.id } }
                : {
                    kind: "feature_author",
                    state: "open",
                    catalogFeatureId: doc.catalog_feature_id,
                    documentId: doc.id,
                    carry: { ruling: r.id },
                  },
              maintainer(caller),
            );
          } else {
            // All overruled: a fresh round on the unchanged head with the overruled findings closed.
            await documentTransition(tx, doc, "ruling_all_overruled", maintainer(caller), null);
            const [last] = await tx<{ submission_sha256: string }[]>`
              select submission_sha256 from wos.rounds where document_id = ${doc.id} order by round_number desc limit 1`;
            const authors = await tx<{ account_id: string }[]>`
              select distinct c.account_id from wos.changesets c join wos.tasks t on t.id = c.task_id where t.document_id = ${doc.id} and c.ok`;
            const round = await openRound(
              tx,
              doc.kind === "roadmap"
                ? { kind: "roadmap", documentId: doc.id, targetId: doc.target_id! }
                : { kind: "feature_contract", documentId: doc.id, catalogFeatureId: doc.catalog_feature_id! },
              doc.head_sha!,
              last!.submission_sha256,
              authors.map((a) => a.account_id),
              { actor: "system", accountId: null },
            );
            await documentTransition(
              tx,
              { id: doc.id, state: "validating" as DocumentState },
              "validation_passed",
              { actor: "system", accountId: null },
              {
                type: "document.round_opened",
                v: 1,
                visibility: "public",
                payload: { documentId: doc.id, roundId: round.roundId, roundNumber: round.roundNumber, headSha: doc.head_sha! },
              },
              { round_number: round.roundNumber },
            );
          }
        }
      }
    });
    return { ok: true as const };
  },

  async maintainerAction(ctx) {
    const caller = ctx.caller!;
    const { deps } = ctx;
    const a = ctx.body;
    const by = maintainer(caller);
    await inTransaction(deps.sql, asMaintainerTx(caller), async (tx) => {
      switch (a.action) {
        case "abandon_document": {
          const doc = await loadDocument(tx, a.documentId);
          if (!doc) throw new ApiFailure("NOT_FOUND", "document not found");
          await documentTransition(
            tx,
            doc,
            "abandon",
            by,
            { type: "document.abandoned", v: 1, visibility: "public", payload: { documentId: doc.id, reason: a.reason } },
            { ended_reason: a.reason },
          );
          await cancelSubjectWork(tx, { documentId: doc.id }, by, a.reason);
          return;
        }
        case "reopen_document": {
          const doc = await loadDocument(tx, a.documentId);
          if (!doc) throw new ApiFailure("NOT_FOUND", "document not found");
          await documentTransition(tx, doc, "maintainer_reopen", by, null);
          await newTask(
            tx,
            doc.kind === "roadmap"
              ? {
                  kind: "roadmap_author",
                  state: "open",
                  targetId: doc.target_id,
                  documentId: doc.id,
                  carry: { maintainerReason: a.reason },
                }
              : {
                  kind: "feature_author",
                  state: "open",
                  catalogFeatureId: doc.catalog_feature_id,
                  documentId: doc.id,
                  carry: { maintainerReason: a.reason },
                },
            by,
          );
          return;
        }
        case "fail_attempt": {
          const attempt = await loadAttempt(tx, a.attemptId);
          if (!attempt) throw new ApiFailure("NOT_FOUND", "attempt not found");
          if (!AttemptMachine.transitions.some((t) => t.from === attempt.state && t.event === "fail"))
            throw new ApiFailure("CONFLICT", `attempt is ${attempt.state}`);
          await cancelSubjectWork(tx, { attemptId: attempt.id }, by, a.reason);
          await endAttempt(tx, deps, (await loadAttempt(tx, attempt.id))!, "fail", by, a.reason);
          return;
        }
        case "flag_abu_for_decomposition": {
          const [abu] = await tx<{ id: string; key: string; state: string }[]>`select id, key, state from wos.abus where id = ${a.abuId}`;
          if (!abu) throw new ApiFailure("NOT_FOUND", "ABU not found");
          if (abu.state === "in_progress") {
            const [live] = await tx<{ id: string }[]>`
              select id from wos.attempts where abu_id = ${abu.id} and state not in ('merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded')`;
            const attempt = live ? await loadAttempt(tx, live.id) : null;
            if (attempt) {
              await cancelSubjectWork(tx, { attemptId: attempt.id }, by, a.reason);
              await endAttempt(tx, deps, (await loadAttempt(tx, attempt.id))!, "fail", by, a.reason);
            }
          }
          const [now] = await tx<{ id: string; key: string; state: string }[]>`select id, key, state from wos.abus where id = ${a.abuId}`;
          if (now!.state === "needs_decomposition") return;
          await abuTransition(tx, now!, "flag_for_decomposition", by);
          const open = await tx<{ id: string; state: "open" | "blocked" }[]>`
            select id, state from wos.tasks where abu_id = ${a.abuId} and kind = 'abu_build' and state in ('open', 'blocked')`;
          for (const t of open) await taskTransition(tx, t, "cancel", by);
          return;
        }
        case "reverse_contribution": {
          const [c] = await tx<{ id: string; state: "accepted"; account_id: string; category: "implementation" }[]>`
            select id, state, account_id, category from wos.contributions where id = ${a.contributionId}`;
          if (!c) throw new ApiFailure("NOT_FOUND", "contribution not found");
          if (c.state !== "accepted") throw new ApiFailure("CONFLICT", `contribution is ${c.state}`);
          await contributionTransition(tx, c, "reverse", "maintainer", caller.accountId, a.reason);
          // The void/clawback drafts come from the rewards rules on contribution.reversed (REWARD-PROTOCOL.md section 8).
          return;
        }
        case "suspend_account": {
          const [acct] = await tx<{ id: string; status: string }[]>`
            select a.id, a.status from wos.accounts a left join wos.account_emails e on e.account_id = a.id
             where lower(a.handle) = lower(${a.handleOrEmail}) or e.email_normalized = lower(btrim(${a.handleOrEmail})) limit 1`;
          if (!acct) throw new ApiFailure("NOT_FOUND", "account not found");
          if (acct.status === "suspended") throw new ApiFailure("CONFLICT", "account is already suspended");
          await tx`update wos.accounts set status = 'suspended', suspended_reason = ${a.reason}, row_version = row_version + 1 where id = ${acct.id}`;
          await revokeAllSessions(tx, acct.id);
          const leases = await tx<{ id: string; task_id: string; account_id: string }[]>`
            select id, task_id, account_id from wos.leases where account_id = ${acct.id} and state = 'active'`;
          for (const l of leases) {
            await endLease(tx, l, "revoke", by, `account suspended: ${a.reason}`);
            await afterLeaseLost(tx, deps, l, "revoked", by, "account suspended");
          }
          const live = await tx<{ id: string }[]>`
            select id from wos.attempts where account_id = ${acct.id} and state not in ('merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded')`;
          for (const x of live) {
            const attempt = await loadAttempt(tx, x.id);
            if (attempt) {
              await cancelSubjectWork(tx, { attemptId: attempt.id }, by, "account suspended");
              await endAttempt(tx, deps, (await loadAttempt(tx, attempt.id))!, "fail", by, `account suspended: ${a.reason}`);
            }
          }
          await insertEvent(
            tx,
            { type: "account.suspended", v: 1, visibility: "private", payload: { accountId: acct.id, reason: a.reason } },
            { aggregateKind: "account", aggregateId: acct.id, actor: "maintainer", actorAccountId: caller.accountId },
          );
          return;
        }
        case "set_hosting": {
          const updated = await tx`
            update wos.targets set hosted_url = ${a.hostedUrl}, self_hostable = ${a.selfHostable}, row_version = row_version + 1 where slug = ${a.target} returning id`;
          if (updated.length === 0) throw new ApiFailure("NOT_FOUND", `target ${a.target} not found`);
          await insertEvent(
            tx,
            {
              type: "target.hosting_changed",
              v: 1,
              visibility: "public",
              payload: { target: a.target, hosted: a.hostedUrl !== null, selfHostable: a.selfHostable },
            },
            { aggregateKind: "target", aggregateId: a.target, actor: "maintainer", actorAccountId: caller.accountId },
          );
          return;
        }
        case "end_bootstrap": {
          if (!(await endBootstrap(tx, a.reason, caller.accountId))) throw new ApiFailure("CONFLICT", "bootstrap mode has already ended");
          return;
        }
        case "ledger_adjustment": {
          if (a.amount === 0) throw new ApiFailure("VALIDATION_FAILED", "an adjustment needs a non-zero amount");
          const acct = await accountByHandle(tx, a.handle);
          await insertLedgerEntry(
            tx,
            {
              accountId: acct.id,
              kind: "adjustment",
              bucket: a.bucket,
              amount: a.amount,
              category: null,
              contributionId: null,
              poolId: null,
              relatedEntryId: null,
              pairId: null,
              idempotencyKey: `adjustment:${ctx.header("idempotency-key") ?? uuidv7()}:${acct.id}`,
              scheduleVersion: deps.schedule.scheduleVersion,
              memo: a.memo,
              releaseAfter: null,
            },
            { kind: "maintainer", accountId: caller.accountId },
          );
          return;
        }
        case "award_security": {
          const acct = await accountByHandle(tx, a.handle);
          if (acct.github_user_id === null) throw new ApiFailure("VALIDATION_FAILED", "the reporter needs a linked GitHub account");
          // The key carries the severity the loader passes to the rules (facts.security).
          const key = `security:${a.severity}:${sha256Of(a.reference).slice(7, 31)}:${acct.id}`;
          const [dupe] =
            await tx`select 1 as x from wos.contributions where idempotency_key like ${`security:%:${sha256Of(a.reference).slice(7, 31)}:${acct.id}`}`;
          if (dupe) throw new ApiFailure("CONFLICT", "this report was already awarded");
          const cid = await createContribution(tx, {
            accountId: acct.id,
            githubUserId: acct.github_user_id,
            category: "security",
            independence: "independent",
            idempotencyKey: key,
          });
          if (!cid) throw new ApiFailure("CONFLICT", "this report was already awarded");
          await contributionTransition(
            tx,
            { id: cid, state: "pending", account_id: acct.id, category: "security" },
            "accept",
            "system",
            caller.accountId,
            a.reference,
          );
          // The award itself is drafted by the rewards rules on contribution.accepted.
          return;
        }
      }
    });
    // Consumers run inline after commit when cheap (DOMAIN-MODEL.md section 3): rewards, progress, GitHub.
    await runDispatch(deps).catch((err: unknown) =>
      deps.log("error", "inline dispatch failed", { error: err instanceof Error ? err.message : String(err) }),
    );
    return { ok: true as const };
  },

  async createProposal(ctx) {
    const caller = ctx.caller!;
    const { deps } = ctx;
    const b = ctx.body;
    const [t] = await inTransaction(
      deps.sql,
      asContributor(caller),
      (tx) =>
        tx<{ id: string; repo_full_name: string; feature_id: string | null }[]>`
        select t.id, t.repo_full_name, (select id from wos.catalog_features where key = ${b.feature ?? ""}) as feature_id from wos.targets t where t.slug = ${b.target}`,
    );
    if (!t) throw new ApiFailure("VALIDATION_FAILED", `unknown target ${b.target}`);
    if (b.feature && !t.feature_id) throw new ApiFailure("VALIDATION_FAILED", `unknown catalog feature ${b.feature}`);
    const issue = await deps.github.createIssue(t.repo_full_name, {
      title: b.title,
      body: `${b.body}\n\n---\nProposed by @${caller.handle} through wOS (wos propose).`,
      labels: ["wos:proposal"],
    });
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const id = uuidv7();
      await tx`insert into wos.proposals (id, target_id, catalog_feature_id, account_id, title, body, issue_number, state)
               values (${id}, ${t.id}, ${t.feature_id}, ${caller.accountId}, ${b.title}, ${b.body}, ${issue.number}, 'open')`;
      await insertEvent(
        tx,
        { type: "proposal.opened", v: 1, visibility: "public", payload: { proposalId: id, target: b.target, issueNumber: issue.number } },
        { aggregateKind: "proposal", aggregateId: id, actor: "contributor", actorAccountId: caller.accountId },
      );
      return { proposalId: id, issueUrl: issue.url };
    });
  },

  async createBlocker(ctx) {
    const caller = ctx.caller!;
    const { deps } = ctx;
    const b = ctx.body;
    const [t] = await inTransaction(
      deps.sql,
      asContributor(caller),
      (tx) =>
        tx<{ id: string; repo_full_name: string; abu_id: string | null }[]>`
        select t.id, t.repo_full_name, (select id from wos.abus where key = ${b.abu ?? ""} order by created_at desc limit 1) as abu_id
          from wos.targets t where t.slug = ${b.target}`,
    );
    if (!t) throw new ApiFailure("VALIDATION_FAILED", `unknown target ${b.target}`);
    if (b.abu && !t.abu_id) throw new ApiFailure("VALIDATION_FAILED", `unknown ABU ${b.abu}`);
    const issue = await deps.github.createIssue(t.repo_full_name, {
      title: `ARCHITECTURE_BLOCKER: ${b.affectedContract}`,
      body: [
        `**Affected contract:** ${b.affectedContract}`,
        `**Reason:** ${b.reason}`,
        `**Evidence:** ${b.evidence}`,
        `**Requested capability:** ${b.requestedCapability}`,
        `**Affected workstream:** ${b.affectedWorkstream}`,
        `**Suggested resolution:** ${b.suggestedResolution ?? "none"}`,
        "",
        `Raised by @${caller.handle} through wOS.`,
      ].join("\n"),
      labels: ["wos:blocker"],
    });
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const id = uuidv7();
      await tx`insert into wos.blockers (id, target_id, account_id, abu_id, affected_contract, reason, evidence, requested_capability,
                                         affected_workstream, suggested_resolution, issue_number, state)
               values (${id}, ${t.id}, ${caller.accountId}, ${t.abu_id}, ${b.affectedContract}, ${b.reason}, ${b.evidence}, ${b.requestedCapability},
                       ${b.affectedWorkstream}, ${b.suggestedResolution}, ${issue.number}, 'open')`;
      await insertEvent(
        tx,
        { type: "blocker.opened", v: 1, visibility: "public", payload: { blockerId: id, target: b.target, issueNumber: issue.number } },
        { aggregateKind: "blocker", aggregateId: id, actor: "contributor", actorAccountId: caller.accountId },
      );
      const taskId = await newTask(
        tx,
        { kind: "conflict_resolution", state: "open", blockerId: id, targetId: t.id },
        { actor: "contributor", accountId: caller.accountId },
      );
      return { blockerId: id, issueUrl: issue.url, taskId };
    });
  },

  async githubWebhook(ctx) {
    const { deps } = ctx;
    const deliveryId = ctx.header("x-github-delivery") ?? "";
    const event = ctx.header("x-github-event") ?? "";
    if (!deliveryId || !event) throw new ApiFailure("VALIDATION_FAILED", "X-GitHub-Delivery and X-GitHub-Event are required");
    const payload = (ctx.body ?? {}) as object;
    const stored = await storeDelivery(deps, deliveryId, event, payload, sha256Of(ctx.rawBody));
    if (stored) {
      await processDelivery(deps, deliveryId);
      await runDispatch(deps).catch((err: unknown) =>
        deps.log("error", "inline dispatch failed", { error: err instanceof Error ? err.message : String(err) }),
      );
    }
    return { ok: true as const };
  },

  async cronSweep(ctx) {
    return runSweep(ctx.deps);
  },

  async cronDispatch(ctx) {
    const retried = await retryDeliveries(ctx.deps);
    const processed = await runDispatch(ctx.deps);
    return { processed: processed + retried };
  },
};
