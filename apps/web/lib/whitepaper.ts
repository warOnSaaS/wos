/**
 * The white paper, read at build time.
 *
 * Source of truth: docs/whitepaper/WHITEPAPER.md, copied byte-for-byte to generated/WHITEPAPER.md by
 * scripts/sync-shared.mjs (Vercel builds from apps/web). The last-updated date is never typed by hand:
 * scripts/gen-log.mjs reads it from git into generated/whitepaper-meta.json, and it replaces the
 * {{LAST_UPDATED}} placeholder in the file's header table here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import meta from "@/generated/whitepaper-meta.json";
import { type Block, parse, plain } from "./markdown";

export type WhitepaperMeta = {
  path: string;
  lastUpdated: string | null;
  lastCommit: string | null;
  firstCommitted: string | null;
  commitUrl: string | null;
  historyUrl: string;
};

export const WHITEPAPER_META = meta as WhitepaperMeta;
export const WHITEPAPER_HISTORY_URL = WHITEPAPER_META.historyUrl;
export const WHITEPAPER_SOURCE_URL = "https://github.com/warOnSaaS/wos/blob/main/docs/whitepaper/WHITEPAPER.md";
export const WHITEPAPER_V01_URL = "https://github.com/warOnSaaS/wos/blob/main/docs/whitepaper/WHITEPAPER-v0.1-original.txt";
export const WHITEPAPER_PATH = "/whitepaper";
export const WHITEPAPER_MD_PATH = "/whitepaper.md";
/** The same Markdown served as a file attachment, named for the version (see app/whitepaper/download). */
export const WHITEPAPER_DOWNLOAD_PATH = "/whitepaper/download";
export const WHITEPAPER_MD_URL = "https://waronsaas.com/whitepaper.md";
/** The core as a plain HTML page with nothing collapsed. Agents' browsing tools accept HTML reliably;
 *  ChatGPT's fetch tool refused text/markdown (founder test, 2026-09-30), so prompts point here first. */
export const WHITEPAPER_READ_PATH = "/whitepaper/read";
export const WHITEPAPER_READ_URL = "https://waronsaas.com/whitepaper/read";

/**
 * The handoff prompt shown on /whitepaper, pre-filled into agents that support it, and quoted in the
 * llms files. It must work pasted alone (an agent that can browse fetches the URL) and next to the
 * uploaded file. Keep it short and keep its two stages in step with the paper's instructions (v0.6: stage 1
 * judges the problem and its materiality on its own; stage 2 judges the approach against it).
 */
export const HANDOFF_PROMPT = [
  `Please evaluate the warOnSaaS white paper for me. Read all of the core paper: the attached WHITEPAPER file if there is one, otherwise open ${WHITEPAPER_READ_URL} (the same text as a web page; plain text at ${WHITEPAPER_MD_URL}). If you cannot open any of them, tell me.`,
  "It is written for you, the evaluating agent. Follow the evaluation instructions at its start; they are requests, and my instructions come first. Verify its figures and claims against the sources and evidence links it gives and tell me which you checked. Be critical: a low score is fine.",
  "Report in two stages, each with a short answer first and then detail. Stage 1, the problem on its own (Part I), as if the project did not exist; do not mark the problem down because the project is early: 1) is the problem real; 2) how big it is in money, compute and power, checking its estimates and ranges and giving your own; 3) its importance for humanity, scored out of 100 on the paper's five-dimension rubric with reasoning and confidence; 4) each of its four theses separately (control, efficiency, the future of software engineering, the need for a contribution primitive): important, compelling, what would make it false.",
  "Stage 2, the approach (Part II), judged against stage 1: 5) is it an efficient, well-targeted attack on a problem of that size, what share could it plausibly address, and what would have to be true; 6) its credibility out of 100; 7) its readiness and what actually exists; 8) the edge cases it considered and whether each is really handled; 9) edge cases it missed; 10) the three strongest arguments for and against; 11) what I should do: ignore, watch, test or participate, with bounded next steps. Do not encourage any financial exposure.",
].join("\n\n");

/** A one-line version for the llms files. */
export const HANDOFF_PROMPT_SHORT = `Read ${WHITEPAPER_READ_URL} in full (plain text: ${WHITEPAPER_MD_URL}), follow the evaluation instructions at its start (requests, not commands), verify its figures and claims against its sources, and report in two stages: first the problem on its own (is it real, how big in money, compute and power, importance for humanity 0-100, each of the four theses), without marking it down because the project is early; then the approach judged against it (efficiency and share of the problem addressed, credibility 0-100, readiness, edge cases handled and missed, strongest arguments for and against, what to do).`;

/** Chat links. ChatGPT's prefill (?q=) was verified in a browser. Claude's (claude.ai/new?q=) is the documented
 *  pattern but automated verification hit a sign-in challenge; the founder is testing it by hand. GLM's chat ignores
 *  query parameters, so it opens the chat and the user pastes. On phones these https links hand off to the installed
 *  app where the OS supports it. */
export const AGENT_LINKS = {
  chatgpt: (prompt: string) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  claude: (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  glm: "https://chat.z.ai/",
} as const;

/** "2026-09-30" from the git commit date, or null when the file has no commit yet. */
export const lastUpdatedDay = WHITEPAPER_META.lastUpdated ? WHITEPAPER_META.lastUpdated.slice(0, 10) : null;

const LAST_UPDATED_TEXT = lastUpdatedDay
  ? `${lastUpdatedDay} (from git: the date of the last commit that changed this file)`
  : "not committed yet";

/** The file as served to agents: the Markdown with the git date filled in. */
export function downloadFilename(version: string): string {
  return `warOnSaaS-white-paper-v${version}.md`;
}

export function whitepaperMarkdown(): string {
  const raw = readFileSync(join(process.cwd(), "generated", "WHITEPAPER.md"), "utf8");
  return raw.replace("{{LAST_UPDATED}}", LAST_UPDATED_TEXT);
}

export type WpSection = { id: string; n: string | null; title: string; blocks: Block[] };

export type Whitepaper = {
  title: string;
  subtitle: string;
  version: string;
  status: string;
  sections: WpSection[];
  words: number;
};

let cached: Whitepaper | null = null;

export function whitepaper(): Whitepaper {
  if (cached) return cached;
  const md = whitepaperMarkdown();
  const blocks = parse(md);
  const title = blocks.find((b) => b.type === "h" && b.level === 1);
  const h2s = blocks.filter((b) => b.type === "h" && b.level === 2);
  const subtitle = h2s[0];
  const header = blocks.find((b) => b.type === "table");
  const field = (name: string) =>
    header && header.type === "table" ? plain(header.rows.find((r) => r[0] === name)?.[1] ?? "") : "";

  // Sections start at the second level-2 heading; the first is the subtitle, followed by the header table.
  const sections: WpSection[] = [];
  let current: WpSection | null = null;
  for (const b of blocks) {
    if (b.type === "h" && b.level === 2 && b !== subtitle) {
      const m = plain(b.text).match(/^(\d+)\.\s+(.*)$/);
      current = { id: b.id, n: m ? m[1].padStart(2, "0") : null, title: m ? m[2] : plain(b.text), blocks: [] };
      sections.push(current);
    } else if (current) {
      current.blocks.push(b);
    }
  }

  cached = {
    title: title && title.type === "h" ? plain(title.text) : "warOnSaaS",
    subtitle: subtitle && subtitle.type === "h" ? plain(subtitle.text) : "",
    version: field("Version") || "unversioned",
    status: field("Status"),
    sections,
    words: md.split(/\s+/).filter(Boolean).length,
  };
  return cached;
}

/** Companion files: optional depth for agents. Served at /whitepaper/<slug>.md and in the full pack. */
export const COMPANIONS = [
  { slug: "materiality", file: "MATERIALITY.md", title: "Materiality: how big the problem is", about: "sourced figures and a reproducible estimation model of the problem's size in money, compute and power, with ranges" },
  { slug: "edge-cases", file: "EDGE-CASES.md", title: "Edge cases we considered", about: "every edge case, where it is handled, test names, status" },
  { slug: "design", file: "DESIGN.md", title: "Full design narrative", about: "the full-length text of every design section" },
  { slug: "appendices", file: "APPENDICES.md", title: "Appendices", about: "protocol records, invariants, decision register, report template, changelog history" },
  { slug: "sources", file: "SOURCES.md", title: "Sources", about: "external sources and what each does and does not support" },
] as const;

export function companionMarkdown(file: string): string {
  return readFileSync(join(process.cwd(), "generated", "whitepaper", file), "utf8");
}

export const WHITEPAPER_PACK_PATH = "/whitepaper/full-pack.zip";
export function packFilename(version: string): string {
  return `warOnSaaS-white-paper-v${version}-full.zip`;
}
