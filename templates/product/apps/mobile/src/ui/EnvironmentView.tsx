/** Settings -> Environment: wOS Cloud by default, or a self-hosted wOS Core by address (WOS-APP-PROTOCOL section 8). */
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { WosClient } from "../runtime/client.js";
import { CLOUD_URL, type Environment } from "../runtime/environment.js";
import { Button, ErrorLine, Field } from "./parts";
import { s } from "./theme";

export function EnvironmentView(props: { client: WosClient; environments: Environment[]; error: string | null }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 24, gap: 12 }}>
      <Text style={s.logo}>wOS</Text>
      <Text style={s.label}>ENVIRONMENT</Text>
      <Text style={s.small}>
        Choose where your organization's apps run: wOS Cloud, hosted by warOnSaaS, or a wOS Core your organization runs itself.
      </Text>
      <ErrorLine error={props.error} />

      {props.environments.map((e) => (
        <View key={e.descriptor.environmentId} style={s.row}>
          <Text style={s.body}>{e.descriptor.name}</Text>
          <Text style={s.small}>
            {e.descriptor.kind === "cloud" ? "wOS CLOUD" : "SELF-HOSTED"} {e.url}
          </Text>
          <View style={{ marginTop: 8 }}>
            <Button
              label="OPEN"
              testID={`env-open-${e.descriptor.environmentId}`}
              disabled={busy}
              onPress={() => run(() => props.client.selectEnvironment(e.descriptor.environmentId))}
            />
          </View>
        </View>
      ))}

      <Button label="USE wOS CLOUD" primary testID="env-cloud" disabled={busy} onPress={() => run(() => props.client.connect(CLOUD_URL))} />
      <View style={s.rule} />
      <Field
        label="Self-hosted address"
        testID="env-address"
        placeholder="wos.example.com"
        autoCapitalize="none"
        keyboardType="url"
        value={address}
        onChangeText={setAddress}
      />
      <Button
        label="CONNECT"
        testID="env-connect"
        disabled={busy || address.trim().length === 0}
        onPress={() => run(() => props.client.connect(address))}
      />
    </ScrollView>
  );
}
