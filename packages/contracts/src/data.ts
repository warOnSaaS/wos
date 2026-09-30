import policyJson from "./data/agent-policy.v1.json" with { type: "json" };
import scheduleJson from "./data/reward-schedule.v1.json" with { type: "json" };
import architectureJson from "./data/architecture-policy.v1.json" with { type: "json" };
import { AgentPolicyDocument } from "./agent-policy.js";
import bugsJson from "./data/bugs-policy.v1.json" with { type: "json" };
import { ArchitecturePolicy } from "./architecture.js";
import { BugsPolicy } from "./bugs.js";
import { RewardSchedule } from "./rewards.js";

/** The V1 Agent Policy document, parsed (throws at import if the data file is invalid). */
export const AGENT_POLICY_V1: AgentPolicyDocument = AgentPolicyDocument.parse(policyJson);

/** The proposed V1 reward schedule (status "proposal" until the founder activates it). */
export const REWARD_SCHEDULE_V1: RewardSchedule = RewardSchedule.parse(scheduleJson);

/** D60 (contracts 5.5.0): architecture records' round limit, sign-off, hold rules and the build-next boost. */
export const ARCHITECTURE_POLICY_V1: ArchitecturePolicy = ArchitecturePolicy.parse(architectureJson);

/** D61 (contracts 5.7.0): severity boosts in build next, critical-bug holds, triage and regression rules. */
export const BUGS_POLICY_V1: BugsPolicy = BugsPolicy.parse(bugsJson);
