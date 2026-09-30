/** Sign-in to the selected environment: an email, then the 8-character code it receives. */
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import type { SignInStep, WosClient } from "../runtime/client.js";
import type { Environment } from "../runtime/environment.js";
import { Button, ErrorLine, Field, Header, Notice } from "./parts";
import { s } from "./theme";

export function SignInView(props: { client: WosClient; environment: Environment; signIn: SignInStep; error: string | null }) {
  const { client, environment, signIn } = props;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const d = environment.descriptor;
  return (
    <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 24, gap: 12 }}>
      <Text style={s.logo}>wOS</Text>
      <Header title="Sign in" subtitle={`${d.name} · ${d.kind === "cloud" ? "wOS Cloud" : "self-hosted"}`} />
      <ErrorLine error={props.error} />

      {signIn.step === "email" ? (
        <>
          <Text style={s.small}>
            {d.auth.kind === "wos_cloud"
              ? "Sign in with your wOS account. We email you a code."
              : "Sign in to this environment. Its operator's mail server sends you a code."}
          </Text>
          <Field
            label="Email"
            testID="signin-email"
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />
          <Button
            label="SEND CODE"
            primary
            testID="signin-send"
            disabled={busy || !email.includes("@")}
            onPress={() => run(() => client.startSignIn(email))}
          />
        </>
      ) : null}

      {signIn.step === "code" ? (
        <>
          <Text style={s.small}>A code was sent to {signIn.email}. It works once, for 15 minutes.</Text>
          <Field
            label="Code"
            testID="signin-code"
            autoCapitalize="characters"
            placeholder="XXXX-XXXX"
            textContentType="oneTimeCode"
            value={code}
            onChangeText={setCode}
          />
          <Button
            label="SIGN IN"
            primary
            testID="signin-redeem"
            disabled={busy || code.trim().length < 8}
            onPress={() => run(() => client.redeemCode(code))}
          />
          <Button label="USE ANOTHER EMAIL" disabled={busy} onPress={() => client.restartSignIn()} />
        </>
      ) : null}

      {signIn.step === "blocked" ? (
        <>
          <Notice title="NOT AVAILABLE YET" testID="signin-blocked">
            {signIn.message}
          </Notice>
          <Button label="BACK" onPress={() => client.restartSignIn()} />
        </>
      ) : null}

      <Button label="CHANGE ENVIRONMENT" testID="signin-switch" disabled={busy} onPress={() => run(() => client.switchEnvironment())} />
    </ScrollView>
  );
}
