import { llmsTxt } from "@/lib/llms";

export const revalidate = 60;

export async function GET() {
  return new Response(await llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
