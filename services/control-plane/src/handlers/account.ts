/**
 * Identity (D8): email magic link / code sign-in, rotating sessions, GitHub linking, the `me` routes.
 * SECURITY.md S-1..S-6. Auth handlers run as the `system` actor (sessions and sign-in requests are
 * system-only under RLS) and never log request bodies.
 */
import { DomainEvent, type Me, TargetSlug, WEB_APP_SIGNIN_CODE_PATH } from "@waronsaas/contracts";
import { devicePublicKeyFromBase64 } from "@waronsaas/contracts/canonical";
import { inTransaction, type Tx } from "@waronsaas/db";
import type { Deps, GithubUserIdentity } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { insertEvent } from "../db/events.js";
import type { Caller, Handlers, HandlerCtx } from "../http/router.js";
import { bumpRateLimit } from "../http/router.js";
import { ipHash, randomToken, sha256Hex, signinCode, tokenHash, uuidv7 } from "../util/crypto.js";
import { LIVE_ATTEMPT_STATES } from "../domain/work.js";
import { attemptView, isoReq, leaseView, loadMe, queryTasks, taskView, type AttemptRow, type LeaseRow, loadAttempt } from "../views.js";

export const SIGNIN_TTL_MINUTES = 15;
export const SIGNIN_MAX_ATTEMPTS = 5;
export const SIGNIN_LIMIT_PER_EMAIL_PER_HOUR = 5;
export const SIGNIN_LIMIT_PER_IP_PER_HOUR = 20;
export const ACCESS_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;
export const GITHUB_RESERVATION_DAYS = 90;

const SYSTEM = { kind: "system", accountId: null } as const;
const asAccount = (c: Caller) => ({ kind: "contributor" as const, accountId: c.accountId });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** web: the public site (cookies, S-5). desktop, cli, web_app (wOS Web's server, S-43): tokens in bodies. */
type ClientKind = "web" | "desktop" | "cli" | "web_app";

interface SessionTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

async function createSession(
  tx: Tx,
  deps: Deps,
  input: { accountId: string; deviceId: string | null; clientKind: ClientKind; familyId: string },
): Promise<SessionTokens> {
  const accessToken = `wos_at_${randomToken()}`;
  const refreshToken = `wos_rt_${randomToken()}`;
  const [row] = await tx<{ access_expires_at: Date; refresh_expires_at: Date }[]>`
    insert into wos.sessions (id, family_id, account_id, device_id, client_kind, access_token_hash, access_expires_at,
                              refresh_token_hash, refresh_expires_at)
    values (${uuidv7()}, ${input.familyId}, ${input.accountId}, ${input.deviceId}, ${input.clientKind},
            ${tokenHash(deps.config.tokenPepper, accessToken)}, now() + make_interval(secs => ${ACCESS_TTL_SECONDS}),
            ${tokenHash(deps.config.tokenPepper, refreshToken)}, now() + make_interval(secs => ${REFRESH_TTL_SECONDS}))
    returning access_expires_at, refresh_expires_at`;
  return {
    accessToken,
    accessExpiresAt: isoReq(row!.access_expires_at),
    refreshToken,
    refreshExpiresAt: isoReq(row!.refresh_expires_at),
  };
}

/**
 * S-5 (amended at 5.6.0): the web session travels in host-only HttpOnly cookies. The site cannot read `wos_csrf`, so
 * its value is returned for the response body's `csrfToken` and the site sends it back as X-wOS-Csrf.
 */
function setWebSessionCookies(ctx: HandlerCtx<"redeemEmailSignIn" | "refreshSession">, t: SessionTokens): string {
  const csrf = randomToken(24);
  ctx.setCookie({ name: "wos_session", value: t.accessToken, maxAgeSeconds: ACCESS_TTL_SECONDS });
  ctx.setCookie({ name: "wos_refresh", value: t.refreshToken, maxAgeSeconds: REFRESH_TTL_SECONDS, path: "/v1/auth" });
  ctx.setCookie({ name: "wos_csrf", value: csrf, maxAgeSeconds: REFRESH_TTL_SECONDS });
  return csrf;
}

async function revokeFamily(tx: Tx, familyId: string): Promise<void> {
  await tx`update wos.sessions set revoked_at = now() where family_id = ${familyId} and revoked_at is null`;
}

/** Revokes every session of an account (suspension, S-4). */
export async function revokeAllSessions(tx: Tx, accountId: string): Promise<void> {
  await tx`update wos.sessions set revoked_at = now() where account_id = ${accountId} and revoked_at is null`;
}

/** The emailed link: wOS Web's code page for web_app (S-43), the site's verify page for every other client. */
export function signinLink(deps: Deps, clientKind: ClientKind, requestId: string, linkToken: string): string {
  const q = new URLSearchParams({ r: requestId, t: linkToken });
  return clientKind === "web_app"
    ? `${deps.config.appOrigin}${WEB_APP_SIGNIN_CODE_PATH}?${q}`
    : `${deps.config.webOrigin}/auth/verify?${q}`;
}

function signinMail(deps: Deps, clientKind: ClientKind, requestId: string, linkToken: string, code: string) {
  const link = signinLink(deps, clientKind, requestId, linkToken);
  const where = clientKind === "web_app" ? "in the browser where you started signing in" : "on the device where you started signing in";
  const text = [
    "Sign in to warOnSaaS",
    "",
    `Open this link ${where}: ${link}`,
    "",
    `Or type this code: ${code}`,
    "",
    "The link and the code work once and expire in 15 minutes. If you did not ask to sign in, ignore this email.",
  ].join("\n");
  const html = `<p>Sign in to warOnSaaS</p><p><a href="${link}">Sign in</a> ${where}.</p><p>Or type this code: <strong>${code}</strong></p><p>The link and the code work once and expire in 15 minutes. If you did not ask to sign in, ignore this email.</p>`;
  return { subject: `Your warOnSaaS sign-in code: ${code}`, text, html };
}

/** Handle from the GitHub login, set once; a login recycled by GitHub gets a numeric suffix. */
async function pickHandle(tx: Tx, login: string): Promise<string> {
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? login : `${login.slice(0, 35)}-${n + 1}`;
    const [taken] = await tx`select 1 as x from wos.accounts where lower(handle) = lower(${candidate})`;
    if (!taken) return candidate;
  }
  return `u-${uuidv7().replace(/-/g, "").slice(0, 20)}`;
}

type LinkOutcome = { status: "linked" } | { status: "refused"; code: "GITHUB_LINKED_ELSEWHERE" | "GITHUB_RESERVED" };

/** One GitHub per account, one account per GitHub, 90-day reservation after unlink (S-6). */
async function linkIdentity(deps: Deps, accountId: string, linkRequestId: string, user: GithubUserIdentity): Promise<LinkOutcome> {
  const outcome = await inTransaction(deps.sql, { kind: "contributor", accountId }, async (tx): Promise<LinkOutcome> => {
    const [holder] = await tx<{ id: string }[]>`select id from wos.accounts where github_user_id = ${user.userId}`;
    if (holder && holder.id !== accountId) return { status: "refused", code: "GITHUB_LINKED_ELSEWHERE" };
    const [reservation] = await tx<{ account_id: string; active: boolean }[]>`
      select account_id, reserved_until > now() as active from wos.github_identity_history
       where github_user_id = ${user.userId} and action = 'unlinked' order by occurred_at desc limit 1`;
    if (reservation?.active && reservation.account_id !== accountId) return { status: "refused", code: "GITHUB_RESERVED" };
    const [me] = await tx<{ github_user_id: string | null; handle: string | null; row_version: number }[]>`
      select github_user_id, handle, row_version from wos.accounts where id = ${accountId}`;
    if (!me) throw new ApiFailure("NOT_FOUND", "account not found");
    if (me.github_user_id !== null && Number(me.github_user_id) !== user.userId)
      return { status: "refused", code: "GITHUB_LINKED_ELSEWHERE" };
    if (me.github_user_id === null) {
      const handle = me.handle ?? (await pickHandle(tx, user.login));
      const updated = await tx`
        update wos.accounts
           set github_user_id = ${user.userId}, github_login = ${user.login}, github_created_at = ${user.createdAt},
               github_linked_at = now(), avatar_url = ${user.avatarUrl}, handle = ${handle}, row_version = row_version + 1
         where id = ${accountId} and github_user_id is null and row_version = ${me.row_version}
        returning id`;
      if (updated.length === 0) throw new ApiFailure("CONFLICT", "account changed concurrently");
      await tx`insert into wos.github_identity_history (id, account_id, github_user_id, github_login, action)
               values (${uuidv7()}, ${accountId}, ${user.userId}, ${user.login}, 'linked')`;
      await insertEvent(
        tx,
        { type: "account.github_linked", v: 1, visibility: "public", payload: { accountId, handle, githubUserId: user.userId } },
        { aggregateKind: "account", aggregateId: accountId, actor: "contributor", actorAccountId: accountId },
      );
    }
    await tx`update wos.github_link_requests set state = 'linked', completed_at = now(), device_code = case when flow = 'device' then 'done' else device_code end
              where id = ${linkRequestId}`;
    return { status: "linked" };
  });
  if (outcome.status === "refused") {
    await inTransaction(
      deps.sql,
      { kind: "contributor", accountId },
      (tx) =>
        tx`update wos.github_link_requests set state = 'refused', refusal = ${outcome.code}, completed_at = now() where id = ${linkRequestId}`,
    );
  }
  return outcome;
}

export const accountHandlers: Pick<
  Handlers,
  | "startEmailSignIn"
  | "redeemEmailSignIn"
  | "refreshSession"
  | "logout"
  | "startGithubLink"
  | "pollGithubLink"
  | "githubOAuthCallback"
  | "unlinkGithub"
  | "getMe"
  | "updateMe"
  | "postAttestation"
  | "getMyWork"
  | "listMyEvents"
> = {
  // S-1, S-3: same response whether or not the email has an account (accounts are created on first redeem).
  async startEmailSignIn(ctx) {
    const { deps, body } = ctx;
    const email = normalizeEmail(body.email);
    // web_app registers no device (S-43: wOS Web's server is not a contributor machine; the ruling says null).
    if (body.clientKind === "web_app" && body.devicePublicKey !== null)
      throw new ApiFailure("VALIDATION_FAILED", "web_app sign-in takes no devicePublicKey");
    if ((body.clientKind === "desktop" || body.clientKind === "cli") && body.devicePublicKey !== null) {
      // Device keys are base64 of the raw 32 Ed25519 bytes only (canonical.ts C-5).
      try {
        devicePublicKeyFromBase64(body.devicePublicKey);
      } catch {
        throw new ApiFailure("VALIDATION_FAILED", "devicePublicKey must be base64 of the raw 32-byte Ed25519 public key");
      }
    }
    const now = new Date();
    const perEmail = await bumpRateLimit(deps, `signin:email:${sha256Hex(email)}`, "hour");
    const perIp = await bumpRateLimit(deps, `signin:ip:${ipHash(deps.config.ipHashSecret, ctx.ip, now).toString("hex")}`, "hour");
    if (perEmail > SIGNIN_LIMIT_PER_EMAIL_PER_HOUR || perIp > SIGNIN_LIMIT_PER_IP_PER_HOUR) {
      throw new ApiFailure("RATE_LIMITED", "too many sign-in requests; try again later");
    }
    const requestId = uuidv7();
    const linkToken = randomToken();
    const pollSecret = randomToken();
    const code = signinCode();
    const pepper = deps.config.tokenPepper;
    const expiresAt = await inTransaction(deps.sql, SYSTEM, async (tx) => {
      const [row] = await tx<{ expires_at: Date }[]>`
        insert into wos.email_signin_requests (id, email_normalized, client_kind, device_name, device_public_key, link_token_hash,
                                               code_hash, poll_secret_hash, ip_hash, expires_at)
        values (${requestId}, ${email}, ${body.clientKind}, ${body.deviceName}, ${body.clientKind === "desktop" || body.clientKind === "cli" ? body.devicePublicKey : null},
                ${tokenHash(pepper, linkToken)}, ${tokenHash(pepper, `${requestId}${code}`)}, ${tokenHash(pepper, pollSecret)},
                ${ipHash(deps.config.ipHashSecret, ctx.ip, now)}, now() + make_interval(mins => ${SIGNIN_TTL_MINUTES}))
        returning expires_at`;
      return isoReq(row!.expires_at);
    });
    const mail = signinMail(deps, body.clientKind, requestId, linkToken, code);
    let status: "sent" | "failed" = "sent";
    let providerId: string | null = null;
    try {
      providerId = (await deps.mailer.send({ template: "signin", to: body.email.trim(), ...mail })).providerId;
    } catch (err) {
      status = "failed";
      deps.log("warn", "sign-in email failed", { requestId, error: err instanceof Error ? err.message : String(err) });
    }
    await inTransaction(
      deps.sql,
      SYSTEM,
      (tx) =>
        tx`insert into wos.outbound_emails (id, template, to_hash, provider_id, status, sent_at)
         values (${uuidv7()}, 'signin', ${Buffer.from(sha256Hex(email), "hex")}, ${providerId}, ${status}, ${status === "sent" ? new Date() : null})`,
    );
    ctx.status = 202;
    if (body.clientKind === "web") {
      ctx.setCookie({ name: "wos_signin", value: pollSecret, maxAgeSeconds: SIGNIN_TTL_MINUTES * 60, path: "/v1/auth" });
      return { requestId, pollSecret: null, expiresAt };
    }
    return { requestId, pollSecret, expiresAt };
  },

  // S-1 single use / 15 min / 5 tries; S-2 poll-secret binding.
  async redeemEmailSignIn(ctx) {
    const { deps, body } = ctx;
    if ((body.linkToken === null) === (body.code === null))
      throw new ApiFailure("VALIDATION_FAILED", "send exactly one of linkToken or code");
    const pollSecret = body.pollSecret ?? ctx.cookie("wos_signin") ?? null;
    const pepper = deps.config.tokenPepper;
    const pollHash = pollSecret ? tokenHash(pepper, pollSecret) : Buffer.alloc(32);
    const linkHash = body.linkToken ? tokenHash(pepper, body.linkToken) : null;
    const codeHash = body.code ? tokenHash(pepper, `${body.requestId}${body.code}`) : null;
    const denied = () =>
      new ApiFailure("UNAUTHENTICATED", "that sign-in link or code is not valid (it may be used, expired or for another device)");

    let result: {
      tokens: SessionTokens;
      accountId: string;
      deviceId: string | null;
      created: boolean;
      clientKind: ClientKind;
    } | null = null;
    try {
      result = await inTransaction(deps.sql, SYSTEM, async (tx) => {
        const [req] = await tx<
          {
            email_normalized: string;
            client_kind: ClientKind;
            device_name: string | null;
            device_public_key: string | null;
          }[]
        >`
          select email_normalized, client_kind, device_name, device_public_key from wos.email_signin_requests
           where id = ${body.requestId} and redeemed_at is null and expires_at > now() and attempts < ${SIGNIN_MAX_ATTEMPTS}
             and poll_secret_hash = ${pollHash}
             and ${linkHash ? tx`link_token_hash = ${linkHash}` : tx`code_hash = ${codeHash!}`}`;
        if (!req) throw denied();
        let created = false;
        let [acct] = await tx<
          { account_id: string }[]
        >`select account_id from wos.account_emails where email_normalized = ${req.email_normalized}`;
        if (!acct) {
          const id = uuidv7();
          await tx`insert into wos.accounts (id) values (${id})`;
          await tx`insert into wos.account_emails (account_id, email, email_normalized, verified_at)
                   values (${id}, ${req.email_normalized}, ${req.email_normalized}, now())`;
          await insertEvent(
            tx,
            { type: "account.created", v: 1, visibility: "private", payload: { accountId: id } },
            { aggregateKind: "account", aggregateId: id, actor: "system", actorAccountId: null },
          );
          acct = { account_id: id };
          created = true;
        }
        const [st] = await tx<{ status: string }[]>`select status from wos.accounts where id = ${acct.account_id}`;
        if (st?.status !== "active") throw denied();
        // The single-use point: one guarded UPDATE (S-1).
        const redeemed = await tx`
          update wos.email_signin_requests set redeemed_at = now(), redeemed_account_id = ${acct.account_id}
           where id = ${body.requestId} and redeemed_at is null and expires_at > now() and attempts < ${SIGNIN_MAX_ATTEMPTS}
          returning id`;
        if (redeemed.length === 0) throw denied();
        let deviceId: string | null = null;
        if ((req.client_kind === "desktop" || req.client_kind === "cli") && req.device_public_key) {
          const [existing] = await tx<{ id: string; account_id: string; revoked_at: Date | null }[]>`
            select id, account_id, revoked_at from wos.devices where public_key = ${req.device_public_key}`;
          if (existing) {
            if (existing.account_id !== acct.account_id || existing.revoked_at) throw denied();
            deviceId = existing.id;
          } else {
            deviceId = uuidv7();
            await tx`insert into wos.devices (id, account_id, name, client_kind, public_key)
                     values (${deviceId}, ${acct.account_id}, ${(req.device_name ?? req.client_kind).slice(0, 100)}, ${req.client_kind}, ${req.device_public_key})`;
          }
        }
        const tokens = await createSession(tx, deps, {
          accountId: acct.account_id,
          deviceId,
          clientKind: req.client_kind,
          familyId: uuidv7(),
        });
        return { tokens, accountId: acct.account_id, deviceId, created, clientKind: req.client_kind };
      });
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "UNAUTHENTICATED") {
        // Every failed try counts; the fifth kills the request (S-1).
        await inTransaction(
          deps.sql,
          SYSTEM,
          (tx) =>
            tx`update wos.email_signin_requests set attempts = attempts + 1
              where id = ${body.requestId} and redeemed_at is null and attempts < ${SIGNIN_MAX_ATTEMPTS}`,
        );
      }
      throw err;
    }
    const me = await inTransaction(deps.sql, { kind: "contributor", accountId: result.accountId }, (tx) => loadMe(tx, result!.accountId));
    if (result.clientKind === "web") {
      const csrfToken = setWebSessionCookies(ctx, result.tokens);
      ctx.setCookie({ name: "wos_signin", value: "", maxAgeSeconds: 0, path: "/v1/auth" });
      return {
        accessToken: "",
        accessExpiresAt: result.tokens.accessExpiresAt,
        refreshToken: "",
        refreshExpiresAt: result.tokens.refreshExpiresAt,
        deviceId: null,
        created: result.created,
        me,
        csrfToken,
      };
    }
    return { ...result.tokens, deviceId: result.deviceId, created: result.created, me };
  },

  // S-4: rotating refresh; a rotated token presented again revokes the whole family.
  async refreshSession(ctx) {
    const { deps } = ctx;
    const fromCookie = ctx.body.refreshToken === "" ? (ctx.cookie("wos_refresh") ?? "") : null;
    const token = fromCookie ?? ctx.body.refreshToken;
    if (!token) throw new ApiFailure("UNAUTHENTICATED", "refresh token required");
    const hash = tokenHash(deps.config.tokenPepper, token);
    const outcome = await inTransaction(deps.sql, SYSTEM, async (tx) => {
      const [s] = await tx<
        {
          id: string;
          family_id: string;
          account_id: string;
          device_id: string | null;
          client_kind: ClientKind;
          rotated: boolean;
          revoked: boolean;
          live: boolean;
          status: string;
        }[]
      >`
        select s.id, s.family_id, s.account_id, s.device_id, s.client_kind, s.rotated_at is not null as rotated,
               s.revoked_at is not null as revoked, s.refresh_expires_at > now() as live, a.status
          from wos.sessions s join wos.accounts a on a.id = s.account_id where s.refresh_token_hash = ${hash}`;
      if (!s || s.revoked || !s.live || s.status !== "active") return { ok: false as const, revokeFamily: null };
      if (s.rotated) return { ok: false as const, revokeFamily: s.family_id };
      const rotated =
        await tx`update wos.sessions set rotated_at = now() where id = ${s.id} and rotated_at is null and revoked_at is null returning id`;
      if (rotated.length === 0) return { ok: false as const, revokeFamily: s.family_id };
      const tokens = await createSession(tx, deps, {
        accountId: s.account_id,
        deviceId: s.device_id,
        clientKind: s.client_kind,
        familyId: s.family_id,
      });
      return { ok: true as const, tokens, web: s.client_kind === "web" };
    });
    if (!outcome.ok) {
      if (outcome.revokeFamily) {
        const family = outcome.revokeFamily;
        await inTransaction(deps.sql, SYSTEM, (tx) => revokeFamily(tx, family));
        deps.log("warn", "rotated refresh token reused: session family revoked", { familyId: family });
      }
      throw new ApiFailure("UNAUTHENTICATED", "refresh token is not valid; sign in again");
    }
    if (outcome.web) {
      const csrfToken = setWebSessionCookies(ctx, outcome.tokens);
      return {
        accessToken: "",
        accessExpiresAt: outcome.tokens.accessExpiresAt,
        refreshToken: "",
        refreshExpiresAt: outcome.tokens.refreshExpiresAt,
        csrfToken,
      };
    }
    return outcome.tokens;
  },

  async logout(ctx) {
    const caller = ctx.caller!;
    await inTransaction(ctx.deps.sql, SYSTEM, (tx) => revokeFamily(tx, caller.familyId));
    if (caller.viaCookie) {
      ctx.setCookie({ name: "wos_session", value: "", maxAgeSeconds: 0 });
      ctx.setCookie({ name: "wos_refresh", value: "", maxAgeSeconds: 0, path: "/v1/auth" });
      ctx.setCookie({ name: "wos_csrf", value: "", maxAgeSeconds: 0 });
    }
    return { ok: true as const };
  },

  async startGithubLink(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    if (caller.githubUserId !== null) throw new ApiFailure("CONFLICT", "a GitHub account is already linked; unlink it first");
    const linkId = uuidv7();
    if (ctx.body.flow === "device") {
      const flow = await deps.github.startDeviceAuthorization();
      const expiresAt = await inTransaction(deps.sql, asAccount(caller), async (tx) => {
        const [r] = await tx<{ expires_at: Date }[]>`
          insert into wos.github_link_requests (id, account_id, flow, device_code, expires_at)
          values (${linkId}, ${caller.accountId}, 'device', ${flow.deviceCode}, now() + make_interval(secs => ${Math.min(flow.expiresInSeconds, 900)}))
          returning expires_at`;
        return isoReq(r!.expires_at);
      });
      return {
        flow: "device" as const,
        linkId,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        intervalSeconds: flow.intervalSeconds,
        expiresAt,
      };
    }
    const state = randomToken();
    const expiresAt = await inTransaction(deps.sql, asAccount(caller), async (tx) => {
      const [r] = await tx<{ expires_at: Date }[]>`
        insert into wos.github_link_requests (id, account_id, flow, state_hash, expires_at)
        values (${linkId}, ${caller.accountId}, 'web', ${tokenHash(deps.config.tokenPepper, state)}, now() + interval '10 minutes')
        returning expires_at`;
      return isoReq(r!.expires_at);
    });
    const authorizeUrl = deps.github.webAuthorizeUrl({ state, redirectUri: `${deps.config.apiOrigin}/v1/github/oauth/callback` });
    return { flow: "web" as const, linkId, authorizeUrl, expiresAt };
  },

  async pollGithubLink(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const [req] = await inTransaction(
      deps.sql,
      asAccount(caller),
      (tx) =>
        tx<{ id: string; flow: string; device_code: string | null; state: string; refusal: string | null; live: boolean }[]>`
        select id, flow, device_code, state, refusal, expires_at > now() as live
          from wos.github_link_requests where id = ${ctx.body.linkId} and account_id = ${caller.accountId}`,
    );
    if (!req) throw new ApiFailure("NOT_FOUND", "link request not found");
    const me = () => inTransaction(deps.sql, asAccount(caller), (tx) => loadMe(tx, caller.accountId));
    if (req.state === "linked") return { status: "linked" as const, me: await me() };
    if (req.state === "refused")
      throw new ApiFailure(req.refusal as "GITHUB_RESERVED", "this GitHub account cannot be linked to this account");
    if (req.state === "denied") return { status: "denied" as const };
    if (req.state === "expired") return { status: "expired" as const };
    if (!req.live || req.flow !== "device" || !req.device_code) {
      if (!req.live) {
        await inTransaction(
          deps.sql,
          asAccount(caller),
          (tx) =>
            tx`update wos.github_link_requests set state = 'expired', completed_at = now() where id = ${req.id} and state = 'pending'`,
        );
        return { status: "expired" as const };
      }
      return { status: "pending" as const };
    }
    const exchanged = await deps.github.exchangeUserAuthorization({ deviceCode: req.device_code });
    if (exchanged.status !== "ok") {
      if (exchanged.status === "pending") return { status: "pending" as const };
      const status = exchanged.status;
      await inTransaction(
        deps.sql,
        asAccount(caller),
        (tx) => tx`update wos.github_link_requests set state = ${status}, completed_at = now() where id = ${req.id} and state = 'pending'`,
      );
      return { status };
    }
    const outcome = await linkIdentity(deps, caller.accountId, req.id, exchanged.user);
    if (outcome.status === "refused") throw new ApiFailure(outcome.code, "this GitHub account cannot be linked to this account");
    return { status: "linked" as const, me: await me() };
  },

  async githubOAuthCallback(ctx) {
    const { deps } = ctx;
    const done = (result: "linked" | "refused") => {
      const redirectTo = `${deps.config.webOrigin}/account?github=${result}`;
      ctx.redirectTo = redirectTo;
      return { redirectTo };
    };
    const [req] = await inTransaction(
      deps.sql,
      SYSTEM,
      (tx) =>
        tx<{ id: string; account_id: string; state: string; live: boolean }[]>`
        select id, account_id, state, expires_at > now() as live from wos.github_link_requests
         where flow = 'web' and state_hash = ${tokenHash(deps.config.tokenPepper, ctx.query.state)}`,
    );
    if (!req) throw new ApiFailure("NOT_FOUND", "unknown or used OAuth state");
    if (req.state !== "pending" || !req.live || ctx.query.error || !ctx.query.code) {
      await inTransaction(
        deps.sql,
        SYSTEM,
        (tx) =>
          tx`update wos.github_link_requests set state = ${req.live ? "denied" : "expired"}, completed_at = now() where id = ${req.id} and state = 'pending'`,
      );
      return done("refused");
    }
    const exchanged = await deps.github.exchangeUserAuthorization({
      code: ctx.query.code,
      redirectUri: `${deps.config.apiOrigin}/v1/github/oauth/callback`,
    });
    if (exchanged.status !== "ok") {
      await inTransaction(
        deps.sql,
        SYSTEM,
        (tx) => tx`update wos.github_link_requests set state = 'denied', completed_at = now() where id = ${req.id} and state = 'pending'`,
      );
      return done("refused");
    }
    const outcome = await linkIdentity(deps, req.account_id, req.id, exchanged.user);
    return done(outcome.status === "linked" ? "linked" : "refused");
  },

  // S-6: refused while the account holds an active lease, a live attempt or a sealed review; 90-day reservation.
  async unlinkGithub(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, asAccount(caller), async (tx) => {
      const [busy] = await tx<{ leases: number; attempts: number; sealed: number }[]>`
        select (select count(*)::int from wos.leases where account_id = ${caller.accountId} and state = 'active') as leases,
               (select count(*)::int from wos.attempts where account_id = ${caller.accountId} and state in ${tx(LIVE_ATTEMPT_STATES as string[])}) as attempts,
               (select count(*)::int from wos.reviews v join wos.rounds r on r.id = v.round_id
                 where v.account_id = ${caller.accountId} and r.state = 'awaiting_reviews') as sealed`;
      if (busy!.leases + busy!.attempts + busy!.sealed > 0) {
        throw new ApiFailure("CONFLICT", "finish or release your active leases, attempts and sealed reviews before unlinking GitHub", busy);
      }
      const [a] = await tx<{ github_user_id: string | null; github_login: string | null; row_version: number }[]>`
        select github_user_id, github_login, row_version from wos.accounts where id = ${caller.accountId}`;
      if (a?.github_user_id == null) throw new ApiFailure("CONFLICT", "no GitHub account is linked");
      const updated = await tx`
        update wos.accounts set github_user_id = null, github_login = null, github_created_at = null, github_linked_at = null,
               row_version = row_version + 1
         where id = ${caller.accountId} and row_version = ${a.row_version} returning id`;
      if (updated.length === 0) throw new ApiFailure("CONFLICT", "account changed concurrently");
      await tx`insert into wos.github_identity_history (id, account_id, github_user_id, github_login, action, reserved_until)
               values (${uuidv7()}, ${caller.accountId}, ${a.github_user_id}, ${a.github_login}, 'unlinked',
                       now() + make_interval(days => ${GITHUB_RESERVATION_DAYS}))`;
      await insertEvent(
        tx,
        {
          type: "account.github_unlinked",
          v: 1,
          visibility: "private",
          payload: { accountId: caller.accountId, githubUserId: Number(a.github_user_id) },
        },
        { aggregateKind: "account", aggregateId: caller.accountId, actor: "contributor", actorAccountId: caller.accountId },
      );
      return loadMe(tx, caller.accountId);
    });
  },

  async getMe(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, asAccount(caller), (tx) => loadMe(tx, caller.accountId));
  },

  async updateMe(ctx) {
    const caller = ctx.caller!;
    const b = ctx.body;
    return inTransaction(ctx.deps.sql, asAccount(caller), async (tx): Promise<Me> => {
      const set: Record<string, unknown> = {};
      if (b.displayName !== undefined) set.display_name = b.displayName;
      if (b.leaderboardOptIn !== undefined) set.leaderboard_opt_in = b.leaderboardOptIn;
      if (b.progressEmails !== undefined) set.progress_emails = b.progressEmails;
      if (Object.keys(set).length > 0) {
        await tx`update wos.accounts set ${tx(set as Record<string, string>)}, row_version = row_version + 1 where id = ${caller.accountId}`;
      }
      if (b.followedTargets !== undefined) {
        const slugs = [...new Set(b.followedTargets.map((s) => TargetSlug.parse(s)))];
        const targets = slugs.length ? await tx<{ id: string }[]>`select id from wos.targets where slug in ${tx(slugs)}` : [];
        if (targets.length !== slugs.length) throw new ApiFailure("VALIDATION_FAILED", "unknown target in followedTargets");
        await tx`delete from wos.follows where account_id = ${caller.accountId}`;
        for (const t of targets) await tx`insert into wos.follows (account_id, target_id) values (${caller.accountId}, ${t.id})`;
      }
      return loadMe(tx, caller.accountId);
    });
  },

  async postAttestation(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, asAccount(caller), async (tx) => {
      const [d] =
        await tx`select id from wos.devices where id = ${ctx.body.deviceId} and account_id = ${caller.accountId} and revoked_at is null`;
      if (!d) throw new ApiFailure("FORBIDDEN", "unknown or revoked device");
      for (const p of ctx.body.providers) {
        await tx`insert into wos.provider_attestations (id, account_id, device_id, provider, installed, cli_version, signed_in, auth_method, models, checked_at)
                 values (${uuidv7()}, ${caller.accountId}, ${ctx.body.deviceId}, ${p.provider}, ${p.installed}, ${p.cliVersion}, ${p.signedIn},
                         ${p.authMethod}, ${p.models as string[]}, ${p.checkedAt})`;
      }
      const t = ctx.body.toolchain;
      if (t) {
        // D13: the device's toolchain, matched against path-based toolchainRequirements at claim time.
        await tx`insert into wos.toolchain_attestations (id, account_id, device_id, os, os_version, tools, checked_at)
                 values (${uuidv7()}, ${caller.accountId}, ${ctx.body.deviceId}, ${t.os}, ${t.osVersion}, ${tx.json(t.tools as never)}, ${t.checkedAt})`;
      }
      return loadMe(tx, caller.accountId);
    });
  },

  async getMyWork(ctx) {
    const caller = ctx.caller!;
    const { deps } = ctx;
    return inTransaction(deps.sql, asAccount(caller), async (tx) => {
      const leases = await tx<
        LeaseRow[]
      >`select * from wos.leases where account_id = ${caller.accountId} and state = 'active' order by issued_at`;
      const tasks = await queryTasks(
        tx,
        `where t.id in (select task_id from wos.leases where account_id = $1 and state = 'active')
            or (t.restricted_to_account_id = $1 and t.state = 'open') order by t.created_at`,
        [caller.accountId],
      );
      const attemptIds = await tx<{ id: string }[]>`
        select id from wos.attempts where account_id = ${caller.accountId} and state in ${tx(LIVE_ATTEMPT_STATES as string[])} order by created_at`;
      const attempts: AttemptRow[] = [];
      for (const a of attemptIds) {
        const row = await loadAttempt(tx, a.id);
        if (row) attempts.push(row);
      }
      return { leases: leases.map((l) => leaseView(l, deps.policy)), tasks: tasks.map(taskView), attempts: attempts.map(attemptView) };
    });
  },

  async listMyEvents(ctx) {
    const caller = ctx.caller!;
    const after = ctx.query.after ?? 0;
    return inTransaction(ctx.deps.sql, asAccount(caller), async (tx) => {
      const rows = await tx<
        {
          id: string;
          type: string;
          v: number;
          visibility: string;
          aggregate_kind: string;
          aggregate_id: string;
          actor_account_id: string | null;
          actor_kind: string;
          payload: unknown;
          contracts_version: string;
          occurred_at: Date;
        }[]
      >`
        select e.* from wos.events e
         where e.id > ${after}
           and (e.actor_account_id = ${caller.accountId}
             or (e.aggregate_kind = 'account' and e.aggregate_id = ${caller.accountId})
             or (e.aggregate_kind = 'lease' and e.aggregate_id in (select id::text from wos.leases where account_id = ${caller.accountId}))
             or (e.aggregate_kind = 'task' and e.aggregate_id in (select task_id::text from wos.leases where account_id = ${caller.accountId}))
             or (e.aggregate_kind = 'attempt' and e.aggregate_id in (select id::text from wos.attempts where account_id = ${caller.accountId})))
         order by e.id limit 200`;
      const items = rows.flatMap((r) => {
        const parsed = DomainEvent.safeParse(eventWire(r));
        return parsed.success ? [parsed.data] : [];
      });
      const lastId = rows.length ? Number(rows[rows.length - 1]!.id) : after;
      return { items, lastId };
    });
  },
};

/** A wos.events row as the wire `DomainEvent`. */
export function eventWire(r: {
  id: string | number;
  type: string;
  v: number;
  visibility: string;
  aggregate_kind: string;
  aggregate_id: string;
  actor_account_id: string | null;
  actor_kind: string;
  payload: unknown;
  contracts_version: string;
  occurred_at: Date;
}) {
  return {
    id: Number(r.id),
    occurredAt: isoReq(r.occurred_at),
    actorAccountId: r.actor_account_id,
    actorKind: r.actor_kind,
    aggregateKind: r.aggregate_kind,
    aggregateId: r.aggregate_id,
    contractsVersion: r.contracts_version,
    type: r.type,
    v: r.v,
    visibility: r.visibility,
    payload: r.payload,
  };
}
