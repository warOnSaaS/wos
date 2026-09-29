/**
 * Adversarial suite, database layer (security-hardening). Every test attacks a control from SECURITY.md
 * and fails if the control is removed from packages/db/migrations. Tests named "KNOWN GAP (B-nnnn)" use
 * it.fails: they assert the control SHOULD hold, currently do not, and turn red the moment the architect
 * closes the gap, so the marker is removed on purpose.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scopesOverlap } from "../../src/index.js";
import {
  asActor,
  DB_REASON,
  failure,
  freshDatabase,
  HASH,
  HEAD,
  id,
  insertReview,
  type Seed,
  type Sql,
  seedPipeline,
} from "./support/db.js";

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
  let s: Seed;

  beforeAll(async () => {
    ({ sql, drop } = await freshDatabase());
    s = await seedPipeline(sql);
  }, 60_000);
  afterAll(async () => {
    await drop?.();
  });

  // ---- S-9 row-level security ---------------------------------------------------------------------
  describe("S-9 / S-11: sealed verdicts and private rows", () => {
    it("reviewer seeing the other slot: carol (fable) cannot read bob's sealed astra verdict or its findings", async () => {
      await sql.begin(async (tx) => {
        const [rv] = await insertReview(tx, {
          round: s.rounds.alice,
          task: s.tasks.bobAstra,
          lease: s.leases.bob,
          account: s.A.bob,
          slot: "astra",
          manifest: s.manifests.bob,
          verdict: "MATERIAL_GAPS",
        });
        await tx`insert into wos.findings (review_id, round_id, attempt_id, local_id, severity, category, title, detail, state)
                 values (${rv!.id}, ${s.rounds.alice}, ${s.attempts.alice}, 'f1', 'material', 'security', 'sealed', 'sealed detail', 'open')`;
      });
      const carol = await asActor(sql, "contributor", s.A.carol, async (tx) => ({
        reviews: (await tx`select * from wos.reviews where round_id = ${s.rounds.alice}`).length,
        findings: (await tx`select * from wos.findings where round_id = ${s.rounds.alice}`).length,
      }));
      expect(carol).toEqual({ reviews: 0, findings: 0 });
      const bob = await asActor(
        sql,
        "contributor",
        s.A.bob,
        async (tx) => (await tx`select * from wos.reviews where round_id = ${s.rounds.alice}`).length,
      );
      expect(bob).toBe(1);
      // the builder cannot peek either
      const alice = await asActor(sql, "contributor", s.A.alice, async (tx) => (await tx`select * from wos.reviews`).length);
      expect(alice).toBe(0);
    });

    it("an unauthenticated (anonymous) actor sees no sealed review", async () => {
      expect(await asActor(sql, "anonymous", null, async (tx) => (await tx`select * from wos.reviews`).length)).toBe(0);
    });

    it("a contributor cannot insert a review as another account", async () => {
      const err = await failure(
        asActor(sql, "contributor", s.A.dave, (tx) =>
          insertReview(tx, {
            round: s.rounds.alice,
            task: s.tasks.carolFable,
            lease: s.leases.carol,
            account: s.A.carol,
            slot: "fable",
            manifest: s.manifests.carol,
          }),
        ),
      );
      expect(err).toMatch(/row-level security/);
    });

    it("a contributor cannot write findings (privileged only)", async () => {
      const err = await failure(
        asActor(
          sql,
          "contributor",
          s.A.bob,
          (tx) => tx`insert into wos.findings (review_id, round_id, attempt_id, local_id, severity, category, title, detail, state)
          select id, round_id, ${s.attempts.alice}, 'f9', 'minor', 'other', 't', 'd', 'resolved' from wos.reviews limit 1`,
        ),
      );
      expect(err).toMatch(/row-level security|violates/);
    });

    it("private rows: another account's leases, devices and emails are invisible", async () => {
      const seen = await asActor(sql, "contributor", s.A.dave, async (tx) => ({
        leases: (await tx`select account_id from wos.leases`).map((r) => r.account_id),
        devices: (await tx`select account_id from wos.devices`).map((r) => r.account_id),
        emails: (await tx`select account_id from wos.account_emails`).map((r) => r.account_id),
      }));
      expect(new Set(seen.leases)).toEqual(new Set([s.A.dave]));
      expect(new Set(seen.devices)).toEqual(new Set([s.A.dave]));
      expect(new Set(seen.emails)).toEqual(new Set([s.A.dave]));
    });

    it("sessions and sign-in requests are visible to the system actor only", async () => {
      await sql`insert into wos.sessions (family_id, account_id, client_kind, access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at)
                values (${id(990)}, ${s.A.dave}, 'cli', '\\x01', now() + interval '1 hour', '\\x02', now() + interval '30 days')`;
      await sql`insert into wos.email_signin_requests (email_normalized, client_kind, link_token_hash, code_hash, poll_secret_hash, expires_at)
                values ('dave@example.com', 'cli', '\\x03', '\\x04', '\\x05', now() + interval '10 minutes')`;
      const own = await asActor(sql, "contributor", s.A.dave, async (tx) => [
        (await tx`select 1 from wos.sessions`).length,
        (await tx`select 1 from wos.email_signin_requests`).length,
      ]);
      expect(own).toEqual([0, 0]);
      expect(await asActor(sql, "system", null, async (tx) => (await tx`select 1 from wos.sessions`).length)).toBe(1);
    });

    it("the app role cannot bypass RLS and does not own the tables", async () => {
      const [r] = await sql`select rolbypassrls, rolsuper from pg_roles where rolname = 'wos_app'`;
      expect(r).toMatchObject({ rolbypassrls: false, rolsuper: false });
      const owned = await sql`select tablename from pg_tables where schemaname = 'wos' and tableowner = 'wos_app'`;
      expect(owned).toHaveLength(0);
      const noRls = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'wos' and c.relkind = 'r' and not c.relrowsecurity`;
      expect(noRls.map((x) => x.relname)).toEqual([]);
    });

    it.fails("KNOWN GAP (B-0003): private events are readable by any contributor (events has visibility 'private' but a permissive policy)", async () => {
      await sql`insert into wos.events (type, visibility, aggregate_kind, aggregate_id, actor_account_id, actor_kind, payload, contracts_version)
                values ('account.email_changed', 'private', 'account', ${s.A.alice}, ${s.A.alice}, 'contributor', '{"email":"alice@example.com"}', '1.0.0')`;
      const n = await asActor(
        sql,
        "contributor",
        s.A.dave,
        async (tx) => (await tx`select 1 from wos.events where visibility = 'private'`).length,
      );
      expect(n).toBe(0);
    });
  });

  // ---- S-10 append-only ------------------------------------------------------------------------------
  describe("S-10: append-only records", () => {
    it.each(APPEND_ONLY)(
      "%s: forbid_mutation triggers for UPDATE/DELETE and TRUNCATE exist and are enabled; wos_app has no UPDATE/DELETE/TRUNCATE",
      async (t) => {
        const trig = await sql`select t.tgname, t.tgtype, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
                             join pg_proc p on p.oid = t.tgfoid where c.relname = ${t} and p.proname = 'forbid_mutation' and not t.tgisinternal`;
        // tgtype bits: 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE
        const bits = trig.filter((x) => x.tgenabled !== "D").reduce((acc, x) => acc | Number(x.tgtype), 0);
        expect(bits & 8 && bits & 16 && bits & 32, `triggers on ${t}`).toBeTruthy();
        const [p] =
          await sql`select has_table_privilege('wos_app', ${`wos.${t}`}, 'UPDATE') u, has_table_privilege('wos_app', ${`wos.${t}`}, 'DELETE') d,
                                   has_table_privilege('wos_app', ${`wos.${t}`}, 'TRUNCATE') tr`;
        expect(p).toEqual({ u: false, d: false, tr: false });
      },
    );

    it("the table owner cannot rewrite a sealed verdict, a manifest or an event", async () => {
      await sql`insert into wos.events (type, visibility, aggregate_kind, aggregate_id, actor_kind, payload, contracts_version) values ('abu.state_changed', 'public', 'abu', 'x', 'system', '{}', '1.0.0')`;
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

  // ---- S-12 independence -------------------------------------------------------------------------------
  describe("S-12: reviewer independence (DB backstop)", () => {
    it("self-review outside bootstrap: the builder cannot review their own attempt", async () => {
      await sql`insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
                values (${id(803)}, ${id(711)}, ${s.A.erin}, ${s.dev(s.A.erin)}, 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours')`;
      await sql`insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
                values (${id(903)}, ${id(803)}, ${id(711)}, ${s.A.erin}, 'r', 'm', 'max', 'ctx-1', '{}', ${`sha256:${"e".repeat(64)}`})`;
      const self = { round: s.rounds.erin, task: id(711), lease: id(803), account: s.A.erin, slot: "fable" as const, manifest: id(903) };
      expect(await failure(insertReview(sql, self))).toMatch(/authored the subject/);
      expect(await failure(insertReview(sql, { ...self, independence: "bootstrap_maintainer" }))).toMatch(/authored the subject/);
    });

    it("the same account cannot fill both slots of a round (independent)", async () => {
      await insertReview(sql, {
        round: s.rounds.erin,
        task: s.tasks.daveAstra,
        lease: s.leases.dave,
        account: s.A.dave,
        slot: "astra",
        manifest: s.manifests.dave,
      });
      const err = await failure(
        insertReview(sql, {
          round: s.rounds.erin,
          task: id(711),
          lease: s.leases.dave,
          account: s.A.dave,
          slot: "fable",
          manifest: s.manifests.dave,
        }),
      );
      expect(err).toMatch(/distinct reviewers/);
    });

    it.fails("KNOWN GAP (B-0003): a bootstrap_self review is accepted after bootstrap mode was switched off", async () => {
      await sql`update wos.platform_settings set value = '{"enabled": false, "since": null}' where key = 'bootstrap_mode'`;
      try {
        const err = await failure(
          insertReview(sql, {
            round: s.rounds.alice,
            task: s.tasks.carolFable,
            lease: s.leases.carol,
            account: s.A.alice,
            slot: "fable",
            manifest: s.manifests.carol,
            independence: "bootstrap_self",
          }),
        );
        expect(err).not.toBeNull();
      } finally {
        await sql`update wos.platform_settings set value = '{"enabled": true, "since": null}' where key = 'bootstrap_mode'`;
      }
    });

    it.fails("KNOWN GAP (B-0003): bootstrap can be re-entered by the app role once ended (S-31 says it cannot)", async () => {
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
      expect(err).not.toBeNull();
    });
  });

  // ---- S-23 binding ---------------------------------------------------------------------------------------
  describe("S-23: verdicts are bound to the round, head and diff hash", () => {
    let n = 20;
    /** A fresh open round (alice's new attempt) with the same public head and diff hash and both slots empty. */
    const freshRound = async () => {
      n += 1;
      const [a] = await sql`insert into wos.abus (catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens)
                            values (${id(201)}, ${id(202)}, ${`contacts#${n}`}, 'u', 1, 'in_progress', '{}', 1) returning id`;
      const [t] = await sql`insert into wos.attempts (abu_id, account_id, github_user_id, state, base_sha, head_sha)
                            values (${a!.id}, ${s.A.alice}, 1, 'in_review', ${"a".repeat(40)}, ${HEAD}) returning id`;
      const [r] = await sql`insert into wos.rounds (subject_kind, attempt_id, round_number, head_sha, submission_sha256, state)
                            values ('implementation', ${t!.id}, 1, ${HEAD}, ${HASH}, 'awaiting_reviews') returning id`;
      return r!.id as string;
    };

    it("a verdict for a different head sha is rejected", async () => {
      const err = await failure(
        insertReview(sql, {
          round: s.rounds.alice,
          task: s.tasks.carolFable,
          lease: s.leases.carol,
          account: s.A.carol,
          slot: "fable",
          manifest: s.manifests.carol,
          head: "d".repeat(40),
        }),
      );
      expect(err).toMatch(/bound to/);
    });

    it("a verdict for a different diff hash is rejected", async () => {
      const err = await failure(
        insertReview(sql, {
          round: s.rounds.alice,
          task: s.tasks.carolFable,
          lease: s.leases.carol,
          account: s.A.carol,
          slot: "fable",
          manifest: s.manifests.carol,
          hash: `sha256:${"5".repeat(64)}`,
        }),
      );
      expect(err).toMatch(/bound to/);
    });

    it("no verdict can enter a round that is no longer awaiting reviews", async () => {
      const [r] =
        await sql`insert into wos.rounds (subject_kind, attempt_id, round_number, head_sha, submission_sha256, state, outcome, independence, revealed_at)
                            values ('implementation', ${s.attempts.alice}, 7, ${HEAD}, ${HASH}, 'revealed', 'gaps', 'independent', now()) returning id`;
      const err = await failure(
        insertReview(sql, {
          round: r!.id,
          task: s.tasks.carolFable,
          lease: s.leases.carol,
          account: s.A.carol,
          slot: "fable",
          manifest: s.manifests.carol,
        }),
      );
      expect(err).toMatch(/cannot accept a review/);
    });

    it.fails("KNOWN GAP (B-0003): fabricated verdict for another round — dave's lease for erin's round cannot post into alice's round", async () => {
      // Same head and diff hash (both public), so only a task/lease-to-round binding would stop it.
      const other = await freshRound();
      const err = await failure(
        insertReview(sql, {
          round: other,
          task: s.tasks.daveAstra,
          lease: s.leases.dave,
          account: s.A.dave,
          slot: "astra",
          manifest: s.manifests.dave,
        }),
      );
      expect(err).not.toBeNull();
    });

    it.fails("KNOWN GAP (B-0003): a review whose slot differs from its task's reviewer_slot is rejected", async () => {
      const err = await failure(
        insertReview(sql, {
          round: await freshRound(),
          task: s.tasks.carolFable,
          lease: s.leases.carol,
          account: s.A.carol,
          slot: "astra",
          manifest: s.manifests.carol,
          verdict: "MATERIAL_GAPS",
        }),
      );
      expect(err).not.toBeNull();
    });
  });

  // ---- 20 simultaneous builders -------------------------------------------------------------------
  describe("leases-and-locks: 20 simultaneous builders (DB constraints under real concurrency)", () => {
    const race = <T>(n: number, fn: (i: number) => Promise<T>) => Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));

    it("20 parallel active leases on one task: exactly one wins", async () => {
      const results = await race(
        20,
        (i) =>
          sql`insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
            values (${id(401)}, ${s.A.dave}, ${s.dev(s.A.dave)}, 'active', ${sql.json({ i })}, now() + interval '30 minutes', now() + interval '3 hours')`,
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("20 parallel live attempts on one ABU: exactly one wins", async () => {
      const [a] = await sql`insert into wos.abus (catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens)
                            values (${id(201)}, ${id(202)}, 'contacts#09', 'race', 1, 'ready', '{}', 1) returning id`;
      const results = await race(
        20,
        () =>
          sql`insert into wos.attempts (abu_id, account_id, github_user_id, state, base_sha) values (${a!.id}, ${s.A.dave}, 1, 'leased', ${"a".repeat(40)})`,
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("20 parallel identical exclusive resource locks (e.g. db:migrations): exactly one wins", async () => {
      const results = await race(
        20,
        () =>
          sql`insert into wos.resource_locks (repo_full_name, attempt_id, resource_key, mode) values ('waronsaas/suite', ${s.attempts.erin}, 'db:migrations', 'exclusive')`,
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    /**
     * The claim protocol of BUILD-PROTOCOL.md section 3 steps 2 and 5, run by 20 builders at once over 20 ABUs
     * with deliberately overlapping scopes. A sleep between the conflict check and the insert forces the worst
     * interleaving. With the advisory lock the invariant holds; without it the schema alone admits overlapping
     * path locks, which proves the lock (control-plane code) is load-bearing and the DB is not a backstop here.
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
                   values (${repo}, ${s.attempts.erin}, ${`path:${scope}`}, 'exclusive', ${tree ? scope.slice(0, -3) : scope}, ${tree})`;
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
      // ten distinct subtrees exist, so exactly ten claims can win whatever the interleaving
      expect(locks.length).toBe(10);
      for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/RESOURCE_LOCKED/);
    }, 30_000);

    it("without the advisory lock the schema admits overlapping path locks (the lock is load-bearing)", async () => {
      await claimAll(false, "waronsaas/race-unlocked");
      const { pairs } = await overlappingPairs("waronsaas/race-unlocked");
      expect(pairs.length).toBeGreaterThan(0);
    }, 30_000);
  });
});
