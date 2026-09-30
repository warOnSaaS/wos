/**
 * The wOS look on a phone: monochrome military-ops, never marketing. Off-white on #0b0b0b, one line colour, no accent
 * colour, no gradients, no illustrations. The logo is "wOS" in Geist Mono Bold; everything else is JetBrains Mono.
 */
import { StyleSheet } from "react-native";

export const color = {
  bg: "#0b0b0b",
  surface: "#131313",
  fg: "#ededed",
  muted: "#8c8c8c",
  line: "#2a2a2a",
  inverseFg: "#0b0b0b",
} as const;

export const font = {
  logo: "GeistMono_700Bold",
  body: "JetBrainsMono_400Regular",
  bold: "JetBrainsMono_700Bold",
} as const;

export const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  page: { flex: 1, backgroundColor: color.bg, paddingHorizontal: 16 },
  logo: { fontFamily: font.logo, color: color.fg, fontSize: 28, letterSpacing: 1 },
  h1: { fontFamily: font.bold, color: color.fg, fontSize: 16, letterSpacing: 1.5 },
  label: { fontFamily: font.bold, color: color.muted, fontSize: 11, letterSpacing: 1.5 },
  body: { fontFamily: font.body, color: color.fg, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: font.body, color: color.muted, fontSize: 12, lineHeight: 17 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  input: {
    fontFamily: font.body,
    color: color.fg,
    fontSize: 15,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: { borderWidth: 1, borderColor: color.fg, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center" },
  buttonPrimary: { backgroundColor: color.fg },
  buttonText: { fontFamily: font.bold, color: color.fg, fontSize: 13, letterSpacing: 1.5 },
  buttonTextPrimary: { color: color.inverseFg },
  disabled: { opacity: 0.35 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  notice: { borderWidth: 1, borderColor: color.line, padding: 12, marginVertical: 8 },
});
