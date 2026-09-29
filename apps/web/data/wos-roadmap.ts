/**
 * TGT-00: warOnSaaS builds itself with its own process.
 *
 * This is the PROPOSED feature list for warOnSaaS V1, written in the same
 * roadmap -> capability -> feature shape the system will use. It is taken from
 * docs/V1-SPEC.md and docs/DECISIONS.md. It is pending roadmap consensus and
 * will be replaced by the real roadmap records from the control plane.
 *
 * Honest status only:
 * - EXISTS: something real is deployed. Only the static v0 public website qualifies.
 * - IN PROGRESS: work has started outside wOS (Phase 0 architecture).
 * - NOT STARTED: nothing exists yet.
 * Nothing has been merged through wOS, so every progress measure is 0%.
 */

import type { Target } from "./targets";

export type WosStatus = "EXISTS" | "IN PROGRESS" | "NOT STARTED";

export type WosFeature = { name: string; status: WosStatus; note?: string };

export type WosCapability = {
  id: string;
  name: string;
  summary: string;
  status: WosStatus;
  note?: string;
  features: WosFeature[];
};

export const WOS_PROPOSAL_LABEL = "PROPOSED — pending roadmap consensus";

export const WOS_ZERO_REASON =
  "Nothing has been merged through wOS yet. The public website exists, but it was built before wOS existed and went through no roadmap, contract or review, so it does not count.";

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

const ns = (name: string, note?: string): WosFeature => ({ name, status: "NOT STARTED", ...(note ? { note } : {}) });
const ip = (name: string, note?: string): WosFeature => ({ name, status: "IN PROGRESS", ...(note ? { note } : {}) });
const ex = (name: string, note?: string): WosFeature => ({ name, status: "EXISTS", ...(note ? { note } : {}) });

export const wosCapabilities: WosCapability[] = [
  {
    id: "C-00",
    name: "Architecture and contracts",
    summary: "Phase 0. The shared foundation every other capability builds against.",
    status: "IN PROGRESS",
    note: "Phase 0 is under way. Nothing from it is merged yet.",
    features: [
      ip("Monorepo structure and dependency rules"),
      ip("PostgreSQL schema and domain model"),
      ip("Shared TypeScript types, API contracts and event contracts"),
      ip("Roadmap, Feature Contract and Atomic Build Unit schemas"),
      ip("Agent-policy and context-manifest schemas"),
      ip("Contribution and reward-ledger schemas"),
      ip("GitHub integration contracts and security boundaries"),
      ip("Architecture documents: architecture, domain model, roadmap, feature contract, build, context, agent policy, review, reward and security protocols"),
    ],
  },
  {
    id: "C-01",
    name: "Control Plane",
    summary: "The API and system of record for targets, roadmaps, features, build units, leases and progress.",
    status: "NOT STARTED",
    features: [
      ns("API"),
      ns("Accounts: email magic-link sign-in, linked GitHub identity"),
      ns("Projects and Sniper Targets"),
      ns("Application roadmaps"),
      ns("Features and Feature Contracts"),
      ns("Atomic Build Units and dependency graphs"),
      ns("Leases"),
      ns("State machines"),
      ns("Progress calculations: mapped, specified, built"),
      ns("Contributor records"),
      ns("Application and feature progress events"),
    ],
  },
  {
    id: "C-02",
    name: "Public Web",
    summary: "This website: the Sniper List, target pages, roadmaps, progress and contributions.",
    status: "EXISTS",
    note: "Only the static v0 exists: this site, with its data in a file, all numbers 0%.",
    features: [
      ex("Sniper List with real progress", "Static v0. Data from a file."),
      ex("Public application pages", "Static v0. One dossier per target."),
      ex("Self-hosted and hosted status per app", "Static v0."),
      ex("Leaderboard page", "Static v0 empty state only."),
      ns("Opt-in public leaderboard with real rankings"),
      ns("Switch from the static data file to the control-plane API"),
      ns("Drilldown: application, capability, feature, requirement, build unit, contribution"),
      ns("Feature pages"),
      ns("Roadmap views"),
      ns("Latest activity"),
      ns("Contributor profiles"),
      ns("Token and reward history"),
      ns("GitHub PR links"),
    ],
  },
  {
    id: "C-03",
    name: "wOS Desktop",
    summary: "The contributor app. Electron, React, TypeScript.",
    status: "NOT STARTED",
    features: [
      ns("Sign-in"),
      ns("Sniper List browsing"),
      ns("Application and feature drilldown"),
      ns("Build-unit browsing"),
      ns("BUILD flow"),
      ns("Local Claude Code detection and agent status"),
      ns("Terminal and activity display"),
      ns("Contribution history and contributor profile"),
      ns("Settings"),
      ns("Privileged main process for git, worktrees and local processes; isolated renderer"),
    ],
  },
  {
    id: "C-04",
    name: "wOS CLI",
    summary: "The same protocol as Desktop, from a terminal.",
    status: "NOT STARTED",
    features: [
      ns("wos build"),
      ns("wos roadmap"),
      ns("wos propose"),
      ns("wos resolve"),
      ns("wos review"),
      ns("wos status"),
      ns("Shared orchestration logic with Desktop"),
    ],
  },
  {
    id: "C-05",
    name: "GitHub and gated PRs",
    summary: "GitHub is the public record. Only the wOS GitHub App opens PRs, and only after qualification.",
    status: "NOT STARTED",
    features: [
      ns("Repository management, worktrees and branches"),
      ns("Immutable base commits"),
      ns("Task leases"),
      ns("Allowed and forbidden paths; diff validation"),
      ns("Signed submissions uploaded to the control plane"),
      ns("Qualification: LEASE, BUILD, VERIFY, REVIEW, QUALIFY, PR"),
      ns("PR creation by the wOS GitHub App"),
      ns("PR metadata and contribution provenance"),
      ns("Merge webhooks"),
      ns("Branch rulesets and the wos/qualified check"),
    ],
  },
  {
    id: "C-06",
    name: "Context Engine and Agent Policy",
    summary: "Each agent run gets its own exact, recorded context and a machine-readable policy.",
    status: "NOT STARTED",
    features: [
      ns("Role-specific context for roadmap, feature, builder, reviewer and architecture-resolver roles"),
      ns("Immutable context manifests"),
      ns("Context budgets; oversized build units rejected for decomposition"),
      ns("Machine-readable agent policies"),
      ns("Model and reasoning-effort attestation"),
    ],
  },
  {
    id: "C-07",
    name: "Roadmap AI and review orchestration",
    summary: "Planning and consensus: one canonical roadmap per app, two independent reviewers.",
    status: "NOT STARTED",
    features: [
      ns("One canonical Roadmap PR per application"),
      ns("Independent Astra and Fable review rounds until NO MATERIAL GAPS"),
      ns("Feature Contract consensus"),
      ns("Shared Feature Catalog with de-duplication"),
      ns("Merged roadmap materialises tracked features"),
      ns("Merged Feature Contract generates a Build Graph"),
      ns("Implementation review on other contributors' machines"),
      ns("Bootstrap review mode while the reviewer pool is small"),
    ],
  },
  {
    id: "C-08",
    name: "Rewards ledger",
    summary: "WOS tokens: one append-only ledger, one unit. In-app credits with no cash value.",
    status: "NOT STARTED",
    features: [
      ns("Append-only ledger; balances derived, never mutated"),
      ns("Contribution categories"),
      ns("Feature and application completion pools"),
      ns("Reward history"),
      ns("Opt-in public leaderboard"),
      ns("Transferability and redemption disabled"),
    ],
  },
  {
    id: "C-09",
    name: "Verification",
    summary: "Deterministic checks, and a workstream that tries to break the system.",
    status: "NOT STARTED",
    features: [
      ns("Typechecking, linting, unit and integration tests"),
      ns("Task acceptance tests"),
      ns("Diff and scope validation"),
      ns("Security checks"),
      ns("Context and roadmap-state tests"),
      ns("Concurrency and lease tests"),
      ns("Integration-wave and end-to-end tests"),
      ns("CI re-verification on every PR"),
    ],
  },
];

export function wosCounts() {
  const all = wosCapabilities.flatMap((c) => c.features);
  const count = (s: WosStatus) => all.filter((f) => f.status === s).length;
  return {
    capabilities: wosCapabilities.length,
    features: all.length,
    exists: count("EXISTS"),
    inProgress: count("IN PROGRESS"),
    notStarted: count("NOT STARTED"),
  };
}
