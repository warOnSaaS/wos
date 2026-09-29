/**
 * Adversarial suite, database layer (security-hardening). Every test attacks a control from SECURITY.md
 * and fails if the control is removed from packages/db/migrations. The five tests marked "formerly KNOWN
 * GAP" were it.fails before migration 0002 (B-0003-verification) and are now plain tests.
 * Mutation check: WOS_VERIFY_MUTATION_SQL (see support/db.ts) removes a control; docs/dogfood/verification.md
 * records which tests turned red.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scopesOverlap } from "../../packages/verification/src/index.js";
import { asActor, DB_REASON, failure, freshDatabase, id, PLATFORM_REPO_NAME, Pipeline, SUITE_REPO, type Sql } from "./support/db.js";

const APPEND_ONLY = [
  "github_identity_history",
  "provider_attestations",
  "context_manifests",
  "agent_runs",
  "changesets",
  "candidate_commits",
  "reviews",
  "finding_responses",
  "verification_runs",
  "provenance_records",
  "ledger_entries",
  "progress_snapshots",
  "events",
  "event_consumptions",
  "inventory_items",
];

describe.skipIf(!process.env.WOS_VERIFY_DATABASE_URL)(`security-hardening: database controls${DB_REASON}`, () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let p: Pipeline;

  beforeAll(async () => {
    ({ sql, drop } = await freshDatabase());
    p = await new Pipeline(sql).seed();
  }, 60_000);
  afterAll(async () => {
    await drop?.();
  });

  // ---- S-9 / S-11 row-level security ------------------------------------------------------------------
  describe("S-9 / S-11: sealed verdicts and private rows", () => {
    it("reviewer seeing the other slot: carol (fable) cannot read bob's sealed astra verdict or its findings", async () => {
      const r = await p.openRound(p.A.alice);
      const bob = await p.reviewLease(r.tasks.astra, p.A.bob);
      await p.reviewLease(r.tasks.fable, p.A.carol);
      const [rv] = await p.review(r.round, "astra", bob, { verdict: "MATERIAL_GAPS" });
      await sql`insert into wos.findings (review_id, round_id, attempt_id, local_id, severity, category, title, detail, state)
                values (${rv!.id}, ${r.round}, ${r.attempt}, 'f1', 'material', 'security', 'sealed', 'sealed detail', 'open')`;
      const seen = (who: string) =>
        asActor(sql, "contributor", who, async (tx) => ({
          reviews: (await tx`select 1 from wos.reviews where round_id = ${r.round}`).length,
          findings: (await tx`select 1 from wos.findings where round_id = ${r.round}`).length,
        }));
      expect(await seen(p.A.carol)).toEqual({ reviews: 0, findings: 0 });
      expect(await seen(p.A.alice)).toEqual({ reviews: 0, findings: 0 });
      expect(await seen(p.A.bob)).toEqual({ reviews: 1, findings: 1 });
      expect(await asActor(sql, "anonymous", null, async (tx) => (await tx`select 1 from wos.reviews`).length)).toBe(0);
    });

    it("a contributor cannot insert a review as another account (RLS on reviews and on the leases the trigger reads)", async () => {
      const r = await p.openRound(p.A.alice);
      const carol = await p.reviewLease(r.tasks.fable, p.A.carol);
      const err = await failure(asActor(sql, "contributor", p.A.dave, (tx) => p.review(r.round, "fable", carol, {}, tx)));
      expect(err).toMatch(/row-level security|is not the active lease/);
      // the same row as carol herself is accepted, so the refusal above is about the actor
      expect(await failure(asActor(sql, "contributor", p.A.carol, (tx) => p.review(r.round, "fable", carol, {}, tx)))).toBeNull();
    });

    it("a contributor cannot write findings (privileged only)", async () => {
      const err = await failure(
        asActor(
          sql,
          "contributor",
          p.A.bob,
          (tx) => tx`insert into wos.findings (review_id, round_id, attempt_id, local_id, severity, category, title, detail, state)
          select id, round_id, ${id(1)}, 'f9', 'minor', 'other', 't', 'd', 'resolved' from wos.reviews limit 1`,
        ),
      );
      expect(err).toMatch(/row-level security|violates/);
    });

    it("private rows: another account's leases, devices and emails are invisible", async () => {
      const seen = await asActor(sql, "contributor", p.A.dave, async (tx) => ({
        leases: (await tx`select account_id from wos.leases`).map((x) => x.account_id),
        devices: (await tx`select account_id from wos.devices`).map((x) => x.account_id),
        emails: (await tx`select account_id from wos.account_emails`).map((x) => x.account_id),
      }));
      for (const rows of Object.values(seen)) for (const acc of rows) expect(acc).toBe(p.A.dave);
      expect(seen.devices).toHaveLength(1);
    });

    it("sessions and sign-in requests are visible to the system actor only", async () => {
      await sql`insert into wos.sessions (family_id, account_id, client_kind, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at)
                values (${id(990)}, ${p.A.dave}, 'cli', '\\x01', now() + interval '1 hour', '\\x02', now() + interval '30 days')`;
      await sql`insert into wos.email_signin_requests (email_normalized, client_kind, link_token_hash, code_hash, poll_secret_hash, expires_at)
                values ('dave@example.com', 'cli', '\\x03', '\\x04', '\\x05', now() + interval '10 minutes')`;
      const own = await asActor(sql, "contributor", p.A.dave, async (tx) => [
        (await tx`select 1 from wos.sessions`).length,
        (await tx`select 1 from wos.email_signin_requests`).length,
      ]);
      expect(own).toEqual([0, 0]);
      expect(await asActor(sql, "system", null, async (tx) => (await tx`select 1 from wos.sessions`).length)).toBe(1);
    });

    it("the app role cannot bypass RLS and does not own the tables", async () => {
      const [r] = await sql`select rolbypassrls, rolsuper from pg_roles where rolname = 'wos_app'`;
      expect(r).toMatchObject({ rolbypassrls: false, rolsuper: false });
      expect(await sql`select tablename from pg_tables where schemaname = 'wos' and tableowner = 'wos_app'`).toHaveLength(0);
      const noRls = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'wos' and c.relkind = 'r' and not c.relrowsecurity`;
      expect(noRls.map((x) => x.relname)).toEqual([]);
    });

    it("formerly KNOWN GAP (B-0003): a private event is readable only by the account it concerns", async () => {
      await sql`insert into wos.events (type, visibility, aggregate_kind, aggregate_id, actor_account_id, actor_kind, payload, contracts_version)
                values ('account.email_changed', 'private', 'account', ${p.A.alice}, ${p.A.alice}, 'contributor', '{"email":"alice@example.com"}', '3.0.0')`;
      const count = (who: string) =>
        asActor(sql, "contributor", who, async (tx) => (await tx`select 1 from wos.events where visibility = 'private'`).length);
      expect(await count(p.A.dave)).toBe(0);
      expect(await count(p.A.alice)).toBe(1);
    });
  });

  // ---- S-10 append-only ------------------------------------------------------------------------------
  describe("S-10: append-only records", () => {
    it.each(APPEND_ONLY)(
      "%s: forbid_mutation triggers for UPDATE/DELETE and TRUNCATE exist and are enabled; wos_app has no UPDATE/DELETE/TRUNCATE",
      async (t) => {
        const trig = await sql`select t.tgtype, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
                             join pg_proc f on f.oid = t.tgfoid where c.relname = ${t} and f.proname = 'forbid_mutation' and not t.tgisinternal`;
        // tgtype bits: 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE
        const bits = trig.filter((x) => x.tgenabled !== "D").reduce((acc, x) => acc | Number(x.tgtype), 0);
        expect(bits & 8 && bits & 16 && bits & 32, `triggers on ${t}`).toBeTruthy();
        const [g] =
          await sql`select has_table_privilege('wos_app', ${`wos.${t}`}, 'UPDATE') u, has_table_privilege('wos_app', ${`wos.${t}`}, 'DELETE') d,
                                   has_table_privilege('wos_app', ${`wos.${t}`}, 'TRUNCATE') tr`;
        expect(g).toEqual({ u: false, d: false, tr: false });
      },
    );

    it("the table owner cannot rewrite a sealed verdict, a manifest or an event", async () => {
      await sql`insert into wos.events (type, visibility, aggregate_kind, aggregate_id, actor_kind, payload, contracts_version) values ('abu.state_changed', 'public', 'abu', 'x', 'system', '{}', '3.0.0')`;
      expect(await failure(sql`update wos.reviews set verdict = 'NO_MATERIAL_GAPS'`)).toMatch(/append-only/);
      expect(await failure(sql`delete from wos.context_manifests`)).toMatch(/append-only/);
      expect(await failure(sql`update wos.events set payload = '{"forged":true}'`)).toMatch(/append-only/);
      expect(await failure(sql`truncate wos.events cascade`)).toMatch(/append-only/);
    });

    it("the migration ledger is append-only too", async () => {
      await sql`insert into wos_meta.schema_migrations (version, name, checksum, execution_ms) values ('9999', 'probe', ${`sha256:${"0".repeat(64)}`}, 1)`;
      expect(await failure(sql`update wos_meta.schema_migrations set checksum = 'x' where version = '9999'`)).not.toBeNull();
      expect(await failure(sql`delete from wos_meta.schema_migrations where version = '9999'`)).not.toBeNull();
    });
  });

  // ---- S-12 independence ----------------------------------------------------------------------------
  describe("S-12: reviewer independence (DB backstop)", () => {
    it("self-review outside bootstrap: the builder cannot review their own attempt", async () => {
      const r = await p.openRound(p.A.erin);
      const erin = await p.reviewLease(r.tasks.fable, p.A.erin);
      expect(await failure(p.review(r.round, "fable", erin))).toMatch(/authored the subject/);
    });

    it("a bootstrap_maintainer label does not let a maintainer review their own attempt", async () => {
      const r = await p.openRound(p.A.founder);
      const founder = await p.reviewLease(r.tasks.astra, p.A.founder);
      expect(await failure(p.review(r.round, "astra", founder, { independence: "bootstrap_maintainer" }))).toMatch(/authored the subject/);
    });

    it("the same account cannot fill both slots of a round (independent)", async () => {
      const r = await p.openRound(p.A.alice);
      await p.review(r.round, "astra", await p.reviewLease(r.tasks.astra, p.A.dave));
      const err = await failure(p.review(r.round, "fable", await p.reviewLease(r.tasks.fable, p.A.dave)));
      expect(err).toMatch(/distinct reviewers/);
    });

    it("bootstrap_self from a non-maintainer is refused even during bootstrap", async () => {
      const r = await p.openRound(p.A.erin);
      const erin = await p.reviewLease(r.tasks.astra, p.A.erin);
      expect(await failure(p.review(r.round, "astra", erin, { independence: "bootstrap_self" }))).toMatch(/non-maintainer/);
    });

    it("positive control: during bootstrap the founder's bootstrap_self reviews of their own round are accepted in both slots", async () => {
      const r = await p.openRound(p.A.founder);
      await p.review(r.round, "astra", await p.reviewLease(r.tasks.astra, p.A.founder), { independence: "bootstrap_self" });
      await p.review(r.round, "fable", await p.reviewLease(r.tasks.fable, p.A.founder), { independence: "bootstrap_self" });
      expect((await sql`select 1 from wos.reviews where round_id = ${r.round}`).length).toBe(2);
    });
  });

  // ---- S-23 / S-13 binding ---------------------------------------------------------------------------
  describe("S-23 / S-13: a verdict is bound to its round, task, lease, manifest and signed agent run", () => {
    it("a verdict for a different head sha or diff hash is rejected", async () => {
      const r = await p.openRound(p.A.alice);
      const carol = await p.reviewLease(r.tasks.fable, p.A.carol);
      expect(await failure(p.review(r.round, "fable", carol, { head: "d".repeat(40) }))).toMatch(/bound to/);
      expect(await failure(p.review(r.round, "fable", carol, { hash: `sha256:${"5".repeat(64)}` }))).toMatch(/bound to/);
    });

    it("no verdict can enter a round that is no longer awaiting reviews", async () => {
      const r = await p.openRound(p.A.alice);
      const carol = await p.reviewLease(r.tasks.fable, p.A.carol);
      await sql`update wos.rounds set state = 'cancelled' where id = ${r.round}`;
      expect(await failure(p.review(r.round, "fable", carol))).toMatch(/cannot accept a review/);
    });

    it("formerly KNOWN GAP (B-0003): fabricated verdict for another round — a lease for round X cannot post into round Y", async () => {
      // Same head and diff hash (both public), so only the task/lease-to-round binding stops it.
      const x = await p.openRound(p.A.erin);
      const y = await p.openRound(p.A.alice);
      const dave = await p.reviewLease(x.tasks.astra, p.A.dave);
      expect(await failure(p.review(y.round, "astra", dave))).toMatch(/not the astra review task of round/);
    });

    it("formerly KNOWN GAP (B-0003): a review whose slot differs from its task's reviewer_slot is rejected", async () => {
      const r = await p.openRound(p.A.alice);
      const carol = await p.reviewLease(r.tasks.fable, p.A.carol);
      expect(await failure(p.review(r.round, "astra", carol, { verdict: "MATERIAL_GAPS" }))).toMatch(/review task of round/);
    });

    it("a review on someone else's lease is rejected", async () => {
      const r = await p.openRound(p.A.alice);
      const bob = await p.reviewLease(r.tasks.astra, p.A.bob);
      const run = await p.forgeRun(bob.lease, bob.manifest, p.A.carol);
      expect(await failure(p.review(r.round, "astra", bob, { account: p.A.carol, run }))).toMatch(/active lease of task/);
    });

    it("a review citing another lease's manifest is rejected", async () => {
      const r = await p.openRound(p.A.alice);
      const bob = await p.reviewLease(r.tasks.astra, p.A.bob);
      const carol = await p.reviewLease(r.tasks.fable, p.A.carol);
      const run = await p.forgeRun(bob.lease, carol.manifest, p.A.bob);
      expect(await failure(p.review(r.round, "astra", bob, { manifest: carol.manifest, run }))).toMatch(/does not belong to lease/);
    });

    it("a review citing another lease's agent run is rejected (0003)", async () => {
      const r = await p.openRound(p.A.alice);
      const bob = await p.reviewLease(r.tasks.astra, p.A.bob);
      const carol = await p.reviewLease(r.tasks.fable, p.A.carol);
      expect(await failure(p.review(r.round, "astra", bob, { run: carol.run }))).toMatch(/not a valid signed run/);
    });

    it("S-13: a review citing an agent run whose signature did not verify is rejected (0003)", async () => {
      const r = await p.openRound(p.A.alice);
      const bob = await p.reviewLease(r.tasks.astra, p.A.bob, { signatureValid: false });
      expect(await failure(p.review(r.round, "astra", bob))).toMatch(/not a valid signed run/);
    });

    it("one agent run backs at most one review", async () => {
      const r = await p.openRound(p.A.alice);
      const bob = await p.reviewLease(r.tasks.astra, p.A.bob);
      await p.review(r.round, "astra", bob);
      const r2 = await p.openRound(p.A.erin);
      const bob2 = await p.reviewLease(r2.tasks.astra, p.A.bob);
      expect(await failure(p.review(r2.round, "astra", bob2, { run: bob.run }))).not.toBeNull();
    });
  });

  // ---- repository consistency (0003) ------------------------------------------------------------------
  describe("repository consistency: every document, catalog feature and ABU lives in its parent's repo (0003)", () => {
    it("the TGT-00 roadmap outside the platform repo is rejected; inside it is accepted", async () => {
      const [t] = await sql`select id, repo_full_name from wos.targets where slug = 'waronsaas'`;
      expect(t!.repo_full_name).toBe(PLATFORM_REPO_NAME);
      const insert = (repo: string) =>
        sql`insert into wos.documents (kind, target_id, version, state, branch, repo_full_name) values ('roadmap', ${t!.id}, 1, 'drafting', 'wos/roadmap/waronsaas/v1', ${repo})`;
      expect(await failure(insert(SUITE_REPO))).toMatch(/parent is in waronsaas\/wos/);
      expect(await failure(insert(PLATFORM_REPO_NAME))).toBeNull();
    });

    it("an ABU in a different repo from its feature contract is rejected", async () => {
      const err = await failure(
        sql`insert into wos.abus (catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens, repo_full_name)
            values (${id(201)}, ${id(202)}, 'contacts#90', 'x', 1, 'ready', '{}', 1, ${PLATFORM_REPO_NAME})`,
      );
      expect(err).toMatch(/abus row is in repo/);
    });

    it("a catalog feature created by a roadmap of another repo is rejected", async () => {
      const err = await failure(
        sql`insert into wos.catalog_features (key, title, summary, state, created_by_document_id, repo_full_name)
            values ('audit-log', 'Audit log', 's', 'active', ${id(200)}, ${PLATFORM_REPO_NAME})`,
      );
      expect(err).toMatch(/catalog_features row is in repo/);
    });

    it("moving an existing ABU to another repo is rejected", async () => {
      const abu = await p.abu();
      expect(await failure(sql`update wos.abus set repo_full_name = ${PLATFORM_REPO_NAME} where id = ${abu}`)).toMatch(/row is in repo/);
    });
  });

  // ---- S-32: device keys ---------------------------------------------------------------------------
  describe("S-32: only raw 32-byte Ed25519 device keys are stored (C-5)", () => {
    it.each([
      ["SPKI DER", Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.alloc(32, 1)]).toString("base64")],
      ["PEM", "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----"],
      ["31 bytes", Buffer.alloc(31, 1).toString("base64")],
      ["unpadded", Buffer.alloc(32, 1).toString("base64").replace(/=+$/, "")],
    ])("rejects a %s key", async (_, key) => {
      expect(
        await failure(sql`insert into wos.devices (account_id, name, client_kind, public_key) values (${p.A.dave}, 'x', 'cli', ${key})`),
      ).toMatch(/devices_public_key_raw_ed25519/);
    });
  });

  // ---- 20 simultaneous builders -------------------------------------------------------------------
  describe("leases-and-locks: 20 simultaneous builders (DB constraints under real concurrency)", () => {
    const race = <T>(n: number, fn: (i: number) => Promise<T>) => Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
    let attempt: string;
    beforeAll(async () => {
      attempt = (await p.openRound(p.A.erin)).attempt;
    });

    it("20 parallel active leases on one task: exactly one wins", async () => {
      const abu = await p.abu();
      const [t] =
        await sql`insert into wos.tasks (kind, state, role, catalog_feature_id, abu_id) values ('abu_build', 'open', 'builder', ${id(201)}, ${abu}) returning id`;
      const results = await race(
        20,
        (i) =>
          sql`insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
            values (${t!.id}, ${p.A.dave}, ${p.device(p.A.dave)}, 'active', ${sql.json({ i })}, now() + interval '30 minutes', now() + interval '3 hours')`,
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    }, 30_000);

    it("20 parallel live attempts on one ABU: exactly one wins", async () => {
      const abu = await p.abu();
      const results = await race(
        20,
        () =>
          sql`insert into wos.attempts (abu_id, account_id, github_user_id, state, base_sha) values (${abu}, ${p.A.dave}, 1, 'leased', ${"a".repeat(40)})`,
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    }, 30_000);

    it("20 parallel identical exclusive resource locks (e.g. db:migrations): exactly one wins", async () => {
      const results = await race(
        20,
        () =>
          sql`insert into wos.resource_locks (repo_full_name, attempt_id, resource_key, mode) values (${SUITE_REPO}, ${attempt}, 'db:migrations', 'exclusive')`,
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    }, 30_000);

    /**
     * BUILD-PROTOCOL.md section 3 steps 2 and 5 run by 20 builders at once over 20 ABUs with deliberately
     * overlapping scopes; a sleep between check and insert forces the worst interleaving. With the advisory
     * lock the invariant holds; without it the schema alone admits overlapping path locks, which proves the
     * lock (control-plane code) is load-bearing and the DB is not a backstop for prefix overlap.
     */
    const scopes = Array.from({ length: 20 }, (_, i) =>
      i < 10 ? `modules/race${i}/**` : i < 15 ? `modules/race${i - 10}/sub${i}.ts` : `modules/race${i - 15}/**`,
    );
    async function claimAll(withLock: boolean, repo: string) {
      return race(20, (i) =>
        sql.begin(async (tx) => {
          if (withLock) await tx`select pg_advisory_xact_lock(hashtext(${`wos.locks:${repo}`}))`;
          const scope = scopes[i]!;
          const live =
            await tx`select resource_key from wos.resource_locks where repo_full_name = ${repo} and released_at is null and resource_key like 'path:%'`;
          await tx`select pg_sleep(0.05)`;
          const conflict = live.find((l) => scopesOverlap(String(l.resource_key).slice(5), scope));
          if (conflict) throw new Error(`RESOURCE_LOCKED by ${conflict.resource_key}`);
          const tree = scope.endsWith("/**");
          await tx`insert into wos.resource_locks (repo_full_name, attempt_id, resource_key, mode, path_prefix, path_is_tree)
                   values (${repo}, ${attempt}, ${`path:${scope}`}, 'exclusive', ${tree ? scope.slice(0, -3) : scope}, ${tree})`;
        }),
      );
    }
    const overlappingPairs = async (repo: string) => {
      const locks = (await sql`select resource_key from wos.resource_locks where repo_full_name = ${repo} and released_at is null`).map(
        (r) => String(r.resource_key).slice(5),
      );
      const pairs: string[] = [];
      for (let i = 0; i < locks.length; i++)
        for (let j = i + 1; j < locks.length; j++) if (scopesOverlap(locks[i]!, locks[j]!)) pairs.push(`${locks[i]} x ${locks[j]}`);
      return { locks, pairs };
    };

    it("with the per-repo advisory lock: no two live path locks overlap, and every disjoint scope is granted", async () => {
      const results = await claimAll(true, "waronsaas/race-locked");
      const { locks, pairs } = await overlappingPairs("waronsaas/race-locked");
      expect(pairs).toEqual([]);
      expect(locks.length).toBe(results.filter((r) => r.status === "fulfilled").length);
      expect(locks.length).toBe(10);
      for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/RESOURCE_LOCKED/);
    }, 30_000);

    it("without the advisory lock the schema admits overlapping path locks (the lock is load-bearing)", async () => {
      await claimAll(false, "waronsaas/race-unlocked");
      expect((await overlappingPairs("waronsaas/race-unlocked")).pairs.length).toBeGreaterThan(0);
    }, 30_000);
  });

  // ---- S-31 bootstrap: LAST, because leaving bootstrap is one-way --------------------------------------
  describe("S-31: bootstrap mode is one-way and its labels need it", () => {
    it("platform settings cannot be deleted", async () => {
      expect(await failure(sql`delete from wos.platform_settings where key = 'bootstrap_mode'`)).not.toBeNull();
    });

    it("formerly KNOWN GAP (B-0003): bootstrap cannot be re-entered once ended", async () => {
      await asActor(
        sql,
        "system",
        null,
        (tx) => tx`update wos.platform_settings set value = '{"enabled": false, "since": null}' where key = 'bootstrap_mode'`,
      );
      const err = await failure(
        asActor(
          sql,
          "system",
          null,
          (tx) => tx`update wos.platform_settings set value = '{"enabled": true, "since": null}' where key = 'bootstrap_mode'`,
        ),
      );
      expect(err).toMatch(/cannot be re-entered/);
      expect(await failure(sql`update wos.platform_settings set value = '{"enabled": true}' where key = 'bootstrap_mode'`)).toMatch(
        /cannot be re-entered/,
      );
    });

    it("formerly KNOWN GAP (B-0003): after bootstrap ends, a maintainer's bootstrap_self or bootstrap_maintainer review is rejected", async () => {
      const own = await p.openRound(p.A.founder);
      const self = await p.reviewLease(own.tasks.astra, p.A.founder);
      expect(await failure(p.review(own.round, "astra", self, { independence: "bootstrap_self" }))).toMatch(/outside bootstrap mode/);
      const other = await p.openRound(p.A.alice);
      const m = await p.reviewLease(other.tasks.fable, p.A.founder);
      expect(await failure(p.review(other.round, "fable", m, { independence: "bootstrap_maintainer" }))).toMatch(/outside bootstrap mode/);
    });
  });
});
