/** The four read operations CLI and Desktop use (contracts 4.2.0, B-0009-github-build). */
import { afterEach, describe, expect, it } from "vitest";
import { ABU_KEY, FEATURE, TARGET } from "./support/fake-control-plane.js";
import { type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("orchestrator read operations", () => {
  it("listClaimableAbus, listOpenTasks, myWork and events go through the typed API client", async () => {
    h = harness();
    const o = h.make("desktop");
    const abus = await o.listClaimableAbus(TARGET, FEATURE);
    expect(abus.map((a) => [a.key, a.claimable])).toEqual([[ABU_KEY, true]]);

    const t = h.server.openAuthorTask("roadmap_author");
    const open = await o.listOpenTasks({ kind: "roadmap_author" });
    expect(open.map((x) => x.id)).toEqual([t.id]);
    expect(await o.listOpenTasks({ kind: "abu_revision" })).toEqual([]);

    await o.build({ abu: `${TARGET}/${ABU_KEY}` }, () => undefined); // Desktop detaches after submit
    const work = await o.myWork();
    expect(work.attempts.map((a) => a.state)).toEqual(["submitted"]);
    expect(work.leases.some((l) => l.state === "completed")).toBe(true);

    h.server.domainEvents.push({
      id: 7,
      occurredAt: "2026-09-29T12:00:00Z",
      actorAccountId: null,
      actorKind: "system",
      aggregateKind: "target",
      aggregateId: TARGET,
      contractsVersion: "4.2.0",
      type: "target.listed",
      v: 1,
      visibility: "public",
      payload: { target: TARGET },
    });
    const ev = await o.events(0);
    expect(ev.lastId).toBe(7);
    expect(ev.items).toHaveLength(1);
    expect((await o.events(7)).items).toEqual([]);
    const calls = h.server.calls.map((c) => c.route);
    for (const r of ["listClaimableAbus", "listOpenTasks", "getMyWork", "listMyEvents"]) expect(calls).toContain(r);
  });
});
