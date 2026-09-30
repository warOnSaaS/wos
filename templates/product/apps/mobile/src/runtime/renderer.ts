/**
 * The `wos-screen.v1` renderer (WOS-APP-PROTOCOL section 9), without React: it turns a screen and the data its app's
 * API returned into a view model the React Native views draw one-to-one, and it carries out the fixed actions with the
 * HTTP semantics of the `ScreenListData` doc comment in contracts wos-app.ts:
 *
 *   list     GET <resource>[?q=<search>][&cursor=<nextCursor>]            -> ScreenListData
 *   detail   GET <resource> with `:id` replaced by the tapped record's id   -> ScreenRecordData
 *   related  GET <detail resource>/<relationship>                           -> ScreenListData (drawn with the related_list's list screen)
 *   create   POST <form screen resource> with ScreenFormBody                -> ScreenRecordData
 *   edit     PATCH <form screen resource, :id replaced> with ScreenFormBody -> ScreenRecordData
 *   delete   DELETE <detail resource>                                       -> 204
 *   invoke   POST <endpoint, :id replaced> with {}                          -> ScreenInvokeResult
 *
 * Rules it enforces beyond the schema: every request stays under the screen's own `/apps/<app>/` (an `invoke` endpoint
 * of another app is refused), a screen and each action need their declared permission for the caller's role, and a
 * screen only opens screens of its own app. Values are shown as text; nothing from a screen or a record is executed.
 */
import {
  type MobileScreenT,
  type OrgRoleT,
  type ScreenActionT,
  ScreenFormBody,
  ScreenInvokeResult,
  ScreenListData,
  ScreenRecordData,
  type ScreenRecordT,
  type ScreenValueT,
  type WosAppManifestT,
} from "../contracts.js";
import { type HttpMethod, HttpError, queryString } from "./http.js";
import { roleHas } from "./navigation.js";

/** How the renderer reaches the app's API: `EnvironmentSession.authorized` on a phone, a fake or Core in tests. */
export type ScreenApi = (req: { method: HttpMethod; path: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;

export type ScreenContext = { screen: MobileScreenT; manifest: WosAppManifestT; role: OrgRoleT };

export class ScreenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenError";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------

/** Replaces `:id` with the record id (URL-encoded). A resource needing an id without one, or any other placeholder, is refused. */
export function resolvePath(template: string, id: string | null): string {
  const needsId = template.includes(":id");
  if (needsId && (id === null || id.length === 0)) throw new ScreenError(`${template} needs a record id`);
  const out = needsId ? template.split(":id").join(encodeURIComponent(id as string)) : template;
  if (out.includes(":")) throw new ScreenError(`${template} has a placeholder wOS Mobile does not know`);
  return out;
}

function ownPath(ctx: ScreenContext, path: string): string {
  if (!path.startsWith(`/apps/${ctx.screen.app}/`)) throw new ScreenError(`${ctx.screen.id} may only call /apps/${ctx.screen.app}/`);
  return path;
}

export function listPath(screen: MobileScreenT, opts: { q?: string | null; cursor?: string | null } = {}): string {
  const q = screen.list?.search ? (opts.q ?? "").trim() : "";
  return `${resolvePath(screen.resource, null)}${queryString({ q, cursor: opts.cursor ?? null })}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------------------

/** "first_name" -> "First name". */
export function humanize(field: string): string {
  const s = field.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? field : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Upper case for labels, keeping the brand's casing: "wOS" and "warOnSaaS" are never shouted (AGENTS.md casing rule).
 */
export function caps(text: string): string {
  return text
    .toUpperCase()
    .replace(/\bWOS\b/g, "wOS")
    .replace(/\bWARONSAAS\b/g, "warOnSaaS");
}

/** A value as text: null shows as an em dash, booleans as Yes/No. Never markup. */
export function formatValue(v: ScreenValueT | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function screenTitle(screen: MobileScreenT, record: ScreenRecordT | null): string {
  if ("text" in screen.title) return screen.title.text;
  const v = record?.[screen.title.field];
  return v === undefined || v === null || v === "" ? humanize(screen.title.field) : String(v);
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------

export type ActionModel = { id: string; kind: ScreenActionT["kind"]; label: string; enabled: boolean };

const ACTION_LABEL: Record<ScreenActionT["kind"], string> = {
  call: "CALL",
  email: "EMAIL",
  open_screen: "OPEN",
  create: "NEW",
  edit: "EDIT",
  delete: "DELETE",
  invoke: "RUN",
};

function actionPermission(a: ScreenActionT): string | null {
  return "permission" in a ? a.permission : null;
}

function actionLabel(a: ScreenActionT): string {
  if (a.kind !== "invoke" && a.kind !== "open_screen") return ACTION_LABEL[a.kind];
  const last = a.id.split(".").pop() ?? a.id;
  return caps(humanize(last));
}

/**
 * The actions shown for a screen (and record): those whose permission the role holds. `call` and `email` are shown
 * disabled when the record has no value in their field; record actions are disabled without a record.
 */
export function visibleActions(ctx: ScreenContext, record: ScreenRecordT | null): ActionModel[] {
  const out: ActionModel[] = [];
  for (const a of ctx.screen.actions) {
    const p = actionPermission(a);
    if (p !== null && !roleHas(ctx.manifest, ctx.role, p)) continue;
    let enabled = true;
    if (a.kind === "call" || a.kind === "email") {
      const v = record?.[a.field];
      enabled = typeof v === "string" && v.trim().length > 0;
    } else if (a.kind === "edit" || a.kind === "delete") {
      enabled = record !== null;
    } else if (a.kind === "invoke") {
      enabled = record !== null || !a.endpoint.includes(":id");
    }
    out.push({ id: a.id, kind: a.kind, label: actionLabel(a), enabled });
  }
  return out;
}

export type ActionOutcome =
  | { type: "open_url"; url: string }
  | { type: "navigate"; screen: string; recordId: string | null; mode: "view" | "create" | "edit"; initial: ScreenRecordT | null }
  | { type: "deleted"; recordId: string }
  | { type: "message"; text: string };

function sameAppScreen(ctx: ScreenContext, screen: string): string {
  if (!screen.startsWith(`${ctx.screen.app}.`)) throw new ScreenError(`${ctx.screen.id} may only open ${ctx.screen.app} screens`);
  return screen;
}

/**
 * Carries out one action. `delete` and `invoke` call the API (the view asks for confirmation before `delete`); the
 * others return what the view does next. An action the role does not hold is refused here too, not only hidden.
 */
export async function runAction(
  api: ScreenApi,
  ctx: ScreenContext,
  actionId: string,
  record: ScreenRecordT | null,
): Promise<ActionOutcome> {
  const a = ctx.screen.actions.find((x) => x.id === actionId);
  if (!a) throw new ScreenError(`${ctx.screen.id} has no action ${actionId}`);
  const p = actionPermission(a);
  if (p !== null && !roleHas(ctx.manifest, ctx.role, p)) throw new ScreenError(`needs ${p}`);
  switch (a.kind) {
    case "call": {
      const v = record?.[a.field];
      const digits = typeof v === "string" ? v.replace(/[^0-9+*#,;]/g, "") : "";
      if (digits.length === 0) throw new ScreenError(`no ${humanize(a.field).toLowerCase()} to call`);
      return { type: "open_url", url: `tel:${digits}` };
    }
    case "email": {
      const v = record?.[a.field];
      if (typeof v !== "string" || !/^[^\s@]+@[^\s@]+$/.test(v.trim()))
        throw new ScreenError(`no ${humanize(a.field).toLowerCase()} to email`);
      return { type: "open_url", url: `mailto:${encodeURIComponent(v.trim()).replace(/%40/g, "@")}` };
    }
    case "open_screen":
      return { type: "navigate", screen: sameAppScreen(ctx, a.screen), recordId: record?.id ?? null, mode: "view", initial: null };
    case "create":
      return { type: "navigate", screen: sameAppScreen(ctx, a.screen), recordId: null, mode: "create", initial: null };
    case "edit": {
      if (!record) throw new ScreenError("nothing to edit");
      return { type: "navigate", screen: sameAppScreen(ctx, a.screen), recordId: record.id, mode: "edit", initial: record };
    }
    case "delete": {
      if (!record) throw new ScreenError("nothing to delete");
      const r = await api({ method: "DELETE", path: ownPath(ctx, resolvePath(ctx.screen.resource, record.id)) });
      if (r.status !== 204 && r.status !== 200) throw new ScreenError(`delete answered ${r.status}`);
      return { type: "deleted", recordId: record.id };
    }
    case "invoke": {
      const r = await api({ method: "POST", path: ownPath(ctx, resolvePath(a.endpoint, record?.id ?? null)), body: {} });
      const parsed = ScreenInvokeResult.safeParse(r.json);
      if (!parsed.success) throw new ScreenError("the app answered in a form wOS Mobile does not understand");
      return { type: "message", text: parsed.data.message ?? "Done." };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------------------------------------------

export type ListRow = { id: string; primary: string; secondary: { label: string; value: string }[]; opens: string | null };
export type ListModel = {
  kind: "list";
  screenId: string;
  title: string;
  search: boolean;
  rows: ListRow[];
  /** Rows loaded so far (the API pages with a cursor; there is no total). */
  count: number;
  nextCursor: string | null;
  /** Set when there are no rows: what the screen says instead of records. Never sample data. */
  empty: { title: string; body: string } | null;
  actions: ActionModel[];
};

function assertScreenAllowed(ctx: ScreenContext) {
  if (!roleHas(ctx.manifest, ctx.role, ctx.screen.permission)) throw new ScreenError(`needs ${ctx.screen.permission}`);
  if (ctx.screen.app !== ctx.manifest.app.id) throw new ScreenError(`${ctx.screen.id} does not belong to ${ctx.manifest.app.id}`);
}

export function listModel(ctx: ScreenContext, data: { items: ScreenRecordT[]; nextCursor: string | null }, q = ""): ListModel {
  const list = ctx.screen.list;
  if (ctx.screen.kind !== "list" || !list) throw new ScreenError(`${ctx.screen.id} is not a list screen`);
  const [first, ...rest] = list.fields;
  const rows = data.items.map((item) => ({
    id: item.id,
    primary: formatValue(first ? item[first] : item.id),
    secondary: rest.map((f) => ({ label: humanize(f), value: formatValue(item[f]) })),
    opens: list.onTap,
  }));
  const searching = list.search && q.trim().length > 0;
  return {
    kind: "list",
    screenId: ctx.screen.id,
    title: screenTitle(ctx.screen, null),
    search: list.search,
    rows,
    count: rows.length,
    nextCursor: data.nextCursor,
    empty:
      rows.length > 0
        ? null
        : searching
          ? { title: "0 MATCHES", body: `Nothing matches “${q.trim()}”.` }
          : {
              title: "0 RECORDS",
              body: `${ctx.manifest.app.name} has nothing to show here yet. It shows only what is built and stored, never samples.`,
            },
    actions: visibleActions(ctx, null),
  };
}

/** GET the list (first page, or the page after `cursor`) and build its model; `previous` rows are kept when paging. */
export async function loadList(
  api: ScreenApi,
  ctx: ScreenContext,
  opts: { q?: string; cursor?: string | null; previous?: ListModel } = {},
): Promise<ListModel> {
  assertScreenAllowed(ctx);
  const r = await api({ method: "GET", path: ownPath(ctx, listPath(ctx.screen, { q: opts.q ?? null, cursor: opts.cursor ?? null })) });
  const data = ScreenListData.safeParse(r.json);
  if (!data.success) throw new ScreenError("the app sent a list wOS Mobile does not understand");
  const model = listModel(ctx, data.data, opts.q ?? "");
  if (!opts.previous || !opts.cursor) return model;
  const rows = [...opts.previous.rows, ...model.rows];
  return { ...model, rows, count: rows.length, empty: rows.length > 0 ? null : model.empty };
}

// ---------------------------------------------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------------------------------------------

export type DetailSection =
  | { type: "fields"; rows: { field: string; label: string; value: string }[] }
  | { type: "related"; relationship: string; label: string; screen: string; list: ListModel | null; error: string | null };

export type DetailModel = {
  kind: "detail";
  screenId: string;
  recordId: string;
  title: string;
  sections: DetailSection[];
  actions: ActionModel[];
  record: ScreenRecordT;
};

export function detailModel(ctx: ScreenContext, record: ScreenRecordT, related: Record<string, ListModel | string> = {}): DetailModel {
  if (ctx.screen.kind !== "detail") throw new ScreenError(`${ctx.screen.id} is not a detail screen`);
  const sections: DetailSection[] = ctx.screen.sections.map((s) => {
    if (s.type === "fields")
      return {
        type: "fields",
        rows: s.fields.map((f) => ({ field: f.field, label: f.label ?? humanize(f.field), value: formatValue(record[f.field]) })),
      };
    const r = related[s.relationship];
    return {
      type: "related",
      relationship: s.relationship,
      label: caps(humanize(s.relationship)),
      screen: s.screen,
      list: typeof r === "object" ? r : null,
      error: typeof r === "string" ? r : null,
    };
  });
  return {
    kind: "detail",
    screenId: ctx.screen.id,
    recordId: record.id,
    title: screenTitle(ctx.screen, record),
    sections,
    actions: visibleActions(ctx, record),
    record,
  };
}

/**
 * GET the record, then each related list at `<detail resource>/<relationship>`, drawn with the related_list's list
 * screen (looked up in `screens`). A related list that fails shows its error in place; the record still shows.
 */
export async function loadDetail(
  api: ScreenApi,
  ctx: ScreenContext,
  recordId: string,
  screens: readonly MobileScreenT[],
): Promise<DetailModel> {
  assertScreenAllowed(ctx);
  const path = ownPath(ctx, resolvePath(ctx.screen.resource, recordId));
  const r = await api({ method: "GET", path });
  const data = ScreenRecordData.safeParse(r.json);
  if (!data.success) throw new ScreenError("the app sent a record wOS Mobile does not understand");
  const related: Record<string, ListModel | string> = {};
  for (const s of ctx.screen.sections) {
    if (s.type !== "related_list") continue;
    const listScreen = screens.find((x) => x.id === s.screen && x.kind === "list");
    if (!listScreen || listScreen.app !== ctx.screen.app) {
      related[s.relationship] = `${s.screen} is not a list screen of ${ctx.screen.app}`;
      continue;
    }
    if (!roleHas(ctx.manifest, ctx.role, listScreen.permission)) continue;
    try {
      const rr = await api({ method: "GET", path: ownPath(ctx, `${path}/${s.relationship}`) });
      const list = ScreenListData.safeParse(rr.json);
      if (!list.success) throw new ScreenError("the app sent a list wOS Mobile does not understand");
      related[s.relationship] = listModel({ ...ctx, screen: listScreen }, list.data);
    } catch (err) {
      related[s.relationship] = err instanceof Error ? err.message : String(err);
    }
  }
  return detailModel(ctx, data.data.item, related);
}

// ---------------------------------------------------------------------------------------------------------------
// form
// ---------------------------------------------------------------------------------------------------------------

type FieldSpecT = Extract<MobileScreenT["sections"][number], { type: "fields" }>["fields"][number];

export type FormField = {
  field: string;
  label: string;
  input: FieldSpecT["input"];
  required: boolean;
  options: { value: string; label: string }[] | null;
  /** The text in the input (the view edits this; `submitForm` converts it). */
  text: string;
};

export type FormModel = {
  kind: "form";
  screenId: string;
  mode: "create" | "edit";
  recordId: string | null;
  title: string;
  fields: FormField[];
};

function fieldsOf(screen: MobileScreenT): FieldSpecT[] {
  return screen.sections.flatMap((s) => (s.type === "fields" ? s.fields : []));
}

export function formModel(ctx: ScreenContext, mode: "create" | "edit", initial: ScreenRecordT | null): FormModel {
  if (ctx.screen.kind !== "form") throw new ScreenError(`${ctx.screen.id} is not a form screen`);
  assertScreenAllowed(ctx);
  if (mode === "edit" && !initial) throw new ScreenError("edit needs the record");
  if (mode === "create" && ctx.screen.resource.includes(":id"))
    throw new ScreenError(`${ctx.screen.id} edits a record; it cannot create one`);
  return {
    kind: "form",
    screenId: ctx.screen.id,
    mode,
    recordId: initial?.id ?? null,
    title: screenTitle(ctx.screen, initial),
    fields: fieldsOf(ctx.screen).map((f) => {
      const v = initial?.[f.field];
      return {
        field: f.field,
        label: f.label ?? humanize(f.field),
        input: f.input,
        required: f.required,
        options: f.options ?? null,
        text: v === undefined || v === null ? "" : String(v),
      };
    }),
  };
}

/** Converts the typed text to values and checks them; returns field errors, or the `ScreenFormBody`. */
export function formValues(model: FormModel): { ok: true; body: ScreenFormBody } | { ok: false; errors: Record<string, string> } {
  const values: Record<string, ScreenValueT> = {};
  const errors: Record<string, string> = {};
  for (const f of model.fields) {
    if (f.input === "readonly") continue;
    const t = f.text.trim();
    if (t.length === 0) {
      if (f.required) errors[f.field] = `${f.label} is required`;
      else values[f.field] = null;
      continue;
    }
    switch (f.input) {
      case "number": {
        const n = Number(t);
        if (!Number.isFinite(n)) errors[f.field] = `${f.label} must be a number`;
        else values[f.field] = n;
        break;
      }
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) errors[f.field] = `${f.label} must be an email address`;
        else values[f.field] = t;
        break;
      case "phone":
        if (!/^\+?[0-9 ()./-]{3,30}$/.test(t)) errors[f.field] = `${f.label} must be a phone number`;
        else values[f.field] = t;
        break;
      case "date": {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        const d = m ? new Date(`${t}T00:00:00Z`) : null;
        if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t)
          errors[f.field] = `${f.label} must be a date as YYYY-MM-DD`;
        else values[f.field] = t;
        break;
      }
      case "select":
        if (!f.options?.some((o) => o.value === t)) errors[f.field] = `${f.label} must be one of the choices`;
        else values[f.field] = t;
        break;
      default:
        values[f.field] = t;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: ScreenFormBody.parse({ values }) };
}

/** POST (create) or PATCH (edit, `:id` replaced) the form; returns the saved record. */
export async function submitForm(
  api: ScreenApi,
  ctx: ScreenContext,
  model: FormModel,
): Promise<{ ok: true; record: ScreenRecordT } | { ok: false; errors: Record<string, string> }> {
  assertScreenAllowed(ctx);
  const v = formValues(model);
  if (!v.ok) return v;
  const path = ownPath(ctx, resolvePath(ctx.screen.resource, model.mode === "edit" ? model.recordId : null));
  const r = await api({ method: model.mode === "create" ? "POST" : "PATCH", path, body: v.body });
  const data = ScreenRecordData.safeParse(r.json);
  if (!data.success) throw new ScreenError("the app sent a record wOS Mobile does not understand");
  return { ok: true, record: data.data.item };
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
