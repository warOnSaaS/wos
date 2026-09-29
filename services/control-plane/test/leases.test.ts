/** Leases and locks under concurrency (BUILD-PROTOCOL.md section 3, DOMAIN-MODEL.md section 5). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Account, CRON_SECRET, createHarness, HAS_DB, type Harness, seedFeature } from "./support/harness.js";

describe.skipIf(!HAS_DB)("leases and locks (Postgres)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const claim = (a: Account, abuId: string, idem: string | boolean = true, model?: "opus" | "astra" | "sol" | "fable") =>
    h.call("POST", `/v1/abus/${abuId}/claim`, { token: a.token, idem, body: { deviceId: a.deviceId, ...(model ? { model } : {}) } });
  const sweep = () => h.call("GET", "/v1/cron/sweep", { headers: { authorization: `Bearer ${CRON_SECRET}` } });

  it("leases-and-locks R-001 twenty parallel claims of one ABU produce exactly one lease", async () => {
    const seeded = await seedFeature(h.owner, { feature: "race", abus: [{ n: "01", write: ["modules/race/**"] }] });
    const builders: Account[] = [];
    for (let i = 0; i < 20; i++) builders.push(await h.contributor(`racer${i}`));
    const results = await Promise.all(builders.map((b) => claim(b, seeded.abus.get("01")!)));
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(["CONFLICT", "RESOURCE_LOCKED"]).toContain(r.body.error.code);
    }
    const [n] = await h.owner<{ leases: number; attempts: number; locks: number }[]>`
      select (select count(*)::int from wos.leases l join wos.tasks t on t.id = l.task_id where t.abu_id = ${seeded.abus.get("01")!}) as leases,
             (select count(*)::int from wos.attempts where abu_id = ${seeded.abus.get("01")!}) as attempts,
             (select count(*)::int from wos.resource_locks l join wos.attempts a on a.id = l.attempt_id where a.abu_id = ${seeded.abus.get("01")!}) as locks`;
    expect(n).toEqual({ leases: 1, attempts: 1, locks: 1 });
  });

  it("leases-and-locks R-002 two ABUs with overlapping write scopes cannot both be in progress", async () => {
    const seeded = await seedFeature(h.owner, {
      feature: "overlap",
      abus: [
        { n: "01", write: ["modules/overlap/**"] },
        { n: "02", write: ["modules/overlap/sub/file.ts"] },
        { n: "03", write: ["modules/overlap-other/**"] },
      ],
    });
    const [a, b] = [await h.contributor("lock-a"), await h.contributor("lock-b")];
    // Concurrently: exactly one of the two overlapping claims wins.
    const both = await Promise.all([claim(a, seeded.abus.get("01")!), claim(b, seeded.abus.get("02")!)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = both.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe("RESOURCE_LOCKED");
    expect(loser.body.error.details.holders[0]).toMatch(/^overlap#0[12]$/);
    // A sibling directory whose name shares a prefix does not overlap.
    const c = await h.contributor("lock-c");
    expect((await claim(c, seeded.abus.get("03")!)).status).toBe(200);
    // When the holder releases, its locks go and the other ABU becomes claimable.
    const winner = both.find((r) => r.status === 200)!;
    const holder = winner === both[0] ? a : b;
    await h.call("POST", `/v1/leases/${winner.body.lease.id}/release`, {
      token: holder.token,
      idem: true,
      body: { reason: "giving it back" },
    });
    const other = winner === both[0] ? { acct: b, abu: seeded.abus.get("02")! } : { acct: a, abu: seeded.abus.get("01")! };
    expect((await claim(other.acct, other.abu)).status).toBe(200);
    const states = await h.owner<
      { state: string }[]
    >`select state from wos.abus where catalog_feature_id = ${seeded.featureId} and state = 'in_progress'`;
    expect(states).toHaveLength(2); // the survivor and 03; never 01 and 02 together
  });

  it("leases-and-locks R-002 an exclusive logical resource is held by one ABU; shared claims coexist", async () => {
    const seeded = await seedFeature(h.owner, {
      feature: "resources",
      abus: [
        { n: "01", write: ["modules/resources/a/**"], resources: [{ key: "db:migrations", mode: "exclusive" }] },
        { n: "02", write: ["modules/resources/b/**"], resources: [{ key: "db:migrations", mode: "exclusive" }] },
        { n: "03", write: ["modules/resources/c/**"], resources: [{ key: "db:table:contacts", mode: "shared" }] },
        { n: "04", write: ["modules/resources/d/**"], resources: [{ key: "db:table:contacts", mode: "shared" }] },
      ],
    });
    const x = await h.contributor("res-x");
    const y = await h.contributor("res-y");
    expect((await claim(x, seeded.abus.get("01")!)).status).toBe(200);
    const locked = await claim(y, seeded.abus.get("02")!);
    expect(locked.body.error.code).toBe("RESOURCE_LOCKED");
    expect((await claim(y, seeded.abus.get("03")!)).status).toBe(200);
    expect((await claim(x, seeded.abus.get("04")!, true, "astra")).status).toBe(200); // D15: second lease on the other provider
  });

  it("leases-and-locks R-001 a lease with no heartbeat expires and the task reopens", async () => {
    const seeded = await seedFeature(h.owner, { feature: "expiry", abus: [{ n: "01", write: ["modules/expiry/**"] }] });
    const builder = await h.contributor("sleepy");
    const c = await claim(builder, seeded.abus.get("01")!);
    expect(c.status).toBe(200);
    const leaseId = c.body.lease.id;
    // A heartbeat in time extends the lease, never past the hard deadline.
    await h.owner`update wos.leases set expires_at = now() + interval '1 minute', hard_deadline_at = now() + interval '5 minutes' where id = ${leaseId}`;
    const hb = await h.call("POST", `/v1/leases/${leaseId}/heartbeat`, {
      token: builder.token,
      body: { deviceId: builder.deviceId, phase: "building" },
    });
    expect(hb.status).toBe(200);
    expect(Date.parse(hb.body.expiresAt)).toBeLessThanOrEqual(Date.parse(hb.body.hardDeadlineAt));
    const wrongDevice = await h.call("POST", `/v1/leases/${leaseId}/heartbeat`, {
      token: builder.token,
      body: { deviceId: "00000000-0000-7000-8000-000000000000", phase: "building" },
    });
    expect(wrongDevice.body.error.code).toBe("LEASE_NOT_HELD");
    // Heartbeats stop: the lease passes its expiry.
    await h.owner`update wos.leases set expires_at = now() - interval '1 minute' where id = ${leaseId}`;
    const late = await h.call("POST", `/v1/leases/${leaseId}/heartbeat`, {
      token: builder.token,
      body: { deviceId: builder.deviceId, phase: "building" },
    });
    expect(late.body.error.code).toBe("LEASE_EXPIRED");
    const s = await sweep();
    expect(s.status).toBe(200);
    expect(s.body.expiredLeases).toBeGreaterThanOrEqual(1);
    expect(s.body.expiredAttempts).toBeGreaterThanOrEqual(1);
    const [l] = await h.owner<{ state: string }[]>`select state from wos.leases where id = ${leaseId}`;
    expect(l!.state).toBe("expired");
    const [a] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${c.body.attempt.id}`;
    expect(a!.state).toBe("expired");
    const [abu] = await h.owner<
      { state: string; failed_attempts: number }[]
    >`select state, failed_attempts from wos.abus where id = ${seeded.abus.get("01")!}`;
    expect(abu).toEqual({ state: "ready", failed_attempts: 1 });
    const tasks = await h.owner<
      { state: string }[]
    >`select state from wos.tasks where abu_id = ${seeded.abus.get("01")!} order by created_at`;
    expect(tasks.map((t) => t.state)).toEqual(["cancelled", "open"]); // a task is never reused across attempts
    const locks = await h.owner`select 1 from wos.resource_locks where attempt_id = ${c.body.attempt.id} and released_at is null`;
    expect(locks).toHaveLength(0);
    // Someone else can take it now.
    const next = await h.contributor("awake");
    expect((await claim(next, seeded.abus.get("01")!)).status).toBe(200);
  });

  it("leases-and-locks R-001 an author task whose lease expires goes back to open for anyone", async () => {
    const maint = await h.contributor("maint-exp", { maintainer: true });
    const open = await h.call("POST", "/v1/admin/targets/zoom/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "first roadmap" },
    });
    expect(open.status).toBe(200);
    const author = await h.contributor("author-exp");
    const c = await h.call("POST", `/v1/tasks/${open.body.taskId}/claim`, {
      token: author.token,
      idem: true,
      body: { deviceId: author.deviceId },
    });
    expect(c.status).toBe(200);
    expect(c.body.contextPlan.role).toBe("roadmap_author");
    await h.owner`update wos.leases set expires_at = now() - interval '1 second' where id = ${c.body.lease.id}`;
    await sweep();
    const [t] = await h.owner<{ state: string }[]>`select state from wos.tasks where id = ${open.body.taskId}`;
    expect(t!.state).toBe("open");
    const again = await h.call("POST", `/v1/tasks/${open.body.taskId}/claim`, {
      token: maint.token,
      idem: true,
      body: { deviceId: maint.deviceId },
    });
    expect(again.status).toBe(200);
  });

  it("D15: one build lease per provider and two in total; the claim may name the model (LIMIT_REACHED, NOT_ELIGIBLE)", async () => {
    const seeded = await seedFeature(h.owner, {
      feature: "limits",
      abus: [
        { n: "01", write: ["modules/limits/a/**"] },
        { n: "02", write: ["modules/limits/b/**"] },
        { n: "03", write: ["modules/limits/c/**"] },
      ],
    });
    const greedy = await h.contributor("greedy");
    const first = await claim(greedy, seeded.abus.get("01")!);
    expect(first.status).toBe(200);
    expect(first.body.contextPlan).toMatchObject({ model: "opus", provider: "claude_cli" }); // omitted model: first attested allowed
    const sameProvider = await claim(greedy, seeded.abus.get("02")!);
    expect(sameProvider.body.error.code).toBe("LIMIT_REACHED");
    const notAllowed = await claim(greedy, seeded.abus.get("02")!, true, "fable");
    expect(notAllowed.body.error.code).toBe("NOT_ELIGIBLE");
    const astra = await claim(greedy, seeded.abus.get("02")!, true, "astra");
    expect(astra.status).toBe(200);
    expect(astra.body.contextPlan).toMatchObject({ model: "astra", provider: "codex_cli", modelId: "gpt-6-astra" });
    const third = await claim(greedy, seeded.abus.get("03")!, true, "astra");
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("LIMIT_REACHED");
    const [row] = await h.owner<
      { context_plan: { budgetTokens: number } }[]
    >`select context_plan from wos.leases where id = ${astra.body.lease.id}`;
    const override = h.deps.policy.roles.find((r) => r.role === "builder")!.budgetOverrides.find((o) => o.model === "astra");
    if (override) expect(row!.context_plan.budgetTokens).toBe(override.contextBudgetTokens);
  });

  it("replays an idempotent claim for the same key and body, and refuses the key with another body", async () => {
    const seeded = await seedFeature(h.owner, { feature: "idem", abus: [{ n: "01", write: ["modules/idem/**"] }] });
    const b = await h.contributor("idem-builder");
    const key = "0192f000-0000-7000-8000-00000000abcd";
    const first = await claim(b, seeded.abus.get("01")!, key);
    const replay = await claim(b, seeded.abus.get("01")!, key);
    expect(replay.status).toBe(200);
    expect(replay.body.lease.id).toBe(first.body.lease.id);
    const mismatch = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: key,
      body: { deviceId: "00000000-0000-7000-8000-000000000001" },
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    const missing = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, { token: b.token, body: { deviceId: b.deviceId } });
    expect(missing.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("never violates the route contract", () => {
    expect(h.violations).toEqual([]);
  });
});
