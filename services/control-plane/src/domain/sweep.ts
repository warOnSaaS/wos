/**
 * `GET /v1/cron/sweep` (every minute): expire leases whose heartbeats stopped, lapse revision windows,
 * release held awards past their hold, end bootstrap when the exit condition holds, prune infra rows.
 */
import { inTransaction } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { insertEvent } from "../db/events.js";
import { loadAttempt } from "../views.js";
import { releaseDueAwards } from "./rewards.js";
import { afterLeaseLost, endAttempt, endLease, SYSTEM } from "./work.js";

const SYS = { kind: "system" as const, accountId: null };

export async function runSweep(deps: Deps): Promise<{ expiredLeases: number; expiredAttempts: number; released: number }> {
  let expiredLeases = 0;
  let expiredAttempts = 0;
  let released = 0;

  const due = await inTransaction(
    deps.sql,
    SYS,
    (tx) =>
      tx<{ id: string; task_id: string; account_id: string }[]>`
      select id, task_id, account_id from wos.leases where state = 'active' and expires_at <= now() order by expires_at limit 500`,
  );
  for (const l of due) {
    try {
      const r = await inTransaction(deps.sql, SYS, async (tx) => {
        // Same guarded UPDATE as a heartbeat: whichever commits first wins (expires_at re-checked inside).
        await endLease(tx, l, "expire", SYSTEM, "no heartbeat before expires_at");
        return afterLeaseLost(tx, deps, l, "expired", SYSTEM, "lease expired");
      });
      expiredLeases++;
      expiredAttempts += r.expiredAttempts;
    } catch (err) {
      if (!(err instanceof ApiFailure && err.code === "CONFLICT")) throw err;
    }
  }

  const lapsed = await inTransaction(
    deps.sql,
    SYS,
    (tx) => tx<{ id: string }[]>`select id from wos.attempts where state = 'changes_requested' and revision_deadline_at <= now() limit 500`,
  );
  for (const a of lapsed) {
    try {
      await inTransaction(deps.sql, SYS, async (tx) => {
        const attempt = await loadAttempt(tx, a.id);
        if (attempt?.state !== "changes_requested") return;
        await endAttempt(tx, deps, attempt, "lease_lapsed", SYSTEM, "revision window elapsed without a revision claim");
        expiredAttempts++;
      });
    } catch (err) {
      if (!(err instanceof ApiFailure && err.code === "CONFLICT")) throw err;
    }
  }

  // Releases (REWARD-PROTOCOL.md section 8): the pure computeReleaseDrafts over the awards past their hold.
  released = await inTransaction(deps.sql, SYS, (tx) => releaseDueAwards(tx, deps));

  await checkBootstrapExit(deps);
  await inTransaction(deps.sql, SYS, async (tx) => {
    await tx`delete from wos.idempotency_keys where expires_at <= now()`;
    await tx`delete from wos.rate_limits where window_start < now() - interval '1 day'`;
  });
  return { expiredLeases, expiredAttempts, released };
}

/** AGENT-POLICY.md section 6: for EACH slot, N distinct non-maintainer accounts with a valid attestation completed a lease recently. */
async function checkBootstrapExit(deps: Deps): Promise<void> {
  const b = deps.policy.bootstrap;
  await inTransaction(deps.sql, SYS, async (tx) => {
    const [setting] = await tx<{ value: { enabled?: boolean } }[]>`select value from wos.platform_settings where key = 'bootstrap_mode'`;
    if (setting?.value?.enabled !== true) return;
    const counts: number[] = [];
    for (const [provider, model] of [
      ["codex_cli", "astra"],
      ["claude_cli", "fable"],
    ] as const) {
      const [r] = await tx<{ n: number }[]>`
        select count(distinct l.account_id)::int as n from wos.leases l
         where l.state = 'completed' and l.ended_at > now() - make_interval(days => ${b.exitActivityWindowDays})
           and not exists (select 1 from wos.account_roles r where r.account_id = l.account_id and r.role = 'maintainer')
           and exists (select 1 from (select distinct on (p.provider) p.* from wos.provider_attestations p
                                       where p.account_id = l.account_id order by p.provider, p.created_at desc) p
                        where p.provider = ${provider} and p.signed_in and ${model} = any(p.models))`;
      counts.push(r?.n ?? 0);
    }
    if (counts.every((n) => n >= b.exitDistinctReviewersPerSlot))
      await endBootstrap(tx, "automatic: enough independent reviewers per slot", null);
  });
}

export async function endBootstrap(tx: import("@waronsaas/db").Tx, reason: string, by: string | null): Promise<boolean> {
  const updated = await tx`
    update wos.platform_settings set value = jsonb_build_object('enabled', false, 'since', value->'since', 'endedAt', now()), updated_at = now(),
           updated_by = ${by}
     where key = 'bootstrap_mode' and (value->>'enabled')::boolean is true returning key`;
  if (updated.length === 0) return false;
  await insertEvent(
    tx,
    { type: "platform.bootstrap_ended", v: 1, visibility: "public", payload: { reason } },
    { aggregateKind: "platform", aggregateId: "bootstrap_mode", actor: by ? "maintainer" : "system", actorAccountId: by },
  );
  return true;
}
