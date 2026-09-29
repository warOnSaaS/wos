/**
 * wOS control plane (owner: control-plane workstream). Hono app deployed as Vercel project
 * `waronsaas-api` (region pdx1, Node runtime). Routes are defined by `Routes` in @waronsaas/contracts
 * and served by ./app.ts; dependencies are wired from the environment on first request.
 */
import { Hono } from "hono";
import { createControlPlane, depsFromEnv } from "./app.js";

let inner: Hono | null = null;
const app = new Hono();
app.all("*", (c) => {
  inner ??= createControlPlane(depsFromEnv(process.env));
  return inner.fetch(c.req.raw);
});

export default app;
export { createControlPlane, createHandlers, depsFromEnv } from "./app.js";
