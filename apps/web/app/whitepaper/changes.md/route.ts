import { abs } from "@/lib/seo";
import { changesMarkdown } from "@/lib/whitepaper-history";

// Every version of the white paper as plain text for agents (the paper's header table points here). Generated from
// generated/whitepaper-history.json; no scores (they would anchor an evaluation; see lib/whitepaper-history.ts).
export const dynamic = "force-static";

export function GET() {
  return new Response(changesMarkdown(abs), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
