import { COMPANIONS, companionMarkdown } from "@/lib/whitepaper";

// Companion files of the white paper as plain Markdown: /whitepaper/materiality.md, /edge-cases.md, /design.md, /appendices.md, /sources.md.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPANIONS.map((c) => ({ companion: `${c.slug}.md` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ companion: string }> }) {
  const { companion } = await params;
  const c = COMPANIONS.find((x) => `${x.slug}.md` === companion);
  if (!c) return new Response("Not found", { status: 404 });
  return new Response(companionMarkdown(c.file), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
