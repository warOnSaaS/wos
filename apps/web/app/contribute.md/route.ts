import { getCliRelease } from "@/lib/cli-release";
import { contributeMarkdown } from "@/lib/contribute";

// How to contribute, as plain Markdown for agents: the same steps as /contribute. The white paper's handoff prompt
// points agents here once their human wants to take part. The CLI's release state is read from GitHub hourly.
export const revalidate = 3600;

export async function GET() {
  return new Response(contributeMarkdown(await getCliRelease()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
