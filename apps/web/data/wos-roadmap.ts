/**
 * TGT-00: warOnSaaS builds itself with its own process.
 *
 * Site-only display fields for the TGT-00 row. Its roadmap (capabilities, features, weights,
 * surfaces, journeys, requirements) is read from docs/roadmap/waronsaas.roadmap.json through
 * lib/data-source.ts; nothing about it is typed here.
 */

import type { Target } from "./targets";

export const WOS_PROPOSAL_LABEL = "PROPOSED — pending roadmap consensus";

export const WOS_ZERO_REASON =
  "The roadmap is PROPOSED: Fable and Astra have not reviewed it and it is not merged, so no feature is mapped, specified or built yet. Code written before wOS existed does not count, and the control plane that computes progress is not deployed.";

export const wosTarget: Target = {
  name: "warOnSaaS (wOS)",
  id: "TGT-00",
  slug: "waronsaas",
  category: "Build system",
  whatItIs: "The system that coordinates the build of every other target: roadmaps, contracts, build units, review, gated PRs and rewards.",
  replacementCovers: [],
  mapped: 0,
  specified: 0,
  built: 0,
  roadmapPr: null,
  hosted: false,
  selfHosted: false,
  statusLabel: "PHASE 0",
};

