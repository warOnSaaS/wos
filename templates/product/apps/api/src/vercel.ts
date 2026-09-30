/** Vercel function entry for wOS Cloud's Core (core.waronsaas.com): boots once per instance. */
import { Hono } from "hono";
import { bootCore } from "./boot.js";

let core: ReturnType<typeof bootCore> | null = null;
const app = new Hono();
app.all("*", async (c) => {
  core ??= bootCore(process.env).catch((err) => {
    core = null; // a failed boot is retried on the next request instead of being cached
    throw err;
  });
  return (await core).app.fetch(c.req.raw);
});
export default app;
