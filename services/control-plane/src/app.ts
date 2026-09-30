/** Builds the control plane from its dependencies: every route of `{ ...Routes, ...AppRoutes }` bound to its handler. */
import postgres from "postgres";
import type { Hono } from "hono";
import { appKeysFromEnv } from "./domain/app-keys.js";
import { configFromEnv, consoleLogger, DEFAULT_LOGIC, type Deps, defaultPolicyAndSchedule, githubFromEnv, resendMailer } from "./deps.js";
import { accountHandlers } from "./handlers/account.js";
import { adminHandlers } from "./handlers/admin.js";
import { appHandlers } from "./handlers/apps.js";
import { publicHandlers } from "./handlers/public.js";
import { workHandlers } from "./handlers/work.js";
import { createApp, type Handlers } from "./http/router.js";

export function createHandlers(): Handlers {
  return { ...publicHandlers, ...accountHandlers, ...workHandlers, ...adminHandlers, ...appHandlers };
}

export function createControlPlane(deps: Deps): Hono {
  return createApp(deps, createHandlers());
}

/** Production wiring from Vercel environment variables (FOUNDER-CHECKLIST.md section 5). */
export function depsFromEnv(env: Readonly<Record<string, string | undefined>>): Deps {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("wOS control plane: DATABASE_URL is required (the wos_app role through the transaction pooler)");
  const log = consoleLogger();
  // prepare: false because the Supabase transaction pooler does not keep prepared statements.
  const sql = postgres(databaseUrl, { max: 5, prepare: false, onnotice: () => {}, idle_timeout: 20 });
  return {
    sql,
    config: configFromEnv(env),
    github: githubFromEnv(env),
    mailer: resendMailer(env, log),
    logic: DEFAULT_LOGIC,
    ...defaultPolicyAndSchedule(),
    // WOS_ENV_TOKEN_KEY[_NEXT], WOS_ENV_TOKEN_KID[_NEXT], WOS_MODULE_PUBLIC_KEYS (src/domain/app-keys.ts).
    appKeys: appKeysFromEnv(env),
    log,
  };
}
