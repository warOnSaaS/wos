/** author(): roadmap and feature-contract authoring and conflict resolution (wos roadmap, wos resolve, revisions). */
import type { OrchestratorEvent } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("author()", () => {
  it("roadmap_author: the agent writes ROADMAP.yaml, the changeset stays in roadmaps/<target>/** and is submitted", async () => {
    h = harness();
    const t = h.server.openAuthorTask("roadmap_author");
    const events: OrchestratorEvent[] = [];
    const res = await h.make("cli").author({ taskId: t.id }, (e) => events.push(e));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, attempt: null, output: { schema: "author-summary.v1" } });
    const cs = h.server.submissions[0]!;
    expect(cs.files.map((f) => `${f.op} ${f.path}`)).toEqual(["upsert roadmaps/salesforce/ROADMAP.yaml"]);
    expect(cs.summary.schema).toBe("author-summary.v1");
    // Roadmap authors run on the policy's preferred model for the role.
    const agent = h.processes.invocations.find((i) => i.binary === "claude" || i.binary === "codex")!;
    expect(agent.argv[agent.argv.indexOf("--model") + 1]).toBe("claude-fable-5-1");
    expect(h.server.manifestBodies).toHaveLength(1);
  });

  it("feature_author: writes CONTRACT.yaml under features/<feature>/", async () => {
    h = harness();
    h.processes.authorFile = {
      path: "features/contacts/CONTRACT.yaml",
      content: "schema: wos-feature-contract.v1\nkey: contacts\nversion: 2\n",
    };
    const t = h.server.openAuthorTask("feature_author");
    const res = await h.make("cli").author({ taskId: t.id }, () => undefined);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(h.server.submissions[0]!.files.map((f) => f.path)).toEqual(["features/contacts/CONTRACT.yaml"]);
  });

  it("refuses to submit an author changeset outside the document paths", async () => {
    h = harness();
    h.processes.authorFile = { path: "modules/contacts/list.ts", content: "not a document\n" };
    const t = h.server.openAuthorTask("roadmap_author");
    const events: OrchestratorEvent[] = [];
    const res = await h.make("cli").author({ taskId: t.id }, (e) => events.push(e));
    expect(res).toMatchObject({ ok: false, code: "SCOPE_VIOLATION" });
    expect(h.server.submissions).toHaveLength(0);
    expect(events.find((e) => e.type === "scope")).toMatchObject({ validation: { ok: false, errors: [{ code: "OUT_OF_SCOPE" }] } });
  });

  it("conflict_resolution: a read-only resolver run submits its Ruling", async () => {
    h = harness();
    const t = h.server.openAuthorTask("conflict_resolution");
    const res = await h.make("cli").author({ taskId: t.id }, () => undefined);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, output: { schema: "ruling.v1" } });
    expect(h.server.rulings).toHaveLength(1);
    const agent = h.processes.invocations.find((i) => i.binary === "claude" || i.binary === "codex")!;
    expect(agent.argv).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk"]));
  });
});
