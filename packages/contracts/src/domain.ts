import { z } from "zod";
import { AgentRole, ModelRef, ProviderId, ReasoningLevel, ReviewerSlot } from "./agent-policy.js";
import { ProviderAttestation, ReviewIndependence, TaskKind } from "./agent-io.js";
import {
  AbuKey,
  BasisPoints,
  CapabilityKey,
  FeatureKey,
  GitSha,
  GithubLogin,
  RepoFullName,
  Surface,
  RequirementKey,
  TargetSlug,
  Timestamp,
  TokenAmount,
  Uuid,
} from "./primitives.js";
import {
  AbuStates,
  AttemptStates,
  BlockerStates,
  ContributionStates,
  DocumentStates,
  AppFeatureStates,
  CatalogFeatureStates,
  LeaseStates,
  ProposalStates,
  RoundStates,
  TaskStates,
} from "./state-machines.js";
import { Journey } from "./artifacts.js";
import { LedgerEntryKind, RewardCategory, LedgerBucket } from "./rewards.js";

/**
 * Read models exchanged over the API. They mirror the tables in packages/db but are the
 * public shape: nothing here may expose sealed verdicts, session data or device keys.
 */

export const TaskStateSchema = z.enum(TaskStates);
export const LeaseStateSchema = z.enum(LeaseStates);
export const DocumentStateSchema = z.enum(DocumentStates);
export const RoundStateSchema = z.enum(RoundStates);
export const AbuStateSchema = z.enum(AbuStates);
export const AttemptStateSchema = z.enum(AttemptStates);
export const AppFeatureStateSchema = z.enum(AppFeatureStates);
export const CatalogFeatureStateSchema = z.enum(CatalogFeatureStates);
export const ContributionStateSchema = z.enum(ContributionStates);
export const ProposalStateSchema = z.enum(ProposalStates);
export const BlockerStateSchema = z.enum(BlockerStates);

/**
 * App progress triple, exactly as computed by computeAppProgress (progress.ts). Always floor.
 * Every number states the roadmap version whose frozen weights it uses (D11/D12).
 */
export const Progress = z.object({
  mappedBp: BasisPoints,
  specifiedBp: BasisPoints,
  builtBp: BasisPoints,
  /** Null until the first roadmap version merges. */
  roadmapVersion: z.number().int().positive().nullable(),
  inventoryVersion: z.number().int().positive().nullable(),
  inventoryItems: z.number().int().nonnegative().nullable(),
  excludedItems: z.number().int().nonnegative(),
  computedAt: Timestamp.nullable(),
});
export type Progress = z.infer<typeof Progress>;

export const ZERO_PROGRESS: Progress = {
  mappedBp: 0,
  specifiedBp: 0,
  builtBp: 0,
  roadmapVersion: null,
  inventoryVersion: null,
  inventoryItems: null,
  excludedItems: 0,
  computedAt: null,
};

/** contracts 5.5.0 (D60): `architecture` = an architecture record (architecture/ADR-nnn.yaml in the product repo). */
export const DocumentKind = z.enum(["roadmap", "feature_contract", "architecture"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const DocumentWorkflowSummary = z.object({
  id: Uuid,
  kind: DocumentKind,
  version: z.number().int().positive(),
  state: DocumentStateSchema,
  roundNumber: z.number().int().nonnegative(),
  prUrl: z.url().nullable(),
  headSha: GitSha.nullable(),
  updatedAt: Timestamp,
});

export const TargetSummary = z.object({
  slug: TargetSlug,
  name: z.string(),
  /** 0 is warOnSaaS itself (TGT-00, dogfood); 1..10 the Sniper List. */
  rank: z.number().int().nonnegative(),
  whatItIs: z.string(),
  /** Name of our replacement product, null until the roadmap names it. */
  productName: z.string().nullable(),
  /** Always the product repo (waronsaas/product) for replacements; the platform repo for TGT-00 warOnSaaS. */
  repo: RepoFullName,
  progress: Progress,
  roadmap: DocumentWorkflowSummary.nullable(),
  hosted: z.object({ available: z.boolean(), url: z.url().nullable() }),
  selfHostable: z.boolean(),
  /**
   * contracts 5.2.0: the applications this target maps to (`wos.target_apps`, e.g. salesforce -> ["crm"]), sorted.
   * Informative links only: a target's `progress` never depends on them (V1 proof step 9). Absent before Wave 3.
   */
  apps: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/)).optional(),
});
export type TargetSummary = z.infer<typeof TargetSummary>;

/** One catalog feature as tracked for one app (D11). All numbers from progress.ts FeatureProgress. */
export const AppFeatureSummary = z.object({
  key: FeatureKey,
  capability: CapabilityKey,
  title: z.string(),
  summary: z.string(),
  /** "proposed" (4.4.0): a feature of an unmerged roadmap; it has no app_features row and no progress yet. */
  state: z.union([AppFeatureStateSchema, z.literal("proposed")]),
  weightBp: z.number().int().positive(),
  weightRationale: z.string(),
  effectiveAppWeightBp: z.number().int().nonnegative(),
  specifiedBp: BasisPoints,
  builtBp: BasisPoints,
  relevantPoints: z.number().int().nonnegative(),
  mergedPoints: z.number().int().nonnegative(),
  /** Per-surface progress, weights and rationales (D13: the drilldown shows progress per surface). */
  surfaces: z.array(
    z.object({
      surface: Surface,
      weightBp: z.number().int().positive(),
      weightRationale: z.string(),
      specifiedBp: BasisPoints,
      builtBp: BasisPoints,
      relevantPoints: z.number().int().nonnegative(),
      mergedPoints: z.number().int().nonnegative(),
      acceptancePassed: z.boolean(),
    }),
  ),
  /** Key user journeys per surface from the roadmap (D13). */
  journeys: z.array(Journey),
  /** Other apps whose roadmaps reference the same catalog feature (D10 cross-reference). */
  sharedWith: z.array(TargetSlug),
  contract: DocumentWorkflowSummary.nullable(),
});
export type AppFeatureSummary = z.infer<typeof AppFeatureSummary>;

export const CapabilitySummary = z.object({
  key: CapabilityKey,
  title: z.string(),
  summary: z.string(),
  weightBp: z.number().int().positive(),
  weightRationale: z.string(),
  mapped: z.boolean(),
  specifiedBp: BasisPoints,
  builtBp: BasisPoints,
  features: z.array(AppFeatureSummary),
});

export const TargetDetail = TargetSummary.extend({
  /**
   * contracts 4.4.0 (B-0001-web): "merged" when capabilities come from the latest merged roadmap version,
   * "proposed" when they come from an unmerged roadmap (TGT-00 until its first consensus). Absent = merged.
   */
  basis: z.enum(["merged", "proposed"]).optional(),
  /** D13: every surface the vendor ships, in scope or excluded, with per-surface app progress. */
  surfaces: z.array(
    z.object({
      surface: Surface,
      status: z.enum(["in_scope", "excluded"]),
      reason: z.string().nullable(),
      repo: RepoFullName.nullable(),
      specifiedBp: BasisPoints,
      builtBp: BasisPoints,
    }),
  ),
  capabilities: z.array(CapabilitySummary),
  excluded: z.array(z.object({ item: z.string(), title: z.string(), reason: z.string() })),
});
export type TargetDetail = z.infer<typeof TargetDetail>;

export const RequirementView = z.object({
  key: RequirementKey,
  kind: z.string(),
  statement: z.string(),
  /** contracts 4.4.0 (B-0001-web): the requirement's acceptance criteria, shown in the drilldown. */
  acceptance: z.array(z.string()).optional(),
  /** Relevant ABUs covering it (for the app in context, or all ABUs on catalog pages). */
  abus: z.array(AbuKey),
  built: z.boolean(),
  /** Apps whose profile includes this requirement. */
  profiles: z.array(TargetSlug),
  /** Surfaces the requirement applies to (D13). */
  surfaces: z.array(Surface),
});

export const AbuSummary = z.object({
  id: Uuid,
  key: AbuKey,
  title: z.string(),
  state: AbuStateSchema,
  sizePoints: z.number().int().positive(),
  dependsOn: z.array(AbuKey),
  requirements: z.array(RequirementKey),
  repo: RepoFullName,
  /** Apps whose profile this ABU is relevant to (it is built once and counts for each, D10). */
  relevantTo: z.array(TargetSlug),
  /** True when the caller could claim it now (only set on authenticated list routes). */
  claimable: z.boolean().nullable(),
  pr: z.object({ number: z.number().int(), url: z.url(), state: z.enum(["open", "merged", "closed"]) }).nullable(),
});
export type AbuSummary = z.infer<typeof AbuSummary>;

/** App drilldown level 3: app -> capability -> FEATURE -> requirement -> ABU -> PR. */
export const AppFeatureDetail = AppFeatureSummary.extend({
  target: TargetSlug,
  /** Only this app's profile requirements. */
  requirements: z.array(RequirementView),
  /** Only ABUs relevant to this app's profile. */
  abus: z.array(AbuSummary),
});
export type AppFeatureDetail = z.infer<typeof AppFeatureDetail>;

/** The global catalog view of a feature (D10). */
export const CatalogFeatureDetail = z.object({
  key: FeatureKey,
  title: z.string(),
  summary: z.string(),
  state: CatalogFeatureStateSchema,
  aliasOf: FeatureKey.nullable(),
  referencedBy: z.array(z.object({ target: TargetSlug, capability: CapabilityKey, hasProfile: z.boolean(), builtBp: BasisPoints })),
  contract: DocumentWorkflowSummary.nullable(),
  requirements: z.array(RequirementView),
  abus: z.array(AbuSummary),
});
export type CatalogFeatureDetail = z.infer<typeof CatalogFeatureDetail>;

/**
 * Public handle of an account that has contributed. Set from the GitHub login when GitHub is first
 * linked (D8), unique, and never changes afterwards even if GitHub is unlinked or relinked.
 */
export const Handle = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
export type Handle = z.infer<typeof Handle>;

export const ContributorPublic = z.object({
  handle: Handle,
  /** GitHub login currently linked (null if unlinked since). Commits keep their own recorded author. */
  githubLogin: GithubLogin.nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  joinedAt: Timestamp,
  leaderboardOptIn: z.boolean(),
  /** Score shown only when opted in; otherwise null. */
  score: TokenAmount.nullable(),
});
export type ContributorPublic = z.infer<typeof ContributorPublic>;

export const ContributionView = z.object({
  id: Uuid,
  category: RewardCategory,
  state: ContributionStateSchema,
  target: TargetSlug,
  feature: FeatureKey.nullable(),
  abu: AbuKey.nullable(),
  prUrl: z.url().nullable(),
  independence: ReviewIndependence,
  acceptedAt: Timestamp.nullable(),
});
export type ContributionView = z.infer<typeof ContributionView>;

export const LedgerEntryView = z.object({
  entryNo: z.number().int().positive(),
  kind: LedgerEntryKind,
  bucket: LedgerBucket,
  amount: TokenAmount,
  category: RewardCategory.nullable(),
  memo: z.string(),
  createdAt: Timestamp,
  entryHash: z.string(),
});

export const LeaderboardRow = z.object({
  /** 0 is warOnSaaS itself (TGT-00, dogfood); 1..10 the Sniper List. */
  rank: z.number().int().nonnegative(),
  handle: Handle,
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  score: TokenAmount,
});

/** A linked GitHub identity (D8). Required for every contributor route. */
export const LinkedGithub = z.object({
  userId: z.number().int().positive(),
  login: GithubLogin,
  accountCreatedAt: Timestamp,
  linkedAt: Timestamp,
});
export type LinkedGithub = z.infer<typeof LinkedGithub>;

/**
 * The signed-in account (D8: every account is created by a verified email; GitHub is optional
 * and linked later; rewards belong to the account).
 */
export const Me = z.object({
  id: Uuid,
  email: z.email(),
  handle: Handle.nullable(),
  github: LinkedGithub.nullable(),
  /** True when github is linked and the account may take leases, review, propose or resolve. */
  canContribute: z.boolean(),
  displayName: z.string().nullable(),
  roles: z.array(z.enum(["maintainer"])),
  leaderboardOptIn: z.boolean(),
  status: z.enum(["active", "suspended"]),
  followedTargets: z.array(TargetSlug),
  progressEmails: z.boolean(),
  attestations: z.array(ProviderAttestation),
  balance: z.object({ held: TokenAmount, available: TokenAmount, score: TokenAmount }),
});
export type Me = z.infer<typeof Me>;

export const LeaseView = z.object({
  id: Uuid,
  taskId: Uuid,
  state: LeaseStateSchema,
  issuedAt: Timestamp,
  expiresAt: Timestamp,
  hardDeadlineAt: Timestamp,
  heartbeatSeconds: z.number().int().positive(),
});
export type LeaseView = z.infer<typeof LeaseView>;

export const TaskView = z.object({
  id: Uuid,
  kind: TaskKind,
  state: TaskStateSchema,
  role: AgentRole,
  reviewerSlot: ReviewerSlot.nullable(),
  /**
   * Work subject model (contracts 3.0.0, D10): roadmap work belongs to ONE app (`target` set, `feature`
   * null); contract, build and implementation-review work belongs to ONE catalog feature (`feature` set,
   * `target` null) and serves every app in `relevantTo`. Never pick a representative app.
   */
  target: TargetSlug.nullable(),
  feature: FeatureKey.nullable(),
  /** Apps this work counts for: [target] for roadmap work; the apps whose profile it serves otherwise. */
  relevantTo: z.array(TargetSlug),
  /** Repository the work lands in: the product repo, or the platform repo for TGT-00 warOnSaaS. */
  repo: RepoFullName,
  abu: AbuKey.nullable(),
  attemptId: Uuid.nullable(),
  documentId: Uuid.nullable(),
  roundId: Uuid.nullable(),
  createdAt: Timestamp,
});
export type TaskView = z.infer<typeof TaskView>;

export const AttemptView = z.object({
  id: Uuid,
  abu: AbuKey,
  feature: FeatureKey,
  relevantTo: z.array(TargetSlug),
  repo: RepoFullName,
  state: AttemptStateSchema,
  builderHandle: Handle,
  baseSha: GitSha,
  candidateBranch: z.string().nullable(),
  headSha: GitSha.nullable(),
  repairCount: z.number().int().nonnegative(),
  /** D15: the provider and model that built the latest submission (shown on the site). Optional for 4.0 producers. */
  builtWith: z.object({ provider: ProviderId, model: ModelRef, modelId: z.string() }).nullable().optional(),
  pr: z.object({ number: z.number().int(), url: z.url() }).nullable(),
  failureReason: z.string().nullable(),
  updatedAt: Timestamp,
});
export type AttemptView = z.infer<typeof AttemptView>;

/** Revealed review, safe to show publicly. Sealed reviews never leave the server. */
export const ReviewView = z.object({
  id: Uuid,
  roundId: Uuid,
  roundNumber: z.number().int().positive(),
  slot: ReviewerSlot,
  reviewerHandle: Handle,
  provider: ProviderId,
  model: ModelRef,
  reasoning: ReasoningLevel,
  verdict: z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]),
  headSha: GitSha,
  independence: ReviewIndependence,
  revealedAt: Timestamp,
});

export const PlatformStatus = z.object({
  bootstrapMode: z.boolean(),
  bootstrapSince: Timestamp.nullable(),
  contractsVersion: z.string(),
  policyVersion: z.string(),
  rewardScheduleVersion: z.string(),
});
export type PlatformStatus = z.infer<typeof PlatformStatus>;
