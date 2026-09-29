import { llmsFullTxt } from "@/lib/llms";

export const revalidate = 60;

export async function GET() {
  return new Response(await llmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
