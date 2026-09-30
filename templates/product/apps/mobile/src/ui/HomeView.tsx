/** Home: the navigation of the organization's active apps on this environment, and nothing else. */
import { ScrollView, Text, View } from "react-native";
import type { WosClient, WosState } from "../runtime/client.js";
import type { NavEntry } from "../runtime/navigation.js";
import { caps } from "../runtime/renderer.js";
import { Button, Notice } from "./parts";
import { s } from "./theme";

type Ready = Extract<WosState, { phase: "ready" }>;

export function HomeView(props: { client: WosClient; state: Ready; notice: string | null; onOpen: (entry: NavEntry) => void }) {
  const { state } = props;
  const d = state.environment.descriptor;
  const role = props.client.session?.role;
  const loaded = state.activeApps.apps !== null;
  return (
    <ScrollView style={s.page} contentContainerStyle={{ paddingVertical: 24, gap: 12 }}>
      <Text style={s.logo}>wOS</Text>
      <Text style={s.small}>
        {d.name} {"·"} {d.kind === "cloud" ? "wOS Cloud" : "self-hosted"}
        {role ? ` · ${role}` : ""}
      </Text>
      {props.notice ? <Notice title="NOTICE">{props.notice}</Notice> : null}
      {state.activeApps.error ? <Notice title="COULD NOT REFRESH APPS">{state.activeApps.error}</Notice> : null}

      <Text style={[s.label, { marginTop: 12 }]}>YOUR APPS</Text>
      <View style={s.rule} />
      {!loaded ? <Text style={s.small}>Reading this environment's apps...</Text> : null}
      {loaded && state.navigation.length === 0 ? (
        <Notice title="NO APPS ACTIVE" testID="nav-empty">
          No app your organization has active here has a mobile screen yet. Apps appear here when your organization enables them.
        </Notice>
      ) : null}
      {state.navigation.map((n) => (
        <View key={n.id} style={s.row}>
          <Text style={s.body} onPress={() => props.onOpen(n)} testID={`nav-${n.id}`} accessibilityRole="button">
            {caps(n.title)}
          </Text>
          <Text style={s.small}>{n.needsUpdate ? `${n.appName}: update wOS Mobile to open it on this phone.` : n.appName}</Text>
        </View>
      ))}

      <View style={{ marginTop: 24, gap: 12 }}>
        <Button label="CHANGE ENVIRONMENT" testID="home-switch" onPress={() => void props.client.switchEnvironment()} />
        <Button label="SIGN OUT" testID="home-signout" onPress={() => void props.client.signOut()} />
      </View>
    </ScrollView>
  );
}
