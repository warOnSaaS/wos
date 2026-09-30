/**
 * Policy-diff preview (D33): "what would recent epochs have paid under the new policy?"
 *
 *   node tools/tokenomics-sim/preview.ts <candidate reward-policy.json> [--epochs 13]
 *
 * Re-runs the S1, S2 and S6 scenarios for the given number of epochs under the active V1 reward policy and under the
 * candidate, and prints the differences per checkpoint. When real epochs exist, the same comparison runs on their
 * frozen manifests (the engine is the same function); the control plane stores the sha256 of this report on the
 * PolicyActivation (previewSha256). Deterministic.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { COMPLETION_POLICY_V1, engineParamsFrom, REWARD_POLICY_V1, RewardPolicy } from "@waronsaas/contracts/protocol";
import { mulberry32, runScenario, SCENARIOS, SEED } from "./sim.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/tokenomics-sim/preview.ts <candidate reward-policy.json> [--epochs N]");
  process.exit(2);
}
const epochsArg = process.argv.indexOf("--epochs");
const epochs = epochsArg > 0 ? Number(process.argv[epochsArg + 1]) : 13;
const candidate = RewardPolicy.parse(JSON.parse(readFileSync(file, "utf8")));
const checkpoints = [1, Math.max(1, Math.floor(epochs / 2)), epochs];
const lines: string[] = [`Preview ${REWARD_POLICY_V1.policyVersion} -> ${candidate.policyVersion}, ${epochs} epochs, seed ${SEED}`, ""];
lines.push("| scenario | epoch | WOS/ACU now | WOS/ACU candidate | median WOS/week now | candidate | issued % now | candidate |");
lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const s of [SCENARIOS[0]!, SCENARIOS[1]!, SCENARIOS[5]!]) {
  const a = runScenario(s, engineParamsFrom(REWARD_POLICY_V1, COMPLETION_POLICY_V1), mulberry32(SEED), checkpoints);
  const b = runScenario(s, engineParamsFrom(candidate, COMPLETION_POLICY_V1), mulberry32(SEED), checkpoints);
  a.forEach((row, i) => {
    const c = b[i]!;
    lines.push(
      `| ${s.id} | ${row.epoch} | ${row.ratePerAcu.toFixed(2)} | ${c.ratePerAcu.toFixed(2)} | ${row.medianWeeklyWos.toFixed(0)} | ${c.medianWeeklyWos.toFixed(0)} | ${row.issuedPctOfMax}% | ${c.issuedPctOfMax}% |`,
    );
  });
}
const out = lines.join("\n");
console.log(out);
console.log(`\npreviewSha256: sha256:${createHash("sha256").update(out, "utf8").digest("hex")}`);
