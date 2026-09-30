/** Assembles wOS Web from the environment. */
import { createWebApp, type WebConfig } from "./app.js";

type Env = Readonly<Record<string, string | undefined>>;

export function webConfig(env: Env): WebConfig {
  const coreUrl = env.WOS_CORE_URL;
  if (!coreUrl) throw new Error("WOS_CORE_URL is required (where wOS Web reaches its wOS Core)");
  const publicUrl = env.WOS_WEB_PUBLIC_URL ?? "";
  return { coreUrl, sessionSecret: env.WOS_WEB_SESSION_SECRET ?? "", secureCookies: publicUrl.startsWith("https://") };
}

export function bootWeb(env: Env) {
  return createWebApp({
    config: webConfig(env),
    coreFetch: (i, init) => fetch(i, init),
    cloudFetch: (i, init) => fetch(i, init),
    now: () => new Date(),
  });
}
