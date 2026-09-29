/**
 * Every state machine in wOS, as data.
 *
 * These tables ARE the contract. The control plane persists the state column, and every
 * state change it makes must be a row in one of these tables. Pure reducers in other
 * packages (planning, orchestrator) must also only produce transitions listed here.
 * The prose explanation of each machine is in docs/architecture/DOMAIN-MODEL.md.
 *
 * Actors:
 *   contributor  an authenticated contributor acting on their own lease/attempt (the API caller)
 *   maintainer   a human with the maintainer role (V1: the founder), via an admin route
 *   system       the control plane itself (request handler side effects, sweeper cron, event consumers)
 *   github       a verified GitHub webhook delivery processed by the control plane
 *
 * Persistence rule: every transition is a single SQL statement of the form
 *   UPDATE ... SET state = $to, row_version = row_version + 1 WHERE id = $id AND state = $from AND row_version = $v
 * in the same transaction as the INSERT of the corresponding domain event. Zero rows updated
 * means a concurrent transition won; the caller gets 409 CONFLICT and must re-read.
 */

export type Actor = "contributor" | "maintainer" | "system" | "github";

export interface Transition<S extends string, E extends string> {
  readonly from: S;
  readonly to: S;
  readonly event: E;
  readonly actor: readonly Actor[];
  /** Condition that must hold, checked inside the transaction. Human-readable; tests reference it. */
  readonly guard: string;
}

export interface Machine<S extends string, E extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: readonly S[];
  readonly terminal: readonly S[];
  readonly transitions: readonly Transition<S, E>[];
}

function machine<const S extends string, const E extends string>(m: Machine<S, E>): Machine<S, E> {
  return m;
}

/** Returns the transition for (from, event) or undefined. Tables are validated to be deterministic. */
export function findTransition<S extends string, E extends string>(m: Machine<S, E>, from: S, event: E): Transition<S, E> | undefined {
  return m.transitions.find((t) => t.from === from && t.event === event);
}

// ---------------------------------------------------------------------------------------------
// Task: any unit of leasable work (build, revise, review, author, resolve).
// ---------------------------------------------------------------------------------------------

export const TaskStates = ["blocked", "open", "leased", "submitted", "completed", "cancelled"] as const;
export type TaskState = (typeof TaskStates)[number];
export type TaskEvent = "dependencies_met" | "claim" | "lease_lost" | "submit" | "accept_output" | "reject_output" | "cancel";

export const TaskMachine = machine<TaskState, TaskEvent>({
  name: "task",
  states: TaskStates,
  initial: ["blocked", "open"],
  terminal: ["completed", "cancelled"],
  transitions: [
    {
      from: "blocked",
      to: "open",
      event: "dependencies_met",
      actor: ["system"],
      guard: "every prerequisite recorded for the task is satisfied",
    },
    {
      from: "open",
      to: "leased",
      event: "claim",
      actor: ["contributor"],
      guard: "claimant passes Agent Policy eligibility and independence rules; resource locks acquired; no other active lease on the task",
    },
    {
      from: "leased",
      to: "open",
      event: "lease_lost",
      actor: ["system", "contributor"],
      guard: "the active lease expired, was released or revoked, and the subject is still live",
    },
    {
      from: "leased",
      to: "submitted",
      event: "submit",
      actor: ["contributor"],
      guard: "caller holds the active lease; payload validates against the task kind's submission schema",
    },
    {
      from: "submitted",
      to: "completed",
      event: "accept_output",
      actor: ["system"],
      guard: "deterministic post-submission checks passed (e.g. candidate commit created, verdict stored)",
    },
    {
      from: "submitted",
      to: "open",
      event: "reject_output",
      actor: ["system"],
      guard:
        "document author tasks only: processing AFTER the App commit failed (e.g. the pushed document could not be re-read for validation); a new lease may be taken. Never used for abu_build/abu_revision. Submissions are committed INSIDE the submit request (contracts 3.0.0): changeset content is never stored, so there is nothing to retry later; if the App commit fails nothing is recorded, the client gets 502 UPSTREAM_GITHUB with its lease still active and retries with the same Idempotency-Key",
    },
    {
      from: "blocked",
      to: "cancelled",
      event: "cancel",
      actor: ["system", "maintainer"],
      guard: "subject superseded, abandoned or its round closed",
    },
    {
      from: "open",
      to: "cancelled",
      event: "cancel",
      actor: ["system", "maintainer"],
      guard: "subject superseded, abandoned or its round closed",
    },
    {
      from: "leased",
      to: "cancelled",
      event: "cancel",
      actor: ["system", "maintainer"],
      guard: "subject superseded or abandoned; the active lease is revoked in the same transaction",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Lease: time-bounded exclusive right of one contributor+device to work a task.
// ---------------------------------------------------------------------------------------------

export const LeaseStates = ["active", "completed", "released", "expired", "revoked"] as const;
export type LeaseState = (typeof LeaseStates)[number];
export type LeaseEvent = "complete" | "release" | "expire" | "revoke" | "heartbeat";

export const LeaseMachine = machine<LeaseState, LeaseEvent>({
  name: "lease",
  states: LeaseStates,
  initial: ["active"],
  terminal: ["completed", "released", "expired", "revoked"],
  transitions: [
    {
      from: "active",
      to: "active",
      event: "heartbeat",
      actor: ["contributor"],
      guard: "caller is the lease holder on the same device; now < expires_at; extends expires_at to min(now + ttl, hard_deadline)",
    },
    { from: "active", to: "completed", event: "complete", actor: ["system"], guard: "the task's submission was accepted" },
    { from: "active", to: "released", event: "release", actor: ["contributor"], guard: "caller is the lease holder" },
    {
      from: "active",
      to: "expired",
      event: "expire",
      actor: ["system"],
      guard: "now >= expires_at (sweeper) — checked again inside the UPDATE",
    },
    {
      from: "active",
      to: "revoked",
      event: "revoke",
      actor: ["system", "maintainer"],
      guard: "task cancelled, contributor suspended, or maintainer action with reason",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Canonical document workflow: shared by Application Roadmaps and Feature Contracts.
// One open workflow per subject (target for roadmaps, feature for contracts), enforced by a
// partial unique index.
// ---------------------------------------------------------------------------------------------

export const DocumentStates = ["drafting", "validating", "in_review", "revising", "escalated", "consensus", "merged", "abandoned"] as const;
export type DocumentState = (typeof DocumentStates)[number];
export type DocumentEvent =
  | "revision_submitted"
  | "validation_passed"
  | "validation_failed"
  | "round_gaps"
  | "round_consensus"
  | "round_limit_reached"
  | "ruling_upheld"
  | "ruling_all_overruled"
  | "maintainer_reopen"
  | "pr_merged"
  | "abandon";

export const DocumentMachine = machine<DocumentState, DocumentEvent>({
  name: "document",
  states: DocumentStates,
  initial: ["drafting"],
  terminal: ["merged", "abandoned"],
  transitions: [
    {
      from: "drafting",
      to: "validating",
      event: "revision_submitted",
      actor: ["contributor"],
      guard: "caller holds the author task lease; changeset only touches the document's allowed paths",
    },
    {
      from: "revising",
      to: "validating",
      event: "revision_submitted",
      actor: ["contributor"],
      guard: "caller holds the author task lease; changeset only touches the document's allowed paths",
    },
    {
      from: "validating",
      to: "in_review",
      event: "validation_passed",
      actor: ["system"],
      guard:
        "document parses against its schema; deterministic validators pass (build-graph validator for contracts); candidate commit pushed; new consensus round opened on that head sha",
    },
    {
      from: "validating",
      to: "revising",
      event: "validation_failed",
      actor: ["system"],
      guard: "schema or validator errors; errors attached to a new author task; round counter unchanged",
    },
    {
      from: "in_review",
      to: "revising",
      event: "round_gaps",
      actor: ["system"],
      guard: "round revealed with >=1 open material finding and round_number < policy.maxRounds",
    },
    {
      from: "in_review",
      to: "escalated",
      event: "round_limit_reached",
      actor: ["system"],
      guard:
        "round revealed with open material findings and round_number >= policy.maxRounds, or a finding disputed in two consecutive rounds",
    },
    {
      from: "in_review",
      to: "consensus",
      event: "round_consensus",
      actor: ["system"],
      guard: "both reviewers (Astra and Fable providers) returned NO_MATERIAL_GAPS on the same head sha in the same round",
    },
    {
      from: "escalated",
      to: "revising",
      event: "ruling_upheld",
      actor: ["maintainer"],
      guard: "every escalated finding has a confirmed ruling (upheld/overruled); at least one upheld",
    },
    {
      from: "escalated",
      to: "validating",
      event: "ruling_all_overruled",
      actor: ["maintainer"],
      guard: "every escalated finding overruled; a fresh round is opened on the unchanged head sha with overruled findings closed",
    },
    {
      from: "consensus",
      to: "revising",
      event: "maintainer_reopen",
      actor: ["maintainer"],
      guard: "maintainer requests changes before merge, with reason (public)",
    },
    {
      from: "consensus",
      to: "merged",
      event: "pr_merged",
      actor: ["github"],
      guard: "PR merged with merge commit whose tree equals the consensus head sha tree",
    },
    { from: "drafting", to: "abandoned", event: "abandon", actor: ["maintainer"], guard: "reason recorded" },
    { from: "validating", to: "abandoned", event: "abandon", actor: ["maintainer"], guard: "reason recorded" },
    { from: "in_review", to: "abandoned", event: "abandon", actor: ["maintainer"], guard: "reason recorded" },
    { from: "revising", to: "abandoned", event: "abandon", actor: ["maintainer"], guard: "reason recorded" },
    { from: "escalated", to: "abandoned", event: "abandon", actor: ["maintainer"], guard: "reason recorded" },
    { from: "consensus", to: "abandoned", event: "abandon", actor: ["maintainer"], guard: "reason recorded" },
  ],
});

// ---------------------------------------------------------------------------------------------
// Consensus round: one Astra verdict + one Fable verdict on one head sha.
// Used for roadmap rounds, feature contract rounds and implementation review rounds.
// ---------------------------------------------------------------------------------------------

export const RoundStates = ["awaiting_reviews", "revealed", "cancelled"] as const;
export type RoundState = (typeof RoundStates)[number];
export type RoundEvent = "second_verdict_sealed" | "cancel";

export const RoundMachine = machine<RoundState, RoundEvent>({
  name: "consensus_round",
  states: RoundStates,
  initial: ["awaiting_reviews"],
  terminal: ["revealed", "cancelled"],
  transitions: [
    {
      from: "awaiting_reviews",
      to: "revealed",
      event: "second_verdict_sealed",
      actor: ["system"],
      guard:
        "a valid verdict from each required provider is stored for this round's head sha; outcome computed; both verdicts become visible atomically",
    },
    {
      from: "awaiting_reviews",
      to: "cancelled",
      event: "cancel",
      actor: ["system", "maintainer"],
      guard: "subject abandoned or superseded; open review tasks cancelled",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// ABU: an Atomic Build Unit in a merged Build Graph.
// ---------------------------------------------------------------------------------------------

export const AbuStates = ["pending_dependencies", "ready", "in_progress", "merged", "needs_decomposition", "superseded"] as const;
export type AbuState = (typeof AbuStates)[number];
export type AbuEvent =
  | "dependencies_merged"
  | "attempt_started"
  | "attempt_ended"
  | "attempt_merged"
  | "flag_for_decomposition"
  | "supersede";

export const AbuMachine = machine<AbuState, AbuEvent>({
  name: "abu",
  states: AbuStates,
  initial: ["pending_dependencies", "ready"],
  terminal: ["merged", "needs_decomposition", "superseded"],
  transitions: [
    { from: "pending_dependencies", to: "ready", event: "dependencies_merged", actor: ["system"], guard: "every depends_on ABU is merged" },
    {
      from: "ready",
      to: "in_progress",
      event: "attempt_started",
      actor: ["system"],
      guard: "an attempt was created by a successful build-task claim in the same transaction",
    },
    {
      from: "in_progress",
      to: "ready",
      event: "attempt_ended",
      actor: ["system"],
      guard:
        "the attempt reached expired/abandoned/failed/closed_unmerged; failed_attempts is incremented in the same transaction for failed/expired/closed_unmerged (not abandoned); failed_attempts < policy.maxFailedAttemptsPerAbu",
    },
    {
      from: "in_progress",
      to: "needs_decomposition",
      event: "flag_for_decomposition",
      actor: ["system", "maintainer"],
      guard: "failed_attempts reached policy.maxFailedAttemptsPerAbu, or maintainer decision with reason",
    },
    {
      from: "ready",
      to: "needs_decomposition",
      event: "flag_for_decomposition",
      actor: ["maintainer"],
      guard: "maintainer decision with reason",
    },
    {
      from: "in_progress",
      to: "merged",
      event: "attempt_merged",
      actor: ["github"],
      guard: "the attempt's PR merged into the default branch (an ABU is built once and counts for every app whose profile it covers, D10)",
    },
    {
      from: "pending_dependencies",
      to: "superseded",
      event: "supersede",
      actor: ["system"],
      guard: "a newer contract version of the catalog feature merged and does not carry this ABU over unchanged",
    },
    {
      from: "ready",
      to: "superseded",
      event: "supersede",
      actor: ["system"],
      guard: "a newer contract version of the catalog feature merged and does not carry this ABU over unchanged",
    },
    {
      from: "in_progress",
      to: "superseded",
      event: "supersede",
      actor: ["system"],
      guard: "a newer contract version merged; the active attempt is superseded in the same transaction",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Attempt: one contributor's run at one ABU. LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR.
// ---------------------------------------------------------------------------------------------

export const AttemptStates = [
  "leased",
  "building",
  "verifying",
  "submitted",
  "candidate_pushed",
  "in_review",
  "changes_requested",
  "qualified",
  "pr_open",
  "merged",
  "expired",
  "abandoned",
  "failed",
  "closed_unmerged",
  "superseded",
] as const;
export type AttemptState = (typeof AttemptStates)[number];
export type AttemptEvent =
  | "start_build"
  | "start_verify"
  | "verify_failed_locally"
  | "submit_changeset"
  | "candidate_committed"
  | "ci_passed"
  | "ci_failed"
  | "round_gaps"
  | "round_passed_and_qualified"
  | "resume_for_revision"
  | "pr_opened"
  | "merge_blocked"
  | "pr_merged"
  | "pr_closed"
  | "lease_lapsed"
  | "abandon"
  | "fail"
  | "supersede";

const liveBeforePr: readonly AttemptState[] = [
  "leased",
  "building",
  "verifying",
  "submitted",
  "candidate_pushed",
  "in_review",
  "changes_requested",
  "qualified",
];

export const AttemptMachine = machine<AttemptState, AttemptEvent>({
  name: "attempt",
  states: AttemptStates,
  initial: ["leased"],
  terminal: ["merged", "expired", "abandoned", "failed", "closed_unmerged", "superseded"],
  transitions: [
    {
      from: "leased",
      to: "building",
      event: "start_build",
      actor: ["contributor"],
      guard: "caller holds active build lease; context manifest posted and accepted (policy, source commit, artifact oids)",
    },
    {
      from: "building",
      to: "verifying",
      event: "start_verify",
      actor: ["contributor"],
      guard: "caller holds active lease; agent run record posted",
    },
    {
      from: "verifying",
      to: "building",
      event: "verify_failed_locally",
      actor: ["contributor"],
      guard: "local_repair_count < policy.maxLocalRepairLoops (incremented)",
    },
    {
      from: "verifying",
      to: "submitted",
      event: "submit_changeset",
      actor: ["contributor"],
      guard:
        "caller holds active lease; changeset passes server-side scope validation against the ABU scope at the plan's source commit; the App commit (candidate_committed) already succeeded in this request; both transitions, both events and the lease completion are written in ONE transaction",
    },
    {
      from: "submitted",
      to: "candidate_pushed",
      event: "candidate_committed",
      actor: ["system"],
      guard:
        "in the same request and transaction as submit_changeset: the GitHub App created the commit on wos/candidate/<attemptId> with parent = the plan's source commit before anything was recorded. A retry after a failed transaction force-moves the candidate ref to the new commit; only the recorded head is ever reviewed",
    },
    {
      from: "candidate_pushed",
      to: "in_review",
      event: "ci_passed",
      actor: ["github"],
      guard:
        "required CI check suite concluded success for exactly the candidate head sha; review round opened with one Astra and one Fable review task",
    },
    {
      from: "candidate_pushed",
      to: "changes_requested",
      event: "ci_failed",
      actor: ["github"],
      guard: "required CI concluded failure/timed_out for the candidate head sha; repair_count < policy.maxRepairRounds",
    },
    {
      from: "in_review",
      to: "changes_requested",
      event: "round_gaps",
      actor: ["system"],
      guard: "implementation round revealed with >=1 open material finding; repair_count < policy.maxRepairRounds",
    },
    {
      from: "in_review",
      to: "qualified",
      event: "round_passed_and_qualified",
      actor: ["system"],
      guard:
        "both verdicts NO_MATERIAL_GAPS on candidate head sha; CI success on same sha; scope re-validated; reviewer independence satisfied; attestations present",
    },
    {
      from: "changes_requested",
      to: "building",
      event: "resume_for_revision",
      actor: ["contributor"],
      guard:
        "caller is the attempt's builder; claims the revision task (new lease); repair_count incremented; base may be moved to current default-branch head (rebase)",
    },
    {
      from: "qualified",
      to: "pr_open",
      event: "pr_opened",
      actor: ["system"],
      guard:
        "GitHub App opened the PR (first qualification) or moved the open PR's official branch to the newly qualified head (re-qualification after merge_blocked); wos/qualified status set on that head sha",
    },
    {
      from: "pr_open",
      to: "changes_requested",
      event: "merge_blocked",
      actor: ["github"],
      guard: "merge queue ejected the PR (conflict or failing combined CI) and repair_count < policy.maxRepairRounds; PR stays open",
    },
    {
      from: "pr_open",
      to: "merged",
      event: "pr_merged",
      actor: ["github"],
      guard: "pull_request closed with merged=true on the default branch",
    },
    { from: "pr_open", to: "closed_unmerged", event: "pr_closed", actor: ["github"], guard: "pull_request closed with merged=false" },
    ...(["leased", "building", "verifying", "changes_requested"] as const).map((from) => ({
      from,
      to: "expired" as const,
      event: "lease_lapsed" as const,
      actor: ["system"] as Actor[],
      guard:
        from === "changes_requested"
          ? "revision window (policy.revisionWindowHours) elapsed without a revision claim"
          : "the attempt's active lease expired or was revoked",
    })),
    ...(["leased", "building", "verifying", "changes_requested", "pr_open"] as const).map((from) => ({
      from,
      to: "abandoned" as const,
      event: "abandon" as const,
      actor: ["contributor"] as Actor[],
      guard: "caller is the attempt's builder; open PR (if any) is closed by the App",
    })),
    ...([...liveBeforePr, "pr_open"] as const).map((from) => ({
      from,
      to: "failed" as const,
      event: "fail" as const,
      actor: ["system", "maintainer"] as Actor[],
      guard: "system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded",
    })),
    ...([...liveBeforePr, "pr_open"] as const).map((from) => ({
      from,
      to: "superseded" as const,
      event: "supersede" as const,
      actor: ["system"] as Actor[],
      guard: "the ABU was superseded by a newer contract version",
    })),
  ],
});

// ---------------------------------------------------------------------------------------------
// Catalog feature (D10): global, app-independent. Created when the roadmap that proposes it merges.
// ---------------------------------------------------------------------------------------------

export const CatalogFeatureStates = ["active", "aliased"] as const;
export type CatalogFeatureState = (typeof CatalogFeatureStates)[number];
export type CatalogFeatureEvent = "alias_merged";

export const CatalogFeatureMachine = machine<CatalogFeatureState, CatalogFeatureEvent>({
  name: "catalog_feature",
  states: CatalogFeatureStates,
  initial: ["active"],
  terminal: ["aliased"],
  transitions: [
    {
      from: "active",
      to: "aliased",
      event: "alias_merged",
      actor: ["github"],
      guard:
        "a maintainer-approved alias PR merged: catalog/<key>.yaml has aliasOf set and the target feature's contract version that absorbs this feature's requirements and profiles merged in the same PR",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// App feature (D11): the tracked record of one catalog feature for one app. Status is DERIVED by the
// progress consumer from the merged roadmap, the merged contract profile and merged ABUs; it is never
// set by a request handler.
// ---------------------------------------------------------------------------------------------

export const AppFeatureStates = ["mapped", "specifying", "specified", "building", "built", "descoped"] as const;
export type AppFeatureState = (typeof AppFeatureStates)[number];
export type AppFeatureEvent =
  | "contract_workflow_linked"
  | "profile_merged"
  | "first_relevant_abu_started"
  | "profile_complete"
  | "profile_reopened"
  | "descoped";

export const AppFeatureMachine = machine<AppFeatureState, AppFeatureEvent>({
  name: "app_feature",
  states: AppFeatureStates,
  initial: ["mapped"],
  terminal: ["descoped"],
  transitions: [
    {
      from: "mapped",
      to: "specifying",
      event: "contract_workflow_linked",
      actor: ["system"],
      guard: "the catalog feature's contract workflow is open (opened or linked when the roadmap merged) and will carry this app's profile",
    },
    {
      from: "mapped",
      to: "specified",
      event: "profile_merged",
      actor: ["github"],
      guard: "a merged contract of the catalog feature contains this app's profile (e.g. contract already existed with the profile)",
    },
    {
      from: "specifying",
      to: "specified",
      event: "profile_merged",
      actor: ["github"],
      guard: "the contract version containing this app's profile merged; build graph ingested",
    },
    {
      from: "specified",
      to: "building",
      event: "first_relevant_abu_started",
      actor: ["system"],
      guard: "an attempt exists for an ABU relevant to this app's profile",
    },
    {
      from: "specified",
      to: "built",
      event: "profile_complete",
      actor: ["system"],
      guard: "all relevant ABUs already merged (built by another app's work) and the profile acceptance suite passed",
    },
    {
      from: "building",
      to: "built",
      event: "profile_complete",
      actor: ["system"],
      guard: "all relevant ABUs merged and the profile acceptance suite passed on the default branch",
    },
    {
      from: "specified",
      to: "specifying",
      event: "profile_reopened",
      actor: ["system"],
      guard: "an open contract version lists this app in impactedTargets",
    },
    {
      from: "building",
      to: "specifying",
      event: "profile_reopened",
      actor: ["system"],
      guard: "an open contract version lists this app in impactedTargets",
    },
    {
      from: "built",
      to: "specifying",
      event: "profile_reopened",
      actor: ["system"],
      guard: "an open contract version lists this app in impactedTargets",
    },
    ...(["mapped", "specifying", "specified", "building", "built"] as const).map((from) => ({
      from,
      to: "descoped" as const,
      event: "descoped" as const,
      actor: ["github"] as Actor[],
      guard: "a merged roadmap version of this app no longer references the catalog feature",
    })),
  ],
});

// ---------------------------------------------------------------------------------------------
// Contribution (reward eligibility of a unit of accepted work).
// ---------------------------------------------------------------------------------------------

export const ContributionStates = ["pending", "accepted", "rejected", "reversed"] as const;
export type ContributionState = (typeof ContributionStates)[number];
export type ContributionEvent = "accept" | "reject" | "reverse";

export const ContributionMachine = machine<ContributionState, ContributionEvent>({
  name: "contribution",
  states: ContributionStates,
  initial: ["pending"],
  terminal: ["rejected", "reversed"],
  transitions: [
    {
      from: "pending",
      to: "accepted",
      event: "accept",
      actor: ["system", "github"],
      guard: "the category's acceptance condition in REWARD-PROTOCOL.md holds",
    },
    {
      from: "pending",
      to: "rejected",
      event: "reject",
      actor: ["system", "maintainer"],
      guard: "subject ended without acceptance, or maintainer rejection with reason",
    },
    {
      from: "accepted",
      to: "reversed",
      event: "reverse",
      actor: ["maintainer", "github"],
      guard: "the merged change was reverted as defective within the hold window, or fraud finding by maintainer (public reason)",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Inventory version (the MAPPED % denominator).
// ---------------------------------------------------------------------------------------------

export const InventoryStates = ["proposed", "frozen", "superseded"] as const;
export type InventoryState = (typeof InventoryStates)[number];
export type InventoryEvent = "roadmap_merged" | "superseded_by_newer";

export const InventoryMachine = machine<InventoryState, InventoryEvent>({
  name: "inventory_version",
  states: InventoryStates,
  initial: ["proposed"],
  terminal: ["superseded"],
  transitions: [
    {
      from: "proposed",
      to: "frozen",
      event: "roadmap_merged",
      actor: ["github"],
      guard: "the roadmap PR containing this inventory merged",
    },
    {
      from: "frozen",
      to: "superseded",
      event: "superseded_by_newer",
      actor: ["github"],
      guard: "a later roadmap version with a newer inventory merged",
    },
  ],
});

// ---------------------------------------------------------------------------------------------
// Proposal (wos propose) and Blocker (wos resolve), both mirrored to GitHub Issues.
// ---------------------------------------------------------------------------------------------

export const ProposalStates = ["open", "accepted", "rejected", "incorporated"] as const;
export type ProposalState = (typeof ProposalStates)[number];
export type ProposalEvent = "accept" | "reject" | "incorporate";

export const ProposalMachine = machine<ProposalState, ProposalEvent>({
  name: "proposal",
  states: ProposalStates,
  initial: ["open"],
  terminal: ["rejected", "incorporated"],
  transitions: [
    {
      from: "open",
      to: "accepted",
      event: "accept",
      actor: ["maintainer", "system"],
      guard: "maintainer triage, or the roadmap author task for the next round lists it as addressed",
    },
    { from: "open", to: "rejected", event: "reject", actor: ["maintainer"], guard: "reason recorded publicly on the issue" },
    {
      from: "accepted",
      to: "incorporated",
      event: "incorporate",
      actor: ["github"],
      guard: "a merged roadmap/contract version references the proposal id",
    },
  ],
});

export const BlockerStates = ["open", "resolving", "resolved", "rejected"] as const;
export type BlockerState = (typeof BlockerStates)[number];
export type BlockerEvent = "claim_resolution" | "resolution_merged" | "reject" | "resolution_lost";

export const BlockerMachine = machine<BlockerState, BlockerEvent>({
  name: "blocker",
  states: BlockerStates,
  initial: ["open"],
  terminal: ["resolved", "rejected"],
  transitions: [
    {
      from: "open",
      to: "resolving",
      event: "claim_resolution",
      actor: ["contributor"],
      guard: "resolver task claimed under the Architecture Conflict Resolver policy",
    },
    { from: "resolving", to: "open", event: "resolution_lost", actor: ["system"], guard: "resolver lease expired or released" },
    {
      from: "resolving",
      to: "resolved",
      event: "resolution_merged",
      actor: ["github"],
      guard: "the resolution PR (contract change) merged",
    },
    { from: "open", to: "rejected", event: "reject", actor: ["maintainer"], guard: "reason recorded on the issue" },
    { from: "resolving", to: "rejected", event: "reject", actor: ["maintainer"], guard: "reason recorded on the issue" },
  ],
});

export const ALL_MACHINES = [
  TaskMachine,
  LeaseMachine,
  DocumentMachine,
  RoundMachine,
  AbuMachine,
  AttemptMachine,
  CatalogFeatureMachine,
  AppFeatureMachine,
  ContributionMachine,
  InventoryMachine,
  ProposalMachine,
  BlockerMachine,
] as const;
