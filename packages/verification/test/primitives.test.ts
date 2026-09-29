import { createHash } from "node:crypto";
import { canonicalSha256 } from "@waronsaas/context-engine";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { canonicalJson, lintProductWorkflow, scanForSecrets } from "../src/index.js";
import { implemented, pendingReason } from "./support/pending.js";

describe("JCS (RFC 8785) used for the diff hash and signatures", () => {
  it("sorts members by UTF-16 code units (RFC 8785 section 3.2.3 example)", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    const keys = Object.keys(JSON.parse(canonicalJson(input)) as object);
    // JSON.parse re-orders integer-like keys first, so compare the raw text order instead.
    expect(keys).toContain("1");
    const order = ["\r", "1", "\u0080", "ö", "€", "😀", "דּ"].map((k) => JSON.stringify(k));
    const text = canonicalJson(input);
    const positions = order.map((k) => text.indexOf(`${k}:`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("serialises numbers as ECMAScript does and drops undefined", () => {
    expect(canonicalJson([1e21, -0, 0.000001, 1e-7, 10.0, 333333333.3333333])).toBe("[1e+21,0,0.000001,1e-7,10,333333333.3333333]");
    expect(canonicalJson({ b: 1, a: undefined, c: [undefined] })).toBe('{"b":1,"c":[null]}');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: 1n })).toThrow();
  });

  const ready = implemented(() => canonicalSha256({}));
  it.skipIf(!ready)(
    `is byte-identical to context-engine canonicalSha256 (one JCS for the whole system)${pendingReason(ready, "context-engine canonicalSha256")}`,
    () => {
      const samples = [{}, { b: [1, "x", null, true], a: { ö: 1, z: 0.5 } }, { parentCommit: "a".repeat(40), files: [] }];
      for (const s of samples) {
        const mine = `sha256:${createHash("sha256").update(canonicalJson(s)).digest("hex")}`;
        expect(canonicalSha256(s)).toBe(mine);
      }
    },
  );
});

describe("secret patterns (S-8, SECRET_DETECTED)", () => {
  // Assembled at run time so this file does not trip the repo scan.
  const j = (...p: string[]) => p.join("");
  it.each([
    ["private-key-block", j("-----BEGIN ", "RSA PRIVATE KEY-----")],
    ["aws-access-key-id", j("AKIA", "Q3EGQVT2XK7M4ZPB")],
    ["github-token", j("ghp_", "a".repeat(36))],
    ["anthropic-api-key", j("sk-ant-", "api03-", "A".repeat(90))],
    ["openai-api-key", j("sk-proj-", "B".repeat(60))],
    ["stripe-live-key", j("sk_live_", "c".repeat(24))],
    ["postgres-url-with-password", j("postgresql://postgres:", "s3cretpassw0rd@", "db.abcd.supabase.co:5432/postgres")],
  ])("detects %s", (id, text) => {
    expect(scanForSecrets(`const x = "${text}";`).map((h) => h.id)).toContain(id);
  });

  it.each([
    "postgres://postgres:test@localhost:5432/wos",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression / shell placeholder, not a JS template
    "postgres://wos:${DB_PASSWORD}@db.example.com/wos",
    "const sha = 'sha256:0000'; // AKIA in a sentence",
    "ghp_short",
  ])("does not flag %s", (text) => {
    expect(scanForSecrets(text)).toEqual([]);
  });
});

describe("product workflow lint (S-20)", () => {
  const good = `
name: wos-verify
on:
  push: { branches: ["wos/candidate/**"] }
  pull_request:
  merge_group:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
`;
  const lint = (text: string) => lintProductWorkflow(text, parseYaml(text), { requireVerifyTriggers: true }).map((i) => i.rule);

  it("accepts a minimal compliant workflow", () => expect(lint(good)).toEqual([]));
  it.each([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression / shell placeholder, not a JS template
    ["no-secrets", good.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-latest\n    env:\n      T: ${{ secrets.NPM_TOKEN }}")],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression / shell placeholder, not a JS template
    ["no-secrets", good.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-latest\n    env:\n      T: ${{ toJSON(secrets) }}")],
    ["permissions", good.replace("contents: read", "contents: write")],
    ["permissions", good.replace("permissions:\n  contents: read", "permissions: write-all")],
    ["permissions", good.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-latest\n    permissions: { id-token: write }")],
    ["triggers", good.replace("pull_request:", "pull_request_target:")],
    ["triggers", good.replace("merge_group:\n", "")],
    ["environment", good.replace("runs-on: ubuntu-latest", "runs-on: ubuntu-latest\n    environment: production")],
    ["checkout", good.replace("with: { persist-credentials: false }", "with: { fetch-depth: 0 }")],
    ["uses", good.replace("actions/checkout@v4", "evil/action@v1")],
    ["uses", good.replace("actions/checkout@v4", "./local-action")],
  ])("rejects %s violation", (rule, text) => {
    expect(lint(text)).toContain(rule);
  });
});
