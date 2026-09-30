/** mobile-runtime: the wos-screen.v1 renderer, every screen kind and every fixed action, with the contracted HTTP semantics. */
import { describe, expect, it } from "vitest";
import type { MobileScreenT, OrgRoleT, ScreenRecordT } from "../src/contracts.js";
import {
  caps,
  detailModel,
  formModel,
  formValues,
  listModel,
  listPath,
  loadDetail,
  loadList,
  resolvePath,
  runAction,
  type ScreenApi,
  type ScreenContext,
  submitForm,
  visibleActions,
} from "../src/runtime/renderer.js";
import { fixtureManifest, fixtureScreens } from "./support.js";

type Call = { method: string; path: string; body?: unknown };
function fakeApi(answers: Record<string, { status?: number; json: unknown }>): ScreenApi & { calls: Call[] } {
  const calls: Call[] = [];
  const api = (async (req: Call) => {
    calls.push(req);
    const a = answers[`${req.method} ${req.path}`];
    if (!a) throw new Error(`unexpected ${req.method} ${req.path}`);
    return { status: a.status ?? 200, json: a.json };
  }) as ScreenApi & { calls: Call[] };
  api.calls = calls;
  return api;
}

const ctx = (screen: MobileScreenT, role: OrgRoleT = "owner"): ScreenContext => ({ screen, manifest: fixtureManifest, role });
const allScreens = Object.values(fixtureScreens);
const record: ScreenRecordT = {
  id: "it 1",
  name: "Alpha",
  phone: "+1 (555) 010-0000",
  email: "ops@example.test",
  active: true,
  status: "open",
};

describe("mobile-runtime renderer: paths", () => {
  it(":id is replaced (URL-encoded); a missing id or an unknown placeholder is refused", () => {
    expect(resolvePath("/apps/fixture/items/:id", "a/b c")).toBe("/apps/fixture/items/a%2Fb%20c");
    expect(() => resolvePath("/apps/fixture/items/:id", null)).toThrow(/needs a record id/);
    expect(() => resolvePath("/apps/fixture/items/:owner", null)).toThrow(/placeholder/);
  });

  it("list: ?q= only when the screen searches, &cursor= when paging", () => {
    expect(listPath(fixtureScreens.list, { q: " acme ", cursor: "c2" })).toBe("/apps/fixture/items?q=acme&cursor=c2");
    expect(listPath(fixtureScreens.list, {})).toBe("/apps/fixture/items");
    expect(listPath(fixtureScreens.notes, { q: "ignored" })).toBe("/apps/fixture/notes");
  });
});

describe("mobile-runtime renderer: list", () => {
  it("GET <resource>?q=, up to 4 fields per row, tap opens the onTap screen, then pages with the cursor", async () => {
    const api = fakeApi({
      "GET /apps/fixture/items?q=al": { json: { items: [record], nextCursor: "p2" } },
      "GET /apps/fixture/items?q=al&cursor=p2": {
        json: { items: [{ id: "it2", name: "Alpine", phone: null, status: "closed" }], nextCursor: null },
      },
    });
    const first = await loadList(api, ctx(fixtureScreens.list), { q: "al" });
    expect(first).toMatchObject({ kind: "list", title: "Items", search: true, count: 1, nextCursor: "p2", empty: null });
    expect(first.rows[0]).toEqual({
      id: "it 1",
      primary: "Alpha",
      secondary: [
        { label: "Phone", value: "+1 (555) 010-0000" },
        { label: "Status", value: "open" },
      ],
      opens: "fixture.items.detail",
    });
    const both = await loadList(api, ctx(fixtureScreens.list), { q: "al", cursor: first.nextCursor, previous: first });
    expect(both.rows.map((r) => r.primary)).toEqual(["Alpha", "Alpine"]);
    expect(both.rows[1]?.secondary[0]).toEqual({ label: "Phone", value: "—" });
    expect(both.nextCursor).toBeNull();
    expect(api.calls.map((c) => c.path)).toEqual(["/apps/fixture/items?q=al", "/apps/fixture/items?q=al&cursor=p2"]);
  });

  it("an empty list is an honest 0, never sample rows; an empty search says nothing matches", () => {
    const empty = listModel(ctx(fixtureScreens.list), { items: [], nextCursor: null });
    expect(empty.rows).toEqual([]);
    expect(empty.count).toBe(0);
    expect(empty.empty?.title).toBe("0 RECORDS");
    expect(empty.empty?.body).toMatch(/only what is built/);
    expect(listModel(ctx(fixtureScreens.list), { items: [], nextCursor: null }, "zz").empty?.title).toBe("0 MATCHES");
  });

  it("refuses a screen the role may not see, and data that is not ScreenListData", async () => {
    const api = fakeApi({ "GET /apps/fixture/items": { json: { rows: [] } } });
    await expect(loadList(api, ctx(fixtureScreens.list))).rejects.toThrow(/does not understand/);
    const writeOnly = { ...fixtureScreens.create, kind: "list" as const, list: { fields: ["name"], search: false, onTap: null } };
    await expect(loadList(api, ctx(writeOnly, "member"))).rejects.toThrow(/needs fixture.items.write/);
  });
});

describe("mobile-runtime renderer: detail", () => {
  it("GET with :id, field sections with labels, and the related list at <detail resource>/<relationship>", async () => {
    const api = fakeApi({
      "GET /apps/fixture/items/it%201": { json: { item: record } },
      "GET /apps/fixture/items/it%201/notes": { json: { items: [{ id: "n1", body: "Called back" }], nextCursor: null } },
    });
    const m = await loadDetail(api, ctx(fixtureScreens.detail), "it 1", allScreens);
    expect(m.title).toBe("Alpha");
    expect(m.sections[0]).toEqual({
      type: "fields",
      rows: [
        { field: "name", label: "Name", value: "Alpha" },
        { field: "phone", label: "Phone", value: "+1 (555) 010-0000" },
        { field: "email", label: "Email", value: "ops@example.test" },
        { field: "active", label: "Active", value: "Yes" },
      ],
    });
    const related = m.sections[1];
    expect(related?.type).toBe("related");
    if (related?.type !== "related") throw new Error("no related section");
    expect(related.list?.rows.map((r) => r.primary)).toEqual(["Called back"]);
    expect(api.calls.map((c) => c.path)).toEqual(["/apps/fixture/items/it%201", "/apps/fixture/items/it%201/notes"]);
  });

  it("a failing related list shows its error in place; the record still shows", async () => {
    const api = fakeApi({ "GET /apps/fixture/items/x": { json: { item: { id: "x", name: null } } } });
    const m = await loadDetail(api, ctx(fixtureScreens.detail), "x", allScreens);
    expect(m.title).toBe("Name");
    expect(m.sections[1]).toMatchObject({ type: "related", list: null, error: expect.stringMatching(/unexpected GET/) });
  });

  it("actions follow the role's declared permissions; call and email need a value", () => {
    const labels = (role: OrgRoleT, r: ScreenRecordT | null) =>
      visibleActions(ctx(fixtureScreens.detail, role), r).map((a) => `${a.label}:${a.enabled}`);
    expect(labels("owner", record)).toEqual(["CALL:true", "EMAIL:true", "OPEN NOTES:true", "EDIT:true", "DELETE:true", "RUN CHECK:true"]);
    expect(labels("member", record)).toEqual(["CALL:true", "EMAIL:true", "OPEN NOTES:true", "RUN CHECK:true"]);
    expect(labels("admin", { id: "y", phone: null, email: "" })).toEqual([
      "CALL:false",
      "EMAIL:false",
      "OPEN NOTES:true",
      "EDIT:true",
      "RUN CHECK:true",
    ]);
    expect(detailModel(ctx(fixtureScreens.detail, "member"), record).actions.map((a) => a.id)).not.toContain("fixture.delete");
  });
});

describe("mobile-runtime renderer: form", () => {
  it("edit: prefilled from the record, typed inputs converted and checked, PATCH <resource with :id> with ScreenFormBody", async () => {
    const model = formModel(ctx(fixtureScreens.edit), "edit", { ...record, seats: 3 });
    expect(model.fields.map((f) => [f.field, f.input, f.text])).toEqual([
      ["id", "readonly", "it 1"],
      ["name", "text", "Alpha"],
      ["email", "email", "ops@example.test"],
      ["phone", "phone", "+1 (555) 010-0000"],
      ["seats", "number", "3"],
      ["renews_on", "date", ""],
      ["status", "select", "open"],
    ]);
    expect(model.fields.find((f) => f.field === "status")?.options).toEqual([
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ]);
    const typed = {
      ...model,
      fields: model.fields.map((f) =>
        f.field === "seats" ? { ...f, text: "12" } : f.field === "renews_on" ? { ...f, text: "2027-02-28" } : f,
      ),
    };
    const saved = { ...record, seats: 12, renews_on: "2027-02-28" };
    const api = fakeApi({ "PATCH /apps/fixture/items/it%201": { json: { item: saved } } });
    await expect(submitForm(api, ctx(fixtureScreens.edit), typed)).resolves.toEqual({ ok: true, record: saved });
    expect(api.calls[0]?.body).toEqual({
      values: { name: "Alpha", email: "ops@example.test", phone: "+1 (555) 010-0000", seats: 12, renews_on: "2027-02-28", status: "open" },
    });
  });

  it("create: POST <resource>; required, number, email, phone, date and select are checked before any request", async () => {
    const api = fakeApi({ "POST /apps/fixture/items": { status: 201, json: { item: { id: "new1", name: "Beta" } } } });
    const blank = formModel(ctx(fixtureScreens.create), "create", null);
    await expect(submitForm(api, ctx(fixtureScreens.create), blank)).resolves.toEqual({ ok: false, errors: { name: "Name is required" } });
    expect(api.calls).toEqual([]);
    const filled = { ...blank, fields: blank.fields.map((f) => ({ ...f, text: "Beta" })) };
    await expect(submitForm(api, ctx(fixtureScreens.create), filled)).resolves.toMatchObject({ ok: true, record: { id: "new1" } });
    expect(api.calls[0]).toEqual({ method: "POST", path: "/apps/fixture/items", body: { values: { name: "Beta" } } });

    const bad = formModel(ctx(fixtureScreens.edit), "edit", record);
    const set = (vals: Record<string, string>) => ({
      ...bad,
      fields: bad.fields.map((f) => (f.field in vals ? { ...f, text: vals[f.field]! } : f)),
    });
    const r = formValues(set({ seats: "many", email: "nope", phone: "call me", renews_on: "2027-02-30", status: "pending" }));
    expect(r).toEqual({
      ok: false,
      errors: {
        seats: "Seats must be a number",
        email: "Email must be an email address",
        phone: "Phone must be a phone number",
        renews_on: "Renews on must be a date as YYYY-MM-DD",
        status: "Status must be one of the choices",
      },
    });
  });

  it("a form the role may not use, or create on an :id resource, is refused", () => {
    expect(() => formModel(ctx(fixtureScreens.edit, "member"), "edit", record)).toThrow(/needs fixture.items.write/);
    expect(() => formModel(ctx(fixtureScreens.edit), "create", null)).toThrow(/cannot create/);
  });
});

describe("mobile-runtime renderer: the fixed actions", () => {
  const detail = ctx(fixtureScreens.detail);

  it("call and email open the phone's dialer and mail app with the record's value", async () => {
    const api = fakeApi({});
    await expect(runAction(api, detail, "fixture.call", record)).resolves.toEqual({ type: "open_url", url: "tel:+15550100000" });
    await expect(runAction(api, detail, "fixture.email", record)).resolves.toEqual({ type: "open_url", url: "mailto:ops@example.test" });
    await expect(runAction(api, detail, "fixture.call", { id: "z", phone: null })).rejects.toThrow(/no phone to call/);
    expect(api.calls).toEqual([]);
  });

  it("open_screen, create and edit navigate within the app (edit carries the record)", async () => {
    const api = fakeApi({});
    await expect(runAction(api, detail, "fixture.open_notes", record)).resolves.toEqual({
      type: "navigate",
      screen: "fixture.notes.list",
      recordId: "it 1",
      mode: "view",
      initial: null,
    });
    await expect(runAction(api, ctx(fixtureScreens.list), "fixture.new", null)).resolves.toEqual({
      type: "navigate",
      screen: "fixture.items.new",
      recordId: null,
      mode: "create",
      initial: null,
    });
    await expect(runAction(api, detail, "fixture.edit", record)).resolves.toEqual({
      type: "navigate",
      screen: "fixture.items.edit",
      recordId: "it 1",
      mode: "edit",
      initial: record,
    });
  });

  it("delete: DELETE <detail resource> answering 204", async () => {
    const api = fakeApi({ "DELETE /apps/fixture/items/it%201": { status: 204, json: null } });
    await expect(runAction(api, detail, "fixture.delete", record)).resolves.toEqual({ type: "deleted", recordId: "it 1" });
    expect(api.calls).toEqual([{ method: "DELETE", path: "/apps/fixture/items/it%201" }]);
  });

  it("invoke: POST <endpoint, :id replaced> with {}, and the result is shown as plain text", async () => {
    const api = fakeApi({ "POST /apps/fixture/items/it%201/check": { json: { message: "Check passed" } } });
    await expect(runAction(api, detail, "fixture.run_check", record)).resolves.toEqual({ type: "message", text: "Check passed" });
    expect(api.calls[0]).toEqual({ method: "POST", path: "/apps/fixture/items/it%201/check", body: {} });
    const quiet = fakeApi({ "POST /apps/fixture/items/it%201/check": { json: { message: null } } });
    await expect(runAction(quiet, detail, "fixture.run_check", record)).resolves.toEqual({ type: "message", text: "Done." });
  });

  it("refuses an action the role does not hold, even when asked directly", async () => {
    const api = fakeApi({});
    await expect(runAction(api, ctx(fixtureScreens.detail, "member"), "fixture.delete", record)).rejects.toThrow(
      /needs fixture.items.delete/,
    );
    expect(api.calls).toEqual([]);
  });

  it("stays inside the screen's own app: another app's endpoint or screen is refused", async () => {
    const api = fakeApi({});
    const foreign: MobileScreenT = {
      ...fixtureScreens.detail,
      actions: [
        { kind: "invoke", id: "x.steal", endpoint: "/apps/other/export", permission: "fixture.items.run" },
        { kind: "open_screen", id: "x.jump", screen: "other.secret.list" },
      ],
    };
    await expect(runAction(api, ctx(foreign), "x.steal", record)).rejects.toThrow(/may only call \/apps\/fixture\//);
    await expect(runAction(api, ctx(foreign), "x.jump", record)).rejects.toThrow(/may only open fixture screens/);
    expect(api.calls).toEqual([]);
  });
});

describe("mobile-runtime renderer: casing", () => {
  it("labels are upper case but never shout wOS or warOnSaaS", () => {
    expect(caps("wOS CRM pipeline")).toBe("wOS CRM PIPELINE");
    expect(caps("Built by warOnSaaS")).toBe("BUILT BY warOnSaaS");
    expect(caps("wosx")).toBe("WOSX");
  });
});
