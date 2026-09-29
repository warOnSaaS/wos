import { snapshot } from "@/lib/data-source";

export const revalidate = 60;

/**
 * Everything lib/data-source.ts returns, as JSON. scripts/check-numbers.mjs reads the built copy
 * to prove no page renders a number that is not in the data source.
 */
export async function GET() {
  return Response.json(await snapshot());
}
