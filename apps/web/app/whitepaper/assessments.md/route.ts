import { assessmentsMarkdown } from "@/lib/assessments";

// The recorded trend for evaluating agents, generated from docs/assessments. The paper tells agents to open it only
// AFTER writing their own score block. It is deliberately not a companion file: never in the paper, the pack or the
// companions list, so no earlier score can anchor an evaluation.
export const dynamic = "force-static";

export function GET() {
  return new Response(assessmentsMarkdown(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
