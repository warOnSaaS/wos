import { assessmentsSnapshot } from "@/lib/assessments";

// The data behind /assessments, as JSON: every recorded reference run and the count. scripts/check-numbers.mjs reads
// the built copy to prove /assessments renders no figure that is not in it.
export const dynamic = "force-static";

export function GET() {
  return Response.json(assessmentsSnapshot());
}
