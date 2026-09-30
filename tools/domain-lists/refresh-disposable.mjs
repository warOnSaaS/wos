#!/usr/bin/env node
/**
 * D66: refresh the pinned disposable-email-domain list. Never fetched at runtime: this script is run by hand, and its
 * output (packages/contracts/src/data/disposable-email-domains.v1.json) lands through a reviewed PR.
 *
 *   node tools/domain-lists/refresh-disposable.mjs <commit sha of disposable-email-domains/disposable-email-domains>
 *
 * Source: https://github.com/disposable-email-domains/disposable-email-domains (CC0-1.0, checked 2026-09-30).
 * The JSON records the commit, the source file's sha256 and the licence; the public-mail-provider list is curated in
 * identity-policy.v1.json instead (no suitable maintained list).
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const sha = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
  console.error("usage: refresh-disposable.mjs <40-hex commit sha>");
  process.exit(2);
}
const url = `https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/${sha}/disposable_email_blocklist.conf`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: ${res.status}`);
const text = await res.text();
const domains = [
  ...new Set(
    text
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#")),
  ),
].sort();
if (domains.some((d) => !/^[a-z0-9.-]+$/.test(d))) throw new Error("unexpected characters in the list");
const out = {
  schema: "wos-domain-list.v1",
  name: "disposable-email-domains",
  source: "https://github.com/disposable-email-domains/disposable-email-domains",
  path: "disposable_email_blocklist.conf",
  commit: sha,
  sourceSha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
  license: "CC0-1.0",
  domains,
};
const target = new URL("../../packages/contracts/src/data/disposable-email-domains.v1.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(out, null, 0).replace('"domains":[', '"domains":[\n')}\n`);
console.log(`wrote ${domains.length} domains from ${sha}`);
