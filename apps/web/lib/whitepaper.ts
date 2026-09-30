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

/** "2026-09-30" from the git commit date, or null when the file has no commit yet. */
export const lastUpdatedDay = WHITEPAPER_META.lastUpdated ? WHITEPAPER_META.lastUpdated.slice(0, 10) : null;

const LAST_UPDATED_TEXT = lastUpdatedDay
  ? `${lastUpdatedDay} (from git: the date of the last commit that changed this file)`
  : "not committed yet";

/** The file as served to agents: the Markdown with the git date filled in. */
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
