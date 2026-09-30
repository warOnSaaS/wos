#!/usr/bin/env node
/**
 * Casing gate. Runs after `next build`; exits non-zero on any violation.
 *
 * The name is always `warOnSaaS`; the system is always `wOS`.
 * Allowed exceptions:
 *   - lowercase in URLs, the domain, the npm scope and route slugs (waronsaas.com, @waronsaas/cli, /targets/waronsaas)
 *   - "WOS" only in "WOS token(s)" (required legal wording)
 *   - on the white paper only (whitepaper.html, /whitepaper/read, /whitepaper.md, /whitepaper/download and the companion .md bodies), "WOS" alone, because the
 *     paper defines it once as the token's working symbol and uses it as a symbol ("100 WOS per ACU").
 *     Exactly "WOS": mis-cased forms (Wos, wos, WoS) still fail there.
 *   - "wos" only as the CLI command (wos build|login|…, "the wos command"), the Postgres schema ("wos Postgres")
 *     or a branch/check (wos/...); repository names waronsaas/wos and waronsaas/product
 * Also fails if any built CSS uses text-transform, because CSS re-casing would
 * make rendered text differ from the text checked here.
 *
 * Scans the rendered text of every prerendered page (text nodes, JSON-LD, and the
 * attributes people or machines read: meta content, alt, aria-label, title), every
 * static route body (.body: llms.txt, llms-full.txt, robots.txt, sitemap.xml) and
 * every built stylesheet. React's internal payload scripts are not text and are skipped.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), ".next");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

// The full pack (.zip) is binary; its text members are checked as their own routes (whitepaper.md and the companions).
const pages = files.filter((f) => f.includes(`${join(".next", "server", "app")}`) && /\.(html|body)$/.test(f) && !f.endsWith(".zip.body"));

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

/** The text a reader, a crawler or an agent actually gets from an HTML file. */
function renderedText(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) out.push(m[1]);
  // <code data-verbatim> holds quoted facts (commit subjects on /log): shown exactly as written, not site copy.
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<code data-verbatim="">[\s\S]*?<\/code>/g, " ");
  for (const m of noScripts.matchAll(/\s(?:content|alt|aria-label|title|placeholder)="([^"]*)"/g)) out.push(decode(m[1]));
  for (const m of noScripts.matchAll(/<title>([^<]*)<\/title>/g)) out.push(decode(m[1]));
  out.push(decode(noScripts.replace(/<[^>]+>/g, " ")));
  return out.join("\n");
}
const css = files.filter((f) => f.includes(join(".next", "static")) && f.endsWith(".css"));

// Lowercase `wos` is the CLI binary and the Postgres schema: allowed as "wos <subcommand>",
// "the wos command", "wos Postgres schema" and "wos/<branch-or-check>".
const CLI_SUB = /^(\s+(build|login|status|roadmap|propose|resolve|review|logout|link-github|command|Postgres)\b|\s+--[a-z]|\/)/;
const errors = [];

function scrub(text) {
  return text
    .replace(/https?:\/\/[^\s"'<>)\]]+/g, " ")
    .replace(/@waronsaas\//g, " ")
    .replace(/\bwaronsaas\/(wos|product)\b/g, " ")
    .replace(/\bwaronsaas\.roadmap\.json\b/g, " ")
    .replace(/\/targets\/waronsaas\b/g, " ")
    .replace(/"waronsaas"/g, " ")
    .replace(/\bwaronsaas\.com\b/g, " ")
    .replace(/\bwaronsaas-web\b/g, " ");
}

function context(text, i) {
  return text.slice(Math.max(0, i - 40), i + 50).replace(/\s+/g, " ");
}

// Pages where "WOS" is the defined token symbol (see the header comment).
const TOKEN_SYMBOL_PAGES = new Set([
  "whitepaper.html",
  "whitepaper/read.html",
  "whitepaper.md.body",
  "whitepaper/download.body",
  "whitepaper/materiality.md.body",
  "whitepaper/edge-cases.md.body",
  "whitepaper/design.md.body",
  "whitepaper/appendices.md.body",
  "whitepaper/sources.md.body",
]);

for (const f of pages) {
  const raw = readFileSync(f, "utf8");
  const symbolOk = TOKEN_SYMBOL_PAGES.has(relative(join(root, "server", "app"), f));
  const text = scrub(f.endsWith(".html") ? renderedText(raw) : raw);
  for (const m of text.matchAll(/waronsaas/gi)) {
    if (m[0] !== "warOnSaaS") errors.push(`${relative(process.cwd(), f)}: "${m[0]}" in …${context(text, m.index)}…`);
  }
  for (const m of text.matchAll(/(?<![A-Za-z0-9_-])wos(?![A-Za-z0-9_-])/gi)) {
    const after = text.slice(m.index + 3, m.index + 20);
    const ok =
      m[0] === "wOS" ||
      (m[0] === "WOS" && (symbolOk || /^\s+tokens?\b/.test(after))) ||
      (m[0] === "wos" && CLI_SUB.test(after));
    if (!ok) errors.push(`${relative(process.cwd(), f)}: "${m[0]}" in …${context(text, m.index)}…`);
  }
}

for (const f of css) {
  const text = readFileSync(f, "utf8");
  const m = text.match(/text-transform\s*:\s*(uppercase|lowercase|capitalize)/i);
  if (m) errors.push(`${relative(process.cwd(), f)}: CSS "${m[0]}" would re-case rendered text`);
}

if (!pages.length) errors.push("No built pages found. Run next build first.");

if (errors.length) {
  console.error(`check-casing: ${errors.length} violation(s)`);
  for (const e of errors.slice(0, 50)) console.error("  " + e);
  process.exit(1);
}
console.log(`check-casing: OK (${pages.length} pages and route bodies, ${css.length} stylesheets)`);
