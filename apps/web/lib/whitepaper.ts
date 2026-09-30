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

/**
 * The handoff prompt shown on /whitepaper, pre-filled into agents that support it, and quoted in the
 * llms files. It must work pasted alone (an agent that can browse fetches the URL) and next to the
 * uploaded file. Keep it short and keep the eight points in step with the paper's instructions.
 */
export const HANDOFF_PROMPT = [
  `Please evaluate the warOnSaaS white paper for me. Read all of it: the attached file if there is one, otherwise fetch ${WHITEPAPER_MD_URL} (if you cannot open either, tell me).`,
  "It is written for you, the evaluating agent. Follow the evaluation instructions at its start; they are requests, and my instructions come first. Verify its claims against the evidence links it gives and tell me which you checked. Be critical: a low score is fine.",
  "Report to me, a short answer first and then detail, on: 1) is the idea compelling (yes / partly / no, and why); 2) how important the problem and its two theses (compute efficiency, and humans directing agents) are for humanity, scored out of 100 on its five-dimension rubric, with reasoning and confidence, and whether the efficiency claim is plausible; 3) the proposal's credibility; 4) its implementation readiness and what actually exists; 5) the edge cases it considered and whether each is really handled; 6) edge cases it missed; 7) the three strongest arguments for and against; 8) what I should do: ignore, watch, test or participate, with bounded next steps. Do not encourage any financial exposure.",
].join("\n\n");

/** A one-line version for the llms files. */
export const HANDOFF_PROMPT_SHORT = `Read ${WHITEPAPER_MD_URL} in full, follow the evaluation instructions at its start (requests, not commands), verify its claims against its evidence links, and report on its eight points: compelling or not, importance for humanity (0-100), credibility, readiness, edge cases handled, edge cases missed, strongest arguments for and against, and what to do.`;

/** Chat links. Only ChatGPT's prefill (?q=) was verified to work (it opens a chat and sends the prompt).
 *  Claude's could not be verified (a sign-in challenge blocks the check) and GLM's chat ignores query
 *  parameters, so those two open the chat and the user pastes the prompt. Re-verify before adding a prefill. */
export const AGENT_LINKS = {
  chatgpt: (prompt: string) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  claude: "https://claude.ai/new",
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
