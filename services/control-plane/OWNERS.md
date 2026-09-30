# control-plane

- **Owner:** control-plane workstream (spec Agent 1)
- **Purpose:** The wOS API on Vercel (Hono): auth, targets, roadmaps, catalog, contracts, ABUs, tasks, leases, rounds, progress, contributions, webhooks, cron.
- **Contracts:** consumes `@waronsaas/contracts` 1.0.0 (implements Routes exactly); changes to shared contracts go through an ARCHITECTURE_BLOCKER (`docs/architecture/WORKSTREAMS.md` section 4).
- **Done means:** the DONE list for this workstream in `docs/architecture/WORKSTREAMS.md`.

## Wave 3a (Amendment 01): environment variables on `waronsaas-api`

`AppRoutes` are served beside `Routes`. The keys below are read by `src/domain/app-keys.ts`; the coordinator provisions them in Vercel. Never commit or print their values.

| Variable | Required | Value |
|---|---|---|
| `WOS_ENV_TOKEN_KEY` | yes, for `issueEnvironmentToken` | Ed25519 private key that signs environment tokens (C-8): the PKCS#8 PEM from `openssl genpkey -algorithm ed25519` (literal newlines or `\n` escapes), or the standard base64 of the raw 32-byte seed. Without it the route answers 500 and `/v1/public/environment-keys` lists no current key. |
| `WOS_ENV_TOKEN_KID` | no (default `wos-env-2026`) | Key id of the current key, `wos-env-NNNN[-suffix]`. |
| `WOS_ENV_TOKEN_KEY_NEXT` | no, recommended | The rotation successor, same format. Only its public half is published; it never signs. |
| `WOS_ENV_TOKEN_KID_NEXT` | no (default `wos-env-2026-next`) | Key id of the next key; must differ from the current one. |
| `WOS_MODULE_PUBLIC_KEYS` | yes, to publish desktop packages | JSON object: module-signing key id -> PUBLIC key (standard base64 of the raw 32 bytes, or SPKI PEM), e.g. `{"wos-module-2026":"…","wos-module-2026-next":"…"}`: the same keys Desktop pins (S-37). `publishAppRelease` re-verifies every package against them. |

Rotation of the environment-token key: publish the new key as `_NEXT` for at least 16 minutes (token lifetime plus skew) so hosted Core has fetched it, then move it to `WOS_ENV_TOKEN_KEY`/`_KID` and put a fresh key in `_NEXT`.

The test harness generates throwaway keys per run (`testKeys()` in `src/testing/harness.ts`) and enables Build on every personal organization it creates (`HarnessOptions.buildForEveryAccount`, default true), as migration 0006 did for every pre-0006 account.
