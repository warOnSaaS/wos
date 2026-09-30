/** Small building blocks shared by every view. */
import type { ReactNode } from "react";
import { Pressable, Text, TextInput, type TextInputProps, View } from "react-native";
import { caps } from "../runtime/renderer.js";
import { color, s } from "./theme";

export function Button(props: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={props.testID}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [s.button, props.primary && s.buttonPrimary, (props.disabled || pressed) && s.disabled]}
    >
      <Text style={[s.buttonText, props.primary && s.buttonTextPrimary]}>{props.label}</Text>
    </Pressable>
  );
}

export function Header(props: { title: string; subtitle?: string | null; onBack?: () => void }) {
  return (
    <View style={{ paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
      {props.onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="back" onPress={props.onBack} hitSlop={12}>
          <Text style={s.h1}>{"<"}</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={s.h1} numberOfLines={1}>
          {caps(props.title)}
        </Text>
        {props.subtitle ? <Text style={s.small}>{props.subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function Notice(props: { title?: string; children: ReactNode; testID?: string }) {
  return (
    <View style={s.notice} testID={props.testID}>
      {props.title ? <Text style={[s.label, { marginBottom: 4 }]}>{props.title}</Text> : null}
      <Text style={s.body}>{props.children}</Text>
    </View>
  );
}

export function ErrorLine(props: { error: string | null }) {
  if (!props.error) return null;
  return (
    <Notice title="ERROR" testID="error">
      {props.error}
    </Notice>
  );
}

export function Field(props: TextInputProps & { label: string; error?: string | null }) {
  const { label, error, ...input } = props;
  return (
    <View style={{ marginVertical: 8 }}>
      <Text style={[s.label, { marginBottom: 6 }]}>{caps(label)}</Text>
      <TextInput placeholderTextColor={color.muted} autoCorrect={false} style={s.input} {...input} />
      {error ? <Text style={[s.small, { marginTop: 4, color: color.fg }]}>{error}</Text> : null}
    </View>
  );
}
