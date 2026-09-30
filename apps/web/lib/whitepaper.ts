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
/** The core as a plain HTML page with nothing collapsed (see lib/handoff-prompt.ts for why prompts point here). */
export const WHITEPAPER_READ_PATH = "/whitepaper/read";
/** Every version: what changed and why, the diff, Part I flags, scores per version (lib/whitepaper-history.ts). */
export const WHITEPAPER_CHANGES_PATH = "/whitepaper/changes";
export const WHITEPAPER_CHANGES_MD_PATH = "/whitepaper/changes.md";
/** The recorded trend, generated from docs/assessments (never in the paper, the pack or the companions). */
export const ASSESSMENTS_MD_PATH = "/whitepaper/assessments.md";
export const ASSESSMENTS_PATH = "/assessments";
export {
  ASSESSMENTS_MD_URL,
  CONTRIBUTE_MD_URL,
  HANDOFF_PROMPT,
  HANDOFF_PROMPT_SHORT,
  WHITEPAPER_MD_URL,
  WHITEPAPER_READ_URL,
} from "./handoff-prompt";

/** Chat links. ChatGPT's prefill (?q=) was verified in a browser. Claude's (claude.ai/new?q=) is the documented
 *  pattern but automated verification hit a sign-in challenge; the founder is testing it by hand. GLM's chat ignores
 *  query parameters, so it opens the chat and the user pastes. On phones these https links hand off to the installed
 *  app where the OS supports it. */
export const AGENT_LINKS = {
  chatgpt: (prompt: string) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  claude: (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  /** Claude desktop registers claude:// (verified by the founder on macOS: it opens the app with the prompt filled in).
   *  The ChatGPT desktop app registers no scheme a web page can pass a prompt to, so ChatGPT stays on the web link. */
  claudeApp: (prompt: string) => `claude://claude.ai/new?q=${encodeURIComponent(prompt)}`,
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
  if (!cached) cached = parseWhitepaper(whitepaperMarkdown());
  return cached;
}

/** Any version of the paper (the current one, or a past one from lib/whitepaper-history.ts), split into sections. */
export function parseWhitepaper(md: string): Whitepaper {
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

  return {
    title: title && title.type === "h" ? plain(title.text) : "warOnSaaS",
    subtitle: subtitle && subtitle.type === "h" ? plain(subtitle.text) : "",
    version: field("Version") || "unversioned",
    status: field("Status"),
    sections,
    words: md.split(/\s+/).filter(Boolean).length,
  };
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
