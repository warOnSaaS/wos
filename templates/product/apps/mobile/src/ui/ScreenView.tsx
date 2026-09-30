/**
 * Draws one `wos-screen.v1` screen from the renderer's view model (runtime/renderer.ts): list, detail or form, with the
 * fixed actions. All decisions (paths, permissions, validation, outcomes) are in the renderer; this file only draws.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { MobileScreenT, ScreenRecordT } from "../contracts.js";
import {
  type ActionModel,
  type DetailModel,
  type FormModel,
  type ListModel,
  loadDetail,
  loadList,
  caps,
  runAction,
  type ScreenApi,
  type ScreenContext,
  formModel,
  submitForm,
} from "../runtime/renderer.js";
import { Button, ErrorLine, Field, Header, Notice } from "./parts";
import { color, s } from "./theme";

export type ScreenRoute = {
  app: string;
  screenId: string;
  recordId: string | null;
  mode: "view" | "create" | "edit";
  initial: ScreenRecordT | null;
};

type Props = {
  api: ScreenApi;
  ctx: ScreenContext;
  screens: readonly MobileScreenT[];
  route: ScreenRoute;
  push: (r: ScreenRoute) => void;
  pop: () => void;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function ScreenView(props: Props) {
  const kind = props.ctx.screen.kind;
  if (kind === "list") return <ListScreen {...props} />;
  if (kind === "detail") return <DetailScreen {...props} />;
  return <FormScreen {...props} />;
}

function useAction(props: Props) {
  return useCallback(
    async (a: ActionModel, record: ScreenRecordT | null, after?: () => void) => {
      const go = async () => {
        try {
          const out = await runAction(props.api, props.ctx, a.id, record);
          if (out.type === "open_url") await Linking.openURL(out.url);
          else if (out.type === "navigate")
            props.push({ app: props.ctx.screen.app, screenId: out.screen, recordId: out.recordId, mode: out.mode, initial: out.initial });
          else if (out.type === "deleted") props.pop();
          else Alert.alert(a.label, out.text);
          after?.();
        } catch (err) {
          Alert.alert(a.label, message(err));
        }
      };
      if (a.kind === "delete")
        Alert.alert("DELETE", "Delete this record? This cannot be undone here.", [
          { text: "CANCEL", style: "cancel" },
          { text: "DELETE", style: "destructive", onPress: () => void go() },
        ]);
      else await go();
    },
    [props],
  );
}

function Actions(props: { actions: ActionModel[]; onPress: (a: ActionModel) => void }) {
  if (props.actions.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 }}>
      {props.actions.map((a) => (
        <Button key={a.id} label={a.label} testID={`action-${a.id}`} disabled={!a.enabled} onPress={() => props.onPress(a)} />
      ))}
    </View>
  );
}

function ListScreen(props: Props) {
  const [model, setModel] = useState<ListModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const act = useAction(props);

  const load = useCallback(
    async (opts: { q?: string; more?: ListModel }) => {
      setBusy(true);
      try {
        const next = await loadList(props.api, props.ctx, { q: opts.q, cursor: opts.more?.nextCursor ?? null, previous: opts.more });
        setModel(next);
        setError(null);
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
    },
    [props.api, props.ctx],
  );

  useEffect(() => {
    const t = setTimeout(() => void load({ q }), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <View style={s.page} testID={`screen-${props.ctx.screen.id}`}>
      <Header title={model?.title ?? props.ctx.manifest.app.name} subtitle={props.ctx.manifest.app.name} onBack={props.pop} />
      {props.ctx.screen.list?.search ? (
        <Field label="Search" testID="list-search" value={q} onChangeText={setQ} autoCapitalize="none" />
      ) : null}
      <ErrorLine error={error} />
      {model ? <Actions actions={model.actions} onPress={(a) => void act(a, null)} /> : null}
      {!model && busy ? <ActivityIndicator color={color.fg} /> : null}
      {model?.empty ? (
        <Notice title={model.empty.title} testID="list-empty">
          {model.empty.body}
        </Notice>
      ) : null}
      {model && !model.empty ? (
        <Text style={[s.label, { marginVertical: 8 }]}>{`${model.count}${model.nextCursor ? "+" : ""} SHOWN`}</Text>
      ) : null}
      <FlatList
        data={model?.rows ?? []}
        keyExtractor={(r) => r.id}
        onRefresh={() => void load({ q })}
        refreshing={busy && model !== null}
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            disabled={!item.opens}
            testID={`row-${item.id}`}
            onPress={() =>
              item.opens && props.push({ app: props.ctx.screen.app, screenId: item.opens, recordId: item.id, mode: "view", initial: null })
            }
          >
            <Text style={s.body}>{item.primary}</Text>
            {item.secondary.map((c) => (
              <Text key={c.label} style={s.small}>
                {c.label}: {c.value}
              </Text>
            ))}
          </Pressable>
        )}
        ListFooterComponent={
          model?.nextCursor ? (
            <Button label="LOAD MORE" testID="list-more" disabled={busy} onPress={() => void load({ q, more: model })} />
          ) : null
        }
      />
    </View>
  );
}

function DetailScreen(props: Props) {
  const [model, setModel] = useState<DetailModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useAction(props);
  const recordId = props.route.recordId;

  const load = useCallback(async () => {
    if (!recordId) return setError("no record to show");
    try {
      setModel(await loadDetail(props.api, props.ctx, recordId, props.screens));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, [props.api, props.ctx, props.screens, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView style={s.page} testID={`screen-${props.ctx.screen.id}`} contentContainerStyle={{ paddingBottom: 24 }}>
      <Header title={model?.title ?? ""} subtitle={props.ctx.manifest.app.name} onBack={props.pop} />
      <ErrorLine error={error} />
      {!model && !error ? <ActivityIndicator color={color.fg} /> : null}
      {model ? <Actions actions={model.actions} onPress={(a) => void act(a, model.record, () => void load())} /> : null}
      {model?.sections.map((sec, i) =>
        sec.type === "fields" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: sections have no id and never reorder
          <View key={i} style={{ marginVertical: 8 }}>
            {sec.rows.map((r) => (
              <View key={r.field} style={s.row}>
                <Text style={s.label}>{caps(r.label)}</Text>
                <Text style={s.body} selectable>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View key={sec.relationship} style={{ marginVertical: 8 }}>
            <Text style={s.label}>{sec.label}</Text>
            {sec.error ? <Text style={s.small}>{sec.error}</Text> : null}
            {sec.list?.empty ? <Text style={s.small}>{sec.list.empty.title}</Text> : null}
            {sec.list?.rows.map((row) => (
              <Pressable
                key={row.id}
                style={s.row}
                disabled={!row.opens}
                onPress={() =>
                  row.opens && props.push({ app: props.ctx.screen.app, screenId: row.opens, recordId: row.id, mode: "view", initial: null })
                }
              >
                <Text style={s.body}>{row.primary}</Text>
              </Pressable>
            ))}
          </View>
        ),
      )}
    </ScrollView>
  );
}

function FormScreen(props: Props) {
  const mode = props.route.mode === "edit" ? "edit" : "create";
  const [model, setModel] = useState<FormModel | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setModel(formModel(props.ctx, mode, props.route.initial));
    } catch (err) {
      setError(message(err));
    }
  }, [props.ctx, mode, props.route.initial]);

  const setText = (field: string, text: string) =>
    setModel((m) => (m ? { ...m, fields: m.fields.map((f) => (f.field === field ? { ...f, text } : f)) } : m));

  const save = async () => {
    if (!model) return;
    setBusy(true);
    try {
      const r = await submitForm(props.api, props.ctx, model);
      if (!r.ok) setErrors(r.errors);
      else props.pop();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={s.page}
      testID={`screen-${props.ctx.screen.id}`}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      <Header title={model?.title ?? ""} subtitle={mode === "create" ? "NEW" : "EDIT"} onBack={props.pop} />
      <ErrorLine error={error} />
      {model?.fields.map((f) =>
        f.input === "readonly" ? (
          <View key={f.field} style={s.row}>
            <Text style={s.label}>{caps(f.label)}</Text>
            <Text style={s.body}>{f.text || "—"}</Text>
          </View>
        ) : f.input === "select" ? (
          <View key={f.field} style={{ marginVertical: 8 }}>
            <Text style={[s.label, { marginBottom: 6 }]}>{`${caps(f.label)}${f.required ? " *" : ""}`}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(f.options ?? []).map((o) => (
                <Button
                  key={o.value}
                  label={o.label}
                  primary={f.text === o.value}
                  onPress={() => setText(f.field, f.text === o.value ? "" : o.value)}
                />
              ))}
            </View>
            {errors[f.field] ? <Text style={s.small}>{errors[f.field]}</Text> : null}
          </View>
        ) : (
          <Field
            key={f.field}
            label={`${f.label}${f.required ? " *" : ""}`}
            testID={`form-${f.field}`}
            value={f.text}
            onChangeText={(t) => setText(f.field, t)}
            error={errors[f.field] ?? null}
            autoCapitalize={f.input === "text" ? "sentences" : "none"}
            keyboardType={
              f.input === "number" ? "numeric" : f.input === "email" ? "email-address" : f.input === "phone" ? "phone-pad" : "default"
            }
            placeholder={f.input === "date" ? "YYYY-MM-DD" : undefined}
          />
        ),
      )}
      {model ? <Button label="SAVE" primary testID="form-save" disabled={busy} onPress={() => void save()} /> : null}
    </ScrollView>
  );
}
