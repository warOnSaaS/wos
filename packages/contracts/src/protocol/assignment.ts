/**
 * DRAFT (D56) — "build next": the control plane picks the contributor's next unit. Two modes: `self_pick` (the existing
 * claim of a chosen unit, api.ts claimBuild) and `assigned_next` (this route). The server filters the units the caller is
 * ELIGIBLE for (rule nextUnitEligibilityRefusals: capability class and model incl. the Fable fallback and candidate
 * models, toolchain attestation, per-provider lease limits, never the caller's own proposed budget, independence, a
 * funded live budget, the caller's limits), ranks them with the published ranking policy (rule rankNextUnits) and leases
 * the first ATOMICALLY with the same fencing as claimBuild. Budgets are identical in both modes. Continuous mode repeats
 * until stopped or a contributor-set limit is reached (rule continuousNextStop). The route joins api.ts when the
 * protocol leaves draft (CHANGELOG-CONTRACTS); the orchestrator, CLI (`wos build --next [--continuous]`) and Desktop
 * (BUILD NEXT) interface is in docs/protocol/WORKSTREAMS-PROTOCOL.md.
 */
import { z } from "zod";
import { ClaimResponse } from "../api.js";
import { ModelRef } from "../agent-policy.js";
import { Uuid } from "../primitives.js";

/** Contributor-set limits for continuous mode (all optional; a missing limit is no limit). */
export const BuildNextLimits = z.object({
  units: z.number().int().positive().optional(),
  wallTimeMinutes: z.number().int().positive().optional(),
  budgetAcuMicro: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  perProvider: z.record(z.string(), z.object({ units: z.number().int().positive() })).optional(),
});
export type BuildNextLimits = z.infer<typeof BuildNextLimits>;

export const ClaimNextBuildRequest = z.object({
  deviceId: Uuid,
  model: ModelRef.optional(),
  continuous: z.boolean().default(false),
  limits: BuildNextLimits.default({}),
});
export type ClaimNextBuildRequest = z.infer<typeof ClaimNextBuildRequest>;

/** The leased unit and why it was chosen (the ranking is public: score components are returned). */
export const ClaimNextBuildResponse = z
  .object({
    claim: ClaimResponse,
    unitId: z.string(),
    rankingPolicyVersion: z.string(),
    score: z.object({
      reuse: z.number().int(),
      unlock: z.number().int(),
      focus: z.number().int(),
      ageing: z.number().int(),
      total: z.number().int(),
    }),
  })
  .nullable();
export type ClaimNextBuildResponse = z.infer<typeof ClaimNextBuildResponse>;

/** The route descriptor (same shape as api.ts routes). */
export const CLAIM_NEXT_BUILD_ROUTE = {
  method: "POST",
  path: "/v1/builds/next",
  auth: "contributor",
  idempotent: true,
  body: ClaimNextBuildRequest,
  response: ClaimNextBuildResponse,
  errors: ["NOT_ELIGIBLE", "NOT_ENTITLED", "RESOURCE_LOCKED", "LIMIT_REACHED", "CONFLICT", "UPSTREAM_GITHUB"],
  summary:
    "ASSIGNED mode (D56): leases the highest-ranked unit the caller is eligible for, atomically, with claimBuild's fencing. Null when none. (wos build --next)",
} as const;
