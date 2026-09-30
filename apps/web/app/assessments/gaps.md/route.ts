import { gapsMarkdown } from "@/lib/gaps";
import { abs } from "@/lib/seo";

// The gap register as plain text: gaps and their status, no scores. Like the recorded trend, evaluating agents are
// asked to read it only after writing their own score block; it is never a companion file or in the pack.
export const dynamic = "force-static";

export function GET() {
  return new Response(gapsMarkdown(abs), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
