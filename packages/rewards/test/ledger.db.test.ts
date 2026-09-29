/**
 * The real rules against the real ledger (runs only with WOS_TEST_DATABASE_URL): every draft the rules
 * produce satisfies `ledger_sign_rules` and the hash chain trigger, replays write nothing, and
 * `computeBalances` agrees with `wos.v_balances`.
 */
import type { LedgerEntryDraft } from "@waronsaas/contracts";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDb, HAS_DB, type MigratedDb } from "../../db/test/support/pg.js";
import { type AwardFact, computeBalances, computeLedgerDrafts, computeReleaseDrafts } from "../src/index.js";
import { ALICE, accepted, at, BOB, contribution, ev, facts, schedule, u } from "./support.js";

describe.skipIf(!HAS_DB)("rules against the Postgres ledger", () => {
  let db: MigratedDb;
  let sql: postgres.Sql;

  beforeAll(async () => {
    db = await createMigratedDb("wos_rw");
    sql = postgres(db.ownerUrl, { max: 1, onnotice: () => {} });
    for (const [id, gh] of [
      [ALICE, 1],
      [BOB, 2],
    ] as const) {
      await sql`insert into wos.accounts (id, handle, github_user_id, github_login, github_created_at, github_linked_at, leaderboard_opt_in)
                values (${id}, ${`u${gh}`}, ${gh}, ${`u${gh}`}, now(), now(), true)`;
    }
    for (const [id, acct, cat] of [
      [u(0xc1), ALICE, "implementation"],
      [u(0xc2), BOB, "review"],
      [u(0xc3), ALICE, "roadmap_work"],
      [u(0xc4), BOB, "roadmap_work"],
    ] as const) {
      await sql`insert into wos.contributions (id, account_id, github_user_id, category, state, independence, idempotency_key, accepted_at)
                values (${id}, ${acct}, 1, ${cat}, 'accepted', 'independent', ${`k:${id}`}, now())`;
    }
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await db?.drop();
  });

  /** Inserts like the control plane's insertLedgerEntry; returns the new id or null on a replayed key. */
  async function insert(d: LedgerEntryDraft): Promise<string | null> {
    const id = crypto.randomUUID();
    const rows = await sql<{ id: string }[]>`
      insert into wos.ledger_entries (id, account_id, kind, bucket, amount, category, contribution_id, pool_id, related_entry_id, pair_id,
                                      idempotency_key, schedule_version, memo, release_after, created_by_kind, created_by_account)
      values (${id}, ${d.accountId}, ${d.kind}, ${d.bucket}, ${d.amount}, ${d.category}, ${d.contributionId}, ${d.poolId},
              ${d.relatedEntryId}, ${d.pairId}, ${d.idempotencyKey}, ${d.scheduleVersion}, ${d.memo}, ${d.releaseAfter}, 'system', null)
      on conflict (idempotency_key) do nothing returning id`;
    return rows[0]?.id ?? null;
  }

  it("persists awards, pools, releases and reversals, and replays write nothing", async () => {
    const impl = contribution({
      id: u(0xc1),
      category: "implementation",
      implementation: { attemptId: u(0xa7), abuId: u(0xab), abuKey: "contacts#01", sizePoints: 3, merged: true },
    });
    const review = contribution({
      id: u(0xc2),
      accountId: BOB,
      category: "review",
      review: {
        reviewId: u(0x7e),
        subjectKind: "implementation",
        sizePoints: 3,
        subjectAccepted: true,
        schemaValid: true,
        onTime: true,
        invalidated: false,
      },
    });
    const merged = ev({
      type: "document.merged",
      visibility: "public",
      payload: { documentId: u(0xd0c), kind: "roadmap", mergeSha: "b".repeat(40), prNumber: 3 },
    });
    const drafts = [
      ...computeLedgerDrafts(accepted(impl, at(-20)), facts({ contribution: impl }), schedule),
      ...computeLedgerDrafts(accepted(review, at(-20)), facts({ contribution: review }), schedule),
      ...computeLedgerDrafts(
        merged,
        facts({
          documentPool: {
            documentId: u(0xd0c),
            kind: "roadmap",
            authors: [
              { contributionId: u(0xc3), accountId: ALICE, acceptedRevisions: 2 },
              { contributionId: u(0xc4), accountId: BOB, acceptedRevisions: 1 },
            ],
          },
        }),
        schedule,
      ),
    ];
    const ids = new Map<string, string>();
    for (const d of drafts) ids.set(d.idempotencyKey, (await insert(d))!);
    for (const d of drafts) expect(await insert(d)).toBeNull();

    // Release the two contribution awards (hold window passed), then reverse the implementation one.
    const asFact = (key: string, d: LedgerEntryDraft): AwardFact => ({
      id: ids.get(key)!,
      accountId: d.accountId,
      amount: d.amount,
      category: d.category!,
      contributionId: d.contributionId,
      poolId: d.poolId,
      scheduleVersion: d.scheduleVersion,
      releaseAfter: d.releaseAfter!,
      released: false,
      reversed: false,
      blockedByBootstrap: false,
    });
    const implDraft = drafts.find((d) => d.category === "implementation")!;
    const reviewDraft = drafts.find((d) => d.category === "review")!;
    const awards = [asFact(implDraft.idempotencyKey, implDraft), asFact(reviewDraft.idempotencyKey, reviewDraft)];
    const releases = computeReleaseDrafts(awards, at(0));
    expect(releases).toHaveLength(4);
    for (const d of releases) expect(await insert(d)).not.toBeNull();
    for (const d of releases) expect(await insert(d)).toBeNull();

    const reversal = computeLedgerDrafts(
      ev({ type: "contribution.reversed", visibility: "public", payload: { contributionId: u(0xc1), reason: "reverted as defective" } }),
      facts({ awards: [{ ...awards[0]!, released: true }] }),
      schedule,
    );
    expect(reversal).toMatchObject([{ kind: "clawback", amount: -60 }]);
    for (const d of reversal) expect(await insert(d)).not.toBeNull();

    const all = [...drafts, ...releases, ...reversal];
    const view = await sql<{ account_id: string; held: string; available: string; score: string }[]>`
      select account_id, held, available, score from wos.v_balances where account_id in (${ALICE}, ${BOB}) order by account_id`;
    expect(
      view.map((r) => ({ accountId: r.account_id, held: Number(r.held), available: Number(r.available), score: Number(r.score) })),
    ).toEqual(computeBalances(all));
    // Alice: 60 implementation (released, then clawed back) + 667 roadmap share (held).
    expect(computeBalances(all).find((b) => b.accountId === ALICE)).toEqual({ accountId: ALICE, held: 667, available: 0, score: 667 });
  }, 60_000);
});
