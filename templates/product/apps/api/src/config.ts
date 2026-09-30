/**
 * wOS Core configuration, from the environment. Two modes that never mix (S-41):
 *   cloud        wOS Cloud's hosted Core: trusts environment tokens from the control plane; WOS_APPS is refused.
 *   self_hosted  an operator's Core: local sign-in, WOS_APPS decides what is active; no wOS Cloud URL is read.
 */
import { HOSTS, WOS_CLOUD_ENVIRONMENT_ID } from "../../../modules/core-contracts/src/index.js";
import { parseWosApps } from "../../../modules/core/src/active-apps.js";
import type { Bundle } from "../../../modules/core/src/bundle.js";

export type CoreConfig = {
  mode: "cloud" | "self_hosted";
  /** The public base URL clients use (`EnvironmentDescriptor.apiBase`). */
  publicUrl: string;
  environmentName: string;
  /** cloud: fixed (WOS_ENVIRONMENT_ID, default wOS Cloud's id). self_hosted: null, read from the database. */
  environmentId: string | null;
  /** cloud only: where the environment keys are published and who issues tokens. */
  controlPlaneUrl: string | null;
  /** self_hosted only: WOS_APPS. */
  apps: string[];
  ownerEmail: string | null;
  allowedEmails: string[];
  organizationName: string;
  /** Pepper for sign-in codes and session tokens (WOS_CORE_SECRET, at least 32 characters). */
  secret: string;
  databaseUrl: string | null;
  port: number;
  migrateOnStart: boolean;
};

type Env = Readonly<Record<string, string | undefined>>;

const url = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is required`);
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} is not a URL`);
  }
};

export function loadConfig(env: Env, bundle: Bundle): CoreConfig {
  const mode = env.WOS_MODE ?? "self_hosted";
  if (mode !== "cloud" && mode !== "self_hosted") throw new Error("WOS_MODE must be cloud or self_hosted");
  const secret = env.WOS_CORE_SECRET ?? "";
  if (secret.length < 32) throw new Error("WOS_CORE_SECRET must be at least 32 characters");
  const base = {
    publicUrl: url("WOS_PUBLIC_URL", env.WOS_PUBLIC_URL),
    secret,
    databaseUrl: env.CORE_DATABASE_URL ?? null,
    port: Number(env.PORT ?? 8080),
    migrateOnStart: env.WOS_MIGRATE_ON_START === "true",
  };
  if (mode === "cloud") {
    if (env.WOS_APPS) throw new Error("WOS_APPS is for self-hosted Cores; wOS Cloud activates apps from environment tokens");
    return {
      ...base,
      mode,
      environmentName: env.WOS_ENVIRONMENT_NAME ?? "wOS Cloud",
      environmentId: env.WOS_ENVIRONMENT_ID ?? WOS_CLOUD_ENVIRONMENT_ID,
      controlPlaneUrl: url("WOS_CONTROL_PLANE_URL", env.WOS_CONTROL_PLANE_URL ?? HOSTS.api),
      apps: [],
      ownerEmail: null,
      allowedEmails: [],
      organizationName: "",
    };
  }
  if (env.WOS_CONTROL_PLANE_URL) throw new Error("WOS_CONTROL_PLANE_URL is for wOS Cloud; a self-hosted Core never calls warOnSaaS (S-41)");
  const ownerEmail = env.WOS_OWNER_EMAIL?.trim().toLowerCase() || null;
  const allowedEmails = (env.WOS_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!ownerEmail && allowedEmails.length === 0)
    throw new Error("set WOS_OWNER_EMAIL (and optionally WOS_ALLOWED_EMAILS) so sign-in is not open to anyone");
  return {
    ...base,
    mode,
    environmentName: env.WOS_ENVIRONMENT_NAME ?? "Self-hosted wOS",
    environmentId: null,
    controlPlaneUrl: null,
    apps: parseWosApps(env.WOS_APPS, bundle),
    ownerEmail,
    allowedEmails,
    organizationName: env.WOS_ORG_NAME ?? "Organization",
  };
}

/** Exact addresses or `*@example.com`. The owner is always allowed. */
export function emailAllowed(config: CoreConfig, email: string): boolean {
  if (email === config.ownerEmail) return true;
  return config.allowedEmails.some((p) => (p.startsWith("*@") ? email.endsWith(p.slice(1)) : p === email));
}
