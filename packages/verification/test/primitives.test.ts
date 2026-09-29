import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { lintProductWorkflow, scanForSecrets } from "../src/index.js";

describe("one canonical implementation (B-0001: @waronsaas/contracts/canonical)", () => {
  it("packages/verification has no hashing, signing or JCS code of its own", () => {
    const dir = fileURLToPath(new URL("../src/", import.meta.url));
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/import \{[^}]*\b(sign|verify|createHash|createHmac)\b[^}]*\} from "node:crypto"|createHash\(/);
    }
    expect(existsSync(join(dir, "jcs.ts"))).toBe(false);
  });
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
