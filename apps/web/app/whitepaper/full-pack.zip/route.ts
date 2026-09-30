import { zip } from "@/lib/zip";
import { COMPANIONS, companionMarkdown, packFilename, whitepaper, whitepaperMarkdown } from "@/lib/whitepaper";

// The full pack: the core white paper plus its companion files, one .zip, for agents that take several files.
export const dynamic = "force-static";

export function GET() {
  const version = whitepaper().version;
  const folder = `warOnSaaS-white-paper-v${version}`;
  const body = zip([
    { name: `${folder}/WHITEPAPER.md`, data: whitepaperMarkdown() },
    ...COMPANIONS.map((c) => ({ name: `${folder}/${c.file}`, data: companionMarkdown(c.file) })),
  ]);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${packFilename(version)}"`,
    },
  });
}
