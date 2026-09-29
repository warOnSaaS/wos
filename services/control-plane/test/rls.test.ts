/** S-9 / S-11: the app runs as wos_app under RLS, handlers set wos.actor_*, sealed reviews stay invisible to others. */
import { inTransaction } from "@waronsaas/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import { createHarness, HAS_DB, type Harness, seedFeature, verdict, webhookHeaders } from "./support/harness.js";

describe.skipIf(!HAS_DB)("row-level security through the control plane", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("the app connects as wos_app, which cannot bypass RLS and does not own the tables", async () => {
    const [r] = await h.deps.sql<{ user: string; bypass: boolean; owner: string }[]>`
      select current_user as user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
             (select tableowner from pg_tables where schemaname = 'wos' and tablename = 'reviews') as owner`;
    expect(r!.user).toBe("wos_app");
    expect(r!.bypass).toBe(false);
    expect(r!.owner).not.toBe("wos_app");
  });

  it("inTransaction sets wos.actor_id and wos.actor_kind transaction-locally", async () => {
    const id = "0192f000-0000-7000-8000-000000000042";
    const inside = await inTransaction(
      h.deps.sql,
      { kind: "contributor", accountId: id },
      (tx) => tx<{ id: string; kind: string }[]>`select wos.actor_id()::text as id, wos.actor_kind() as kind`,
    );
    expect(inside[0]).toEqual({ id, kind: "contributor" });
    const outside = await h.deps.sql<{ kind: string }[]>`select wos.actor_kind() as kind`;
    expect(outside[0]!.kind).toBe("anonymous");
  });

  it("private rows follow the actor: own email and leases only; sessions only for the system actor", async () => {
    const a = await h.contributor("rls-a");
    const b = await h.contributor("rls-b");
    // GET /v1/me succeeds only because the handler set actor_id (account_emails is own-row only).
    expect((await h.call("GET", "/v1/me", { token: a.token })).body.email).toBe("rls-a@example.com");
    const asB = (q: string) => inTransaction(h.deps.sql, { kind: "contributor", accountId: b.id }, (tx) => tx.unsafe<{ n: number }[]>(q));
    expect((await asB("select count(*)::int as n from wos.account_emails"))[0]!.n).toBe(1);
    expect((await asB("select count(*)::int as n from wos.sessions"))[0]!.n).toBe(0);
    expect((await asB("select count(*)::int as n from wos.email_signin_requests"))[0]!.n).toBe(0);
    const seeded = await seedFeature(h.owner, { feature: "rls-leases", abus: [{ n: "01", write: ["modules/rls/**"] }] });
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: a.token,
      idem: true,
      body: { deviceId: a.deviceId },
    });
    expect(claim.status).toBe(200);
    expect((await asB("select count(*)::int as n from wos.leases"))[0]!.n).toBe(0);
    expect((await h.call("GET", "/v1/me/work", { token: b.token })).body.leases).toEqual([]);
    expect((await h.call("GET", "/v1/me/work", { token: a.token })).body.leases).toHaveLength(1);
  });

  it("a sealed review is invisible to another account through the API until the round is revealed", async () => {
    const seeded = await seedFeature(h.owner, { feature: "sealed", abus: [{ n: "01", write: ["modules/sealed/**"] }] });
    const builder = await h.contributor("sealed-builder");
    const astra = await h.contributor("sealed-astra");
    const fable = await h.contributor("sealed-fable");
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/sealed/x.ts", content: "x\n" }]);
    const head = h.github.commits.at(-1)!.sha;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 5, head_sha: head, conclusion: "success" },
    };
    await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    const sealed = await reviewAs(h, astra, "astra", "implementation_review", verdict("MATERIAL_GAPS"));
    expect(sealed.res.status).toBe(200);
    const reviewsAs = async (id: string) =>
      (
        await inTransaction(
          h.deps.sql,
          { kind: "contributor", accountId: id },
          (tx) => tx<{ n: number }[]>`select count(*)::int as n from wos.reviews where id = ${sealed.res.body.reviewId}`,
        )
      )[0]!.n;
    expect(await reviewsAs(astra.id)).toBe(1); // the author sees their own sealed review
    expect(await reviewsAs(builder.id)).toBe(0);
    expect(await reviewsAs(fable.id)).toBe(0); // the other slot never sees it (S-11)
    const anon = await inTransaction(
      h.deps.sql,
      { kind: "anonymous", accountId: null },
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from wos.reviews`,
    );
    expect(anon[0]!.n).toBe(0);
    for (const acct of [builder, fable]) {
      const view = await h.call("GET", `/v1/attempts/${b.attemptId}`, { token: acct.token });
      expect(view.body.reviews).toEqual([]);
      expect(JSON.stringify(view.body)).not.toContain(sealed.res.body.reviewId);
    }
    expect((await h.call("GET", `/v1/public/abus/${seeded.abus.get("01")}`)).body.reviews).toEqual([]);
    const events = await h.call("GET", "/v1/public/activity");
    expect(events.body.items.some((e: { type: string }) => e.type === "round.verdict_sealed")).toBe(false);
    // Second slot seals: both revealed at once, findings readable by the builder.
    await reviewAs(h, fable, "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    expect(await reviewsAs(builder.id)).toBe(1);
    const view = await h.call("GET", `/v1/attempts/${b.attemptId}`, { token: builder.token });
    expect(view.body.reviews).toHaveLength(2);
    expect(view.body.openFindings).toHaveLength(1);
    expect(view.body.state).toBe("changes_requested");
    expect(h.violations).toEqual([]);
  });
});
