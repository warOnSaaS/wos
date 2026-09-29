/**
 * GitHub webhook processing (actor `github`). Deliveries are stored first (dedupe by X-GitHub-Delivery),
 * then processed; processing is idempotent because every effect is a guarded transition.
 */
import { profileAcceptanceCheckName, Surface } from "@waronsaas/contracts";
import { inTransaction, type Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { insertEvent } from "../db/events.js";
import { uuidv7 } from "../util/crypto.js";
import { loadAttempt } from "../views.js";
import { runDispatch, unlockDependents } from "./consumers.js";
import { ingestContract, loadDocument, materialiseRoadmap, readMergedContract, readMergedRoadmap } from "./documents.js";
import { createDocumentWorkContributions, settleContributions } from "./ledger.js";
import { openRound } from "./review.js";
import { abuTransition, attemptTransition, type ActorRef, endAttempt, releaseLocks, requestChanges } from "./work.js";

const GH_TX = { kind: "github" as const, accountId: null };
const GH: ActorRef = { actor: "github", accountId: null };

interface Payload {
  action?: string;
  repository?: { full_name?: string };
  installation?: { id?: number };
  check_suite?: {
    id?: number;
    head_sha?: string;
    head_branch?: string | null;
    conclusion?: string | null;
    status?: string;
    app?: { slug?: string };
  };
  check_run?: { id?: number; name?: string; head_sha?: string; conclusion?: string | null; check_suite?: { id?: number } };
  pull_request?: { number?: number; merged?: boolean; merge_commit_sha?: string | null; user?: { login?: string; type?: string } };
}

const CONCLUSIONS = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale"]);

/** Stores a verified delivery; false when it was already stored (duplicate delivery). */
export async function storeDelivery(
  deps: Deps,
  deliveryId: string,
  event: string,
  payload: Payload,
  payloadSha256: string,
): Promise<boolean> {
  const rows = await inTransaction(
    deps.sql,
    GH_TX,
    (tx) =>
      tx`insert into wos.webhook_deliveries (delivery_id, event, action, installation_id, payload_sha256, payload)
       values (${deliveryId}, ${event}, ${payload.action ?? null}, ${payload.installation?.id ?? null}, ${payloadSha256}, ${tx.json(payload as never)})
       on conflict (delivery_id) do nothing returning delivery_id`,
  );
  return rows.length > 0;
}

/** Processes one stored delivery; records the outcome on the row. */
export async function processDelivery(deps: Deps, deliveryId: string): Promise<void> {
  const [row] = await inTransaction(
    deps.sql,
    GH_TX,
    (tx) =>
      tx<
        { event: string; payload: Payload; processed_at: Date | null }[]
      >`select event, payload, processed_at from wos.webhook_deliveries where delivery_id = ${deliveryId}`,
  );
  if (!row || row.processed_at) return;
  try {
    if (row.event === "check_suite") await onCheckSuite(deps, row.payload);
    else if (row.event === "check_run") await onCheckRun(deps, row.payload);
    else if (row.event === "pull_request") await onPullRequest(deps, row.payload);
    await inTransaction(
      deps.sql,
      GH_TX,
      (tx) => tx`update wos.webhook_deliveries set processed_at = now(), last_error = null where delivery_id = ${deliveryId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log("error", "webhook processing failed", { deliveryId, error: message });
    await inTransaction(
      deps.sql,
      GH_TX,
      (tx) =>
        tx`update wos.webhook_deliveries set attempts = attempts + 1, last_error = ${message.slice(0, 1000)} where delivery_id = ${deliveryId}`,
    );
  }
}

async function onCheckSuite(deps: Deps, p: Payload): Promise<void> {
  const cs = p.check_suite;
  if (p.action !== "completed" || !cs?.head_sha || cs.id === undefined) return;
  if (cs.app?.slug && cs.app.slug !== "github-actions") return;
  const conclusion = cs.conclusion && CONCLUSIONS.has(cs.conclusion) ? cs.conclusion : "neutral";
  await inTransaction(deps.sql, GH_TX, async (tx) => {
    const [a] = await tx<{ id: string }[]>`
      select at.id from wos.attempts at join wos.abus ab on ab.id = at.abu_id
       where at.head_sha = ${cs.head_sha!} and ab.repo_full_name = ${p.repository?.full_name ?? ""}
         and at.state not in ('merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded')
       order by at.updated_at desc limit 1`;
    if (!a) return;
    const [dupe] =
      await tx`select 1 as x from wos.verification_runs where attempt_id = ${a.id} and github_check_suite_id = ${cs.id!} and conclusion = ${conclusion}`;
    if (!dupe) {
      await tx`insert into wos.verification_runs (id, subject, attempt_id, source, head_sha, conclusion, github_check_suite_id, details)
               values (${uuidv7()}, 'attempt', ${a.id}, 'ci', ${cs.head_sha!}, ${conclusion}, ${cs.id!}, ${tx.json({ headBranch: cs.head_branch ?? null } as never)})`;
      await verificationRecorded(tx, "attempt", a.id, cs.head_sha!, conclusion);
    }
    const attempt = (await loadAttempt(tx, a.id))!;
    // Only a result for exactly the candidate head moves the attempt (BUILD-PROTOCOL.md section 8).
    if (attempt.state !== "candidate_pushed" || attempt.head_sha !== cs.head_sha) return;
    if (conclusion === "success") {
      await attemptTransition(tx, attempt, "ci_passed", GH);
      const [c] = await tx<{ submission_sha256: string; catalog_feature_id: string }[]>`
        select c.submission_sha256, ab.catalog_feature_id from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id
          join wos.abus ab on ab.id = ${attempt.abu_id} where cc.commit_sha = ${attempt.head_sha} order by c.created_at desc limit 1`;
      await openRound(
        tx,
        { kind: "implementation", attemptId: attempt.id, catalogFeatureId: c?.catalog_feature_id ?? null },
        attempt.head_sha,
        c!.submission_sha256,
        [attempt.account_id],
        GH,
      );
    } else if (conclusion === "failure" || conclusion === "timed_out") {
      await requestChanges(tx, deps, attempt, "ci_failed", GH);
    }
  });
}

/** Emits verification.recorded for a stored verification_runs row (contracts 3.0.0, B-0007-architect). */
async function verificationRecorded(
  tx: Tx,
  subject: "attempt" | "document" | "profile_acceptance",
  subjectId: string,
  headSha: string,
  conclusion: string,
  surface: string | null = null,
): Promise<void> {
  await insertEvent(
    tx,
    { type: "verification.recorded", v: 1, visibility: "public", payload: { subject, subjectId, headSha, conclusion, surface } },
    { aggregateKind: "verification", aggregateId: subjectId, actor: "github", actorAccountId: null },
  );
}

/**
 * Profile acceptance (ROADMAP-PROTOCOL.md section 6): a concluded check run named
 * profileAcceptanceCheckName(feature, target) on the default branch is recorded; the progress consumer follows.
 */
async function onCheckRun(deps: Deps, p: Payload): Promise<void> {
  const run = p.check_run;
  const repo = p.repository?.full_name;
  if (p.action !== "completed" || !run?.name || !run.head_sha || !repo) return;
  // contracts 4.0.0 (D13): one check per surface, wos-acceptance/<feature>/<target>/<surface>.
  const m = /^wos-acceptance\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/([a-z_]+)$/.exec(run.name);
  if (!m || !Surface.safeParse(m[3]).success || profileAcceptanceCheckName(m[1]!, m[2]!, m[3]!) !== run.name) return;
  const conclusion = run.conclusion && CONCLUSIONS.has(run.conclusion) ? run.conclusion : "neutral";
  const suiteId = run.check_suite?.id ?? run.id;
  if (suiteId === undefined) return;
  await inTransaction(deps.sql, GH_TX, async (tx) => {
    const [ids] = await tx<{ feature_id: string; target_id: string }[]>`
      select f.id as feature_id, t.id as target_id from wos.catalog_features f, wos.targets t
       where f.key = ${m[1]!} and f.repo_full_name = ${repo} and t.slug = ${m[2]!}`;
    if (!ids) return;
    const [dupe] = await tx`
      select 1 as x from wos.verification_runs where subject = 'profile_acceptance' and catalog_feature_id = ${ids.feature_id}
         and profile_target_id = ${ids.target_id} and surface = ${m[3]!} and head_sha = ${run.head_sha!} and github_check_suite_id = ${suiteId} and conclusion = ${conclusion}`;
    if (dupe) return;
    await tx`insert into wos.verification_runs (id, subject, catalog_feature_id, profile_target_id, surface, source, head_sha, conclusion, github_check_suite_id, details)
             values (${uuidv7()}, 'profile_acceptance', ${ids.feature_id}, ${ids.target_id}, ${m[3]!}, 'ci', ${run.head_sha!}, ${conclusion}, ${suiteId},
                     ${tx.json({ checkRunId: run.id ?? null, name: run.name } as never)})`;
    await verificationRecorded(tx, "profile_acceptance", `${m[1]}/${m[2]}/${m[3]}`, run.head_sha!, conclusion, m[3]!);
  });
}

async function onPullRequest(deps: Deps, p: Payload): Promise<void> {
  const pr = p.pull_request;
  const repo = p.repository?.full_name;
  if (!pr?.number || !repo) return;
  // S-18 fallback: any PR not opened by the App is closed and locked.
  if ((p.action === "opened" || p.action === "reopened") && pr.user?.login !== deps.config.appBotLogin) {
    await deps.github.closePullRequest(repo, pr.number, {
      comment:
        "warOnSaaS pull requests are opened only by the wOS GitHub App after qualification. Contribute with wOS: https://waronsaas.com",
      lock: true,
    });
    return;
  }
  if (p.action !== "closed") return;
  const [row] = await inTransaction(
    deps.sql,
    GH_TX,
    (tx) =>
      tx<{ id: string; kind: string; attempt_id: string | null; document_id: string | null; state: string }[]>`
      select id, kind, attempt_id, document_id, state from wos.pull_requests where repo_full_name = ${repo} and number = ${pr.number!}`,
  );
  if (row?.state !== "open") return;
  const mergeSha = pr.merge_commit_sha ?? null;
  if (row.kind === "implementation") {
    await inTransaction(deps.sql, GH_TX, async (tx) => {
      const attempt = await loadAttempt(tx, row.attempt_id!);
      if (attempt?.state !== "pr_open") return;
      if (pr.merged && mergeSha) {
        await tx`update wos.pull_requests set state = 'merged', merged_sha = ${mergeSha}, merged_at = now(), updated_at = now() where id = ${row.id}`;
        await attemptTransition(tx, attempt, "pr_merged", GH, { merged_sha: mergeSha });
        await releaseLocks(tx, attempt.id);
        const [abu] = await tx<
          { id: string; key: string; state: string }[]
        >`select id, key, state from wos.abus where id = ${attempt.abu_id}`;
        if (abu?.state === "in_progress") await abuTransition(tx, abu, "attempt_merged", GH);
        await insertEvent(
          tx,
          {
            type: "attempt.merged",
            v: 1,
            visibility: "public",
            payload: { attemptId: attempt.id, abu: attempt.abu_key, mergeSha, prNumber: pr.number! },
          },
          { aggregateKind: "attempt", aggregateId: attempt.id, actor: "github", actorAccountId: null },
        );
        await unlockDependents(tx, attempt.abu_id);
        await settleContributions(tx, { attemptId: attempt.id }, "accept", "github", "PR merged");
      } else {
        await tx`update wos.pull_requests set state = 'closed', updated_at = now() where id = ${row.id}`;
        await endAttempt(tx, deps, attempt, "pr_closed", GH, "pull request closed without merge");
        await settleContributions(tx, { attemptId: attempt.id }, "reject", "system", "PR closed without merge");
      }
    });
  } else if (row.document_id) {
    if (!pr.merged || !mergeSha) {
      await inTransaction(
        deps.sql,
        GH_TX,
        (tx) => tx`update wos.pull_requests set state = 'closed', updated_at = now() where id = ${row.id}`,
      );
      return;
    }
    const doc = await inTransaction(deps.sql, GH_TX, (tx) => loadDocument(tx, row.document_id!));
    if (doc?.state !== "consensus") return;
    // Parse at the merge commit before the transaction (network), then ingest all-or-nothing.
    const files = doc.kind === "roadmap" ? await readMergedRoadmap(deps, doc, mergeSha) : await readMergedContract(deps, doc, mergeSha);
    await inTransaction(deps.sql, GH_TX, async (tx) => {
      await tx`update wos.pull_requests set state = 'merged', merged_sha = ${mergeSha}, merged_at = now(), updated_at = now() where id = ${row.id}`;
      const fresh = await loadDocument(tx, doc.id);
      if (fresh?.state !== "consensus") throw new ApiFailure("CONFLICT", "document left consensus");
      if (fresh.kind === "roadmap")
        await materialiseRoadmap(
          tx,
          deps,
          fresh,
          { sha: mergeSha, prNumber: pr.number! },
          files as Awaited<ReturnType<typeof readMergedRoadmap>>,
        );
      else
        await ingestContract(
          tx,
          deps,
          fresh,
          { sha: mergeSha, prNumber: pr.number! },
          files as Awaited<ReturnType<typeof readMergedContract>>,
        );
      await createDocumentWorkContributions(tx, doc.id, doc.kind);
      await settleContributions(tx, { documentId: doc.id }, "accept", "github", "document merged");
    });
  }
}

/** Retries stored deliveries that failed, then runs the consumers. */
export async function retryDeliveries(deps: Deps): Promise<number> {
  const rows = await inTransaction(
    deps.sql,
    GH_TX,
    (tx) =>
      tx<
        { delivery_id: string }[]
      >`select delivery_id from wos.webhook_deliveries where processed_at is null and attempts < 20 order by received_at limit 100`,
  );
  for (const r of rows) await processDelivery(deps, r.delivery_id);
  return rows.length;
}

export { runDispatch };
