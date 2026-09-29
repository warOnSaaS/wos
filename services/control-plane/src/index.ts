/**
 * wOS control plane (owner: control-plane workstream). Hono app deployed as Vercel project
 * `waronsaas-api` (region pdx1, Node runtime). Routes are defined by `Routes` in @waronsaas/contracts;
 * this file only wires the health check in Phase 0.
 */
import { Hono } from "hono";
import { CONTRACTS_VERSION, AGENT_POLICY_V1 } from "@waronsaas/contracts";

const app = new Hono();

app.get("/v1/health", (c) => c.json({ ok: true, contractsVersion: CONTRACTS_VERSION, policyVersion: AGENT_POLICY_V1.policyVersion }));

export default app;
