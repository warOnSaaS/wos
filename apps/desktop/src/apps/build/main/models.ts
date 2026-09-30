/**
 * D15 model picker: builder models = the policy's builder `allowedModels` (opus, astra, sol) that this
 * device has attested (LocalStatus.providers: installed AND signed in AND listing the model). The
 * default is the first attested entry of allowedModels (contracts 4.3.0, B-0010-github-build).
 */
import type { AgentPolicyDocument, LocalStatus, ModelRef } from "@waronsaas/contracts";
import type { BuilderModelChoice } from "../shared/ipc.js";

const LABELS: Record<ModelRef, string> = { opus: "OPUS", astra: "ASTRA", sol: "SOL", fable: "FABLE" };
const CLI: Record<string, string> = { claude_cli: "claude", codex_cli: "codex" };

export function builderModelChoices(policy: AgentPolicyDocument, status: LocalStatus | null): BuilderModelChoice[] {
  const role = policy.roles.find((r) => r.role === "builder");
  if (!role) return [];
  const choices: BuilderModelChoice[] = role.allowedModels.map((ref) => {
    const spec = policy.models.find((m) => m.ref === ref)!;
    const cli = CLI[spec.provider] ?? spec.provider;
    const p = status?.providers.find((x) => x.provider === spec.provider);
    let reason: string | null = null;
    if (!status) reason = "RUN STATUS FIRST: this device has not attested its CLIs yet.";
    else if (!p?.installed) reason = `${cli} IS NOT INSTALLED on this device.`;
    else if (!p.signedIn) reason = `${cli} IS NOT SIGNED IN on this device.`;
    else if (!p.models.includes(ref)) reason = `${cli} on this device does not offer ${LABELS[ref]}.`;
    return {
      ref,
      label: LABELS[ref],
      modelId: spec.modelId,
      provider: spec.provider,
      cli,
      available: reason === null,
      reason,
      isDefault: false,
    };
  });
  const first = choices.find((c) => c.available);
  if (first) first.isDefault = true;
  return choices;
}
