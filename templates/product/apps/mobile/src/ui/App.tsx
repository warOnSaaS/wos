/**
 * wOS Mobile's root: wires the runtime (WosClient) to the phone (secure storage, fetch, foreground events, the Android
 * back button) and draws the current state. One environment at a time; one stack of screens inside an app.
 */
// Per-weight entry points, so only the three font files used are bundled.
import { GeistMono_700Bold } from "@expo-google-fonts/geist-mono/700Bold";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono/700Bold";
import { useFonts } from "expo-font";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Platform, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { WosAppManifestT } from "../contracts.js";
import { BUNDLED_MOBILE_MODULES } from "../modules/index.js";
import { WosClient, type WosState } from "../runtime/client.js";
import type { HttpFetch } from "../runtime/http.js";
import { isActive, type NavEntry } from "../runtime/navigation.js";
import type { ScreenApi } from "../runtime/renderer.js";
import { type AppScreens, findScreen, loadScreens } from "../runtime/screens.js";
import type { SecureStore as Store } from "../runtime/storage.js";
import { EnvironmentView } from "./EnvironmentView";
import { HomeView } from "./HomeView";
import { Button, ErrorLine, Header, Notice } from "./parts";
import { type ScreenRoute, ScreenView } from "./ScreenView";
import { SignInView } from "./SignInView";
import { color, s } from "./theme";

/** expo-secure-store: iOS Keychain / Android Keystore. Readable only while the phone is unlocked after first unlock. */
const secureStore: Store = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  deleteItem: (k) => SecureStore.deleteItemAsync(k),
};

const phoneFetch: HttpFetch = (url, init) => fetch(url, init);

export default function App() {
  const [fontsLoaded] = useFonts({ GeistMono_700Bold, JetBrainsMono_400Regular, JetBrainsMono_700Bold });
  const client = useMemo(
    () =>
      new WosClient({
        fetch: phoneFetch,
        store: secureStore,
        platform: Platform.OS === "android" ? "android" : "ios",
        modules: BUNDLED_MOBILE_MODULES,
      }),
    [],
  );
  const [state, setState] = useState<WosState>(client.current);

  useEffect(() => {
    const unsub = client.subscribe(setState);
    void client.init();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void client.onForeground();
    });
    return () => {
      unsub();
      sub.remove();
      client.dispose();
    };
  }, [client]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.fill} edges={["top", "bottom"]}>
        <StatusBar style="light" />
        {fontsLoaded ? <Body client={client} state={state} /> : <Loading />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Loading() {
  return (
    <View style={[s.fill, { justifyContent: "center" }]}>
      <ActivityIndicator color={color.fg} />
    </View>
  );
}

function Body(props: { client: WosClient; state: WosState }) {
  const { client, state } = props;
  if (state.phase === "loading") return <Loading />;
  if (state.phase === "choose_environment")
    return <EnvironmentView client={client} environments={state.environments} error={state.error} />;
  if (state.phase === "sign_in")
    return <SignInView client={client} environment={state.environment} signIn={state.signIn} error={state.error} />;
  return <Ready client={client} state={state} />;
}

function Ready(props: { client: WosClient; state: Extract<WosState, { phase: "ready" }> }) {
  const { client, state } = props;
  const [stack, setStack] = useState<ScreenRoute[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const top = stack[stack.length - 1] ?? null;

  // V1 proof step 7: an app disabled while open leaves the phone at the next ActiveApps refresh.
  useEffect(() => {
    if (top && state.activeApps.apps && !isActive(state.activeApps.apps.apps, top.app)) {
      setStack([]);
      setNotice("That app is no longer active for your organization on this environment. Its data is kept.");
    }
  }, [state.activeApps.apps, top]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length === 0) return false;
      setStack((st) => st.slice(0, -1));
      return true;
    });
    return () => sub.remove();
  }, [stack.length]);

  const open = (n: NavEntry) => {
    setNotice(null);
    if (n.screen) setStack([{ app: n.app, screenId: n.screen, recordId: null, mode: "view", initial: null }]);
    else setNotice(`${n.appName} is active for your organization, but this version of wOS Mobile does not include it. Update wOS Mobile.`);
  };

  if (!top) return <HomeView client={client} state={state} notice={notice} onOpen={open} />;
  return (
    <AppView
      client={client}
      route={top}
      manifestOf={(app) => state.activeApps.apps?.apps.find((a) => a.id === app)?.manifest ?? null}
      push={(r) => setStack((st) => [...st, r])}
      pop={() => setStack((st) => st.slice(0, -1))}
    />
  );
}

function AppView(props: {
  client: WosClient;
  route: ScreenRoute;
  manifestOf: (app: string) => WosAppManifestT | null;
  push: (r: ScreenRoute) => void;
  pop: () => void;
}) {
  const { client, route } = props;
  const [screens, setScreens] = useState<AppScreens | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = client.session;

  useEffect(() => {
    if (!session) return;
    let live = true;
    loadScreens(session, route.app, BUNDLED_MOBILE_MODULES.get(route.app))
      .then((r) => live && setScreens(r))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [session, route.app]);

  const api: ScreenApi | null = useMemo(() => (session ? (req) => session.authorized(req) : null), [session]);
  const manifest = props.manifestOf(route.app);
  const role = session?.role ?? null;
  const screen = screens ? findScreen(screens, route.screenId) : null;
  const ctx = useMemo(() => (screen && manifest && role ? { screen, manifest, role } : null), [screen, manifest, role]);

  if (error || (screens && !screen))
    return (
      <View style={s.page}>
        <Header title={manifest?.app.name ?? route.app} onBack={props.pop} />
        <ErrorLine error={error ?? `this environment does not offer ${route.screenId} to you`} />
        <Button label="BACK" onPress={props.pop} />
      </View>
    );
  if (!ctx || !api || !screens) return <Loading />;
  return (
    <View style={s.fill}>
      {screens.source === "bundled" ? (
        <Notice title="OFFLINE">Showing the screens built into wOS Mobile; data needs this environment.</Notice>
      ) : null}
      <ScreenView
        key={`${route.screenId}:${route.recordId ?? ""}`}
        api={api}
        ctx={ctx}
        screens={screens.screens}
        route={route}
        push={props.push}
        pop={props.pop}
      />
    </View>
  );
}
