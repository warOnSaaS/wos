import policyJson from "./data/agent-policy.v1.json" with { type: "json" };
import policyV2Json from "./data/agent-policy.v2.json" with { type: "json" };
import policyV3Json from "./data/agent-policy.v3.json" with { type: "json" };
import scheduleJson from "./data/reward-schedule.v1.json" with { type: "json" };
import architectureJson from "./data/architecture-policy.v1.json" with { type: "json" };
import { AgentPolicyDocument } from "./agent-policy.js";
import bugsJson from "./data/bugs-policy.v1.json" with { type: "json" };
import { ArchitecturePolicy } from "./architecture.js";
import { BugsPolicy } from "./bugs.js";
import identityJson from "./data/identity-policy.v1.json" with { type: "json" };
import disposableJson from "./data/disposable-email-domains.v1.json" with { type: "json" };
import { DomainList, IdentityPolicy } from "./identity.js";
import { RewardSchedule } from "./rewards.js";

/** The V1 Agent Policy document, parsed (throws at import if the data file is invalid). */
export const AGENT_POLICY_V1: AgentPolicyDocument = AgentPolicyDocument.parse(policyJson);
/**
 * contracts 5.17.0: agent-policy.v2 = v1 plus D70 (network by role: read-only web for research roles, target domain
 * allowlists, the registry exception), the opencode provider and the candidate model glm (D69). v1 is unchanged.
 */
export const AGENT_POLICY_V2: AgentPolicyDocument = AgentPolicyDocument.parse(policyV2Json);
/**
 * contracts 5.19.0: agent-policy.v3 = v2 plus glm's `launchEnv` (opencode's output cap raised to 131072 after GLM trial
 * run 1 spent opencode's default 32000-token cap on reasoning) and incremental-writing instructions for opencode runs.
 * v2 is unchanged: the API had issued v2 plans, and a policy version names fixed content.
 */
export const AGENT_POLICY_V3: AgentPolicyDocument = AgentPolicyDocument.parse(policyV3Json);
/** The agent policy in force (the control plane issues plans under it; clients build invocations with it). */
export const AGENT_POLICY: AgentPolicyDocument = AGENT_POLICY_V3;

/** The proposed V1 reward schedule (status "proposal" until the founder activates it). */
export const REWARD_SCHEDULE_V1: RewardSchedule = RewardSchedule.parse(scheduleJson);

/** D60 (contracts 5.5.0): architecture records' round limit, sign-off, hold rules and the build-next boost. */
export const ARCHITECTURE_POLICY_V1: ArchitecturePolicy = ArchitecturePolicy.parse(architectureJson);

/** D61 (contracts 5.7.0): severity boosts in build next, critical-bug holds, triage and regression rules. */
export const BUGS_POLICY_V1: BugsPolicy = BugsPolicy.parse(bugsJson);

/** Amendment 04 (contracts 5.12.0): rate limits, plan quotas, abuse guards, domain rules, dormant enterprise modules. */
export const IDENTITY_POLICY_V1: IdentityPolicy = IdentityPolicy.parse(identityJson);

/** D66 (contracts 5.13.0): the pinned disposable-email-domain list (CC0-1.0), refreshed only by a reviewed PR. */
export const DISPOSABLE_EMAIL_DOMAINS: DomainList = DomainList.parse(disposableJson);
