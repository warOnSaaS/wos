/**
 * DOMAIN-MODEL.md section 3: every state change is ONE guarded UPDATE plus exactly ONE event in the same
 * transaction. Forcing a failure between the UPDATE and the event insert must leave neither behind.
 */
import { AbuMachine, AttemptMachine, LeaseMachine, type Machine, TaskMachine } from "@waronsaas/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setTransitionFaultHook } from "../src/db/transition.js";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import { CRON_SECRET, createHarness, HAS_DB, type Harness, seedFeature, verdict, webhookHeaders } from "./support/harness.js";

describe.skipIf(!HAS_DB)("transitions write exactly one event, atomically", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(() => setTransitionFaultHook(null));

  it("a failure after the guarded UPDATE rolls back the state change and its event together (claim)", async () => {
    const seeded = await seedFeature(h.owner, { feature: "atomic", abus: [{ n: "01", write: ["modules/atomic/**"] }] });
    const b = await h.contributor("atomic-builder");
    const before = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.events`;
    setTransitionFaultHook(({ table, event }) => {
      if (table === "tasks" && event === "claim") throw new Error("forced failure after UPDATE");
    });
    const failed = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    expect(failed.status).toBe(500);
    const after = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.events`;
    expect(after[0]!.n).toBe(before[0]!.n);
    const [task] = await h.owner<
      { state: string; row_version: number }[]
    >`select state, row_version from wos.tasks where abu_id = ${seeded.abus.get("01")!}`;
    expect(task).toEqual({ state: "open", row_version: 0 });
    const [abu] = await h.owner<{ state: string }[]>`select state from wos.abus where id = ${seeded.abus.get("01")!}`;
    expect(abu!.state).toBe("ready");
    expect(await h.owner`select 1 from wos.attempts where abu_id = ${seeded.abus.get("01")!}`).toHaveLength(0);
    expect(
      await h.owner`select 1 from wos.leases l join wos.tasks t on t.id = l.task_id where t.abu_id = ${seeded.abus.get("01")!}`,
    ).toHaveLength(0);
    setTransitionFaultHook(null);
    const ok = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    expect(ok.status).toBe(200);
  });

  it("a failure after the guarded UPDATE rolls back the sweeper's expiry and its lease.ended event", async () => {
    const seeded = await seedFeature(h.owner, { feature: "atomic-sweep", abus: [{ n: "01", write: ["modules/atomic-sweep/**"] }] });
    const b = await h.contributor("atomic-sleeper");
    const c = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    await h.owner`update wos.leases set expires_at = now() - interval '1 second' where id = ${c.body.lease.id}`;
    setTransitionFaultHook(({ table, event }) => {
      if (table === "leases" && event === "expire") throw new Error("forced failure after UPDATE");
    });
    const s = await h.call("GET", "/v1/cron/sweep", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(s.status).toBe(500);
    const [l] = await h.owner<{ state: string }[]>`select state from wos.leases where id = ${c.body.lease.id}`;
    expect(l!.state).toBe("active");
    expect(await h.owner`select 1 from wos.events where type = 'lease.ended' and aggregate_id = ${c.body.lease.id}`).toHaveLength(0);
    setTransitionFaultHook(null);
    await h.call("GET", "/v1/cron/sweep", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(await h.owner`select 1 from wos.events where type = 'lease.ended' and aggregate_id = ${c.body.lease.id}`).toHaveLength(1);
  });

  it("across a full pipeline, every transition wrote exactly one event and every event is a machine transition", async () => {
    const seeded = await seedFeature(h.owner, {
      feature: "counted",
      abus: [
        { n: "01", write: ["modules/counted/a/**"] },
        { n: "02", write: ["modules/counted/b/**"], dependsOn: ["01"] },
      ],
    });
    const transitions = new Map<string, number>();
    setTransitionFaultHook(({ table, id }) => transitions.set(`${table}:${id}`, (transitions.get(`${table}:${id}`) ?? 0) + 1));
    const builder = await h.contributor("counted-builder");
    const astra = await h.contributor("counted-astra");
    const fable = await h.contributor("counted-fable");
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/counted/a/x.ts", content: "1\n" }]);
    const head = h.github.commits.at(-1)!.sha;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 1, head_sha: head, conclusion: "success" },
    };
    await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    await reviewAs(h, astra, "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await reviewAs(h, fable, "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    const pr = h.github.prs.at(-1)!;
    const merged = {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "9".repeat(40) },
    };
    await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) });
    setTransitionFaultHook(null);

    const [attempt] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${b.attemptId}`;
    expect(attempt!.state).toBe("merged");
    const check = async (table: string, aggregateKind: string, type: string, machine: Machine<string, string>, ids: string[]) => {
      for (const id of ids) {
        const events = await h.owner<{ payload: { from?: string; to: string } }[]>`
          select payload from wos.events where aggregate_kind = ${aggregateKind} and aggregate_id = ${id} and type = ${type} order by id`;
        const changes = events.filter((e) => e.payload.from !== "none");
        expect(changes.length, `${table} ${id}`).toBe(transitions.get(`${table}:${id}`) ?? 0);
        for (const e of changes) {
          if (e.payload.from === undefined) continue;
          expect(
            machine.transitions.some((t) => t.from === e.payload.from && t.to === e.payload.to),
            `${e.payload.from}->${e.payload.to}`,
          ).toBe(true);
        }
        const [row] = await h.owner<{ state: string }[]>`select state from ${h.owner(`wos.${table}`)} where id = ${id}`;
        if (changes.length > 0 && changes.at(-1)!.payload.to) expect(row!.state).toBe(changes.at(-1)!.payload.to);
      }
    };
    const tasks = await h.owner<
      { id: string }[]
    >`select id from wos.tasks where abu_id in ${h.owner([...seeded.abus.values()])} or attempt_id = ${b.attemptId}`;
    await check(
      "tasks",
      "task",
      "task.state_changed",
      TaskMachine as Machine<string, string>,
      tasks.map((t) => t.id),
    );
    await check("attempts", "attempt", "attempt.state_changed", AttemptMachine as Machine<string, string>, [b.attemptId]);
    await check("abus", "abu", "abu.state_changed", AbuMachine as Machine<string, string>, [...seeded.abus.values()]);
    const leases = await h.owner<
      { id: string }[]
    >`select l.id from wos.leases l join wos.tasks t on t.id = l.task_id where t.id in ${h.owner(tasks.map((t) => t.id))}`;
    for (const l of leases) {
      const ended = await h.owner`select 1 from wos.events where type = 'lease.ended' and aggregate_id = ${l.id}`;
      expect(ended.length).toBe(transitions.get(`leases:${l.id}`) ?? 0);
    }
    void LeaseMachine;
    const rounds = await h.owner<{ id: string }[]>`select id from wos.rounds where attempt_id = ${b.attemptId}`;
    for (const r of rounds) {
      const revealed = await h.owner`select 1 from wos.events where type = 'round.revealed' and aggregate_id = ${r.id}`;
      expect(revealed.length).toBe(transitions.get(`rounds:${r.id}`) ?? 0);
    }
    expect(h.violations).toEqual([]);
  });
});
