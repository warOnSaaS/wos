import { whitepaperMarkdown } from "@/lib/whitepaper";

// The white paper as plain Markdown for agents: the same text as /whitepaper, one file, with the git date filled in.
export const dynamic = "force-static";

export function GET() {
  return new Response(whitepaperMarkdown(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
