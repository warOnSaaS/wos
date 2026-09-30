import { z } from "zod";

/**
 * ARCHITECTURE_BLOCKER for the V1 build itself (Phase 2 of the spec).
 * File convention: blockers/<id>.md in the platform repo, where <id> = "B-<nnnn>-<workstream>".
 * The file starts with a fenced ```json block that parses as ArchitectureBlocker, followed by prose.
 * See docs/architecture/WORKSTREAMS.md "Escalation".
 *
 * Inside target repos (after launch) the same fields are carried by a GitHub Issue labelled
 * wos:blocker, created through the API route createBlocker.
 */

export const Workstream = z.enum([
  "architect",
  "control-plane",
  "desktop",
  "web",
  "github-build",
  "context-policy",
  "planning",
  "rewards",
  "verification",
  "cli",
  // contracts 5.6.0 (B-0001-suite-shell): the Wave 3 workstreams.
  "suite-shell",
  "mobile-runtime",
]);
export type Workstream = z.infer<typeof Workstream>;

export const ArchitectureBlocker = z.object({
  id: z.string().regex(/^B-\d{4}-[a-z-]+$/),
  status: z.enum(["open", "accepted", "rejected", "resolved"]),
  raisedBy: Workstream,
  raisedAt: z.iso.datetime({ offset: true }),
  affectedContract: z.string().min(1),
  reason: z.string().min(10),
  evidence: z.string().min(10),
  requestedCapability: z.string().min(5),
  affectedWorkstreams: z.array(Workstream).min(1),
  suggestedResolution: z.string().nullable(),
  /** Filled by the Lead Architect. */
  decision: z
    .object({
      outcome: z.enum(["accepted", "rejected"]),
      contractsVersion: z.string().nullable(),
      note: z.string(),
      decidedAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});
export type ArchitectureBlocker = z.infer<typeof ArchitectureBlocker>;
