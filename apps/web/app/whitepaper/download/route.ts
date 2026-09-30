import { downloadFilename, whitepaper, whitepaperMarkdown } from "@/lib/whitepaper";

// The white paper as a file to upload to an agent: the same Markdown as /whitepaper.md, as an attachment
// named for its version (warOnSaaS-white-paper-v<version>.md).
export const dynamic = "force-static";

export function GET() {
  return new Response(whitepaperMarkdown(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadFilename(whitepaper().version)}"`,
    },
  });
}
