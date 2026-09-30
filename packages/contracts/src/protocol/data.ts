/** DRAFT — V1 protocol policy documents, parsed at import (a malformed data file throws). All status "draft". */
import capabilityJson from "./data/capability-policy.v1.json" with { type: "json" };
import completionJson from "./data/completion-policy.v1.json" with { type: "json" };
import genesisJson from "./data/genesis-policy.v1.json" with { type: "json" };
import mergeJson from "./data/merge-policy.v1.json" with { type: "json" };
import oracleJson from "./data/model-rate-oracle.v1.json" with { type: "json" };
import reviewJson from "./data/review-policy.v1.json" with { type: "json" };
import rewardJson from "./data/reward-policy.v1.json" with { type: "json" };
import riskJson from "./data/risk-policy.v1.json" with { type: "json" };
import usageJson from "./data/usage-proof-policy.v1.json" with { type: "json" };
import {
  AgentCapabilityPolicy,
  CompletionRewardPolicy,
  GenesisAllocationPolicy,
  MergePolicy,
  ModelRateOracle,
  ReviewPolicy,
  RewardPolicy,
  RiskPolicy,
  UsageProofPolicy,
} from "./policies.js";

export const MODEL_RATE_ORACLE_V1: ModelRateOracle = ModelRateOracle.parse(oracleJson);
export const REWARD_POLICY_V1: RewardPolicy = RewardPolicy.parse(rewardJson);
export const REVIEW_POLICY_V1: ReviewPolicy = ReviewPolicy.parse(reviewJson);
export const CAPABILITY_POLICY_V1: AgentCapabilityPolicy = AgentCapabilityPolicy.parse(capabilityJson);
export const USAGE_PROOF_POLICY_V1: UsageProofPolicy = UsageProofPolicy.parse(usageJson);
export const RISK_POLICY_V1: RiskPolicy = RiskPolicy.parse(riskJson);
export const MERGE_POLICY_V1: MergePolicy = MergePolicy.parse(mergeJson);
export const COMPLETION_POLICY_V1: CompletionRewardPolicy = CompletionRewardPolicy.parse(completionJson);
export const GENESIS_POLICY_V1: GenesisAllocationPolicy = GenesisAllocationPolicy.parse(genesisJson);
