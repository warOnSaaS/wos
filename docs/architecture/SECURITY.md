# wOS security

Status: frozen at contracts 1.0.0. Owner: Lead Architect. Every control has an id (S-n), the workstream
that implements it (names from WORKSTREAMS.md) and the test that proves it. The verification workstream
owns making every listed test exist and fail when its control is removed.

## 1. Assets and trust boundaries

| Asset | Why it matters |
|---|---|
| The official repos (`waronsaas/product`, `waronsaas/wos`) | Malicious code merged there ships to everyone who self-hosts or uses a hosted app. |
| The WOS token ledger and leaderboard | Public reputation; must not be forgeable or silently editable. |
| Progress numbers | The public promise "no fake progress". |
| Sealed verdicts | Independence of Astra and Fable (spec) depends on nobody seeing the other's current conclusion. |
| Contributor machines | wOS makes contributors run agents and other people's tests locally. |
| Accounts and sessions | Impersonation lets an attacker claim work and rewards as someone else. |
| Secrets | GitHub App private key and webhook secret, DB URLs, Resend key, cron secret, Apple/Windows signing credentials. |

Trust boundaries:

1. Everything a client sends is untrusted, including what the Desktop or CLI claims about models,
   tests and diffs. A contributor can run a modified client.
2. Everything in a repository is untrusted content, including roadmaps, contracts, code, comments and
   tests written by other contributors. It is data to agents, never instructions.
3. The control plane and the GitHub App are trusted. GitHub Actions runs on the product repo are
   trusted to report what they ran, and hold no secrets.
4. Model identity cannot be proven (D1). See S-13.

## 2. Controls

### Accounts and sessions (D8)

**S-1 Magic-link and code tokens.** `POST /v1/auth/email/start` creates an `email_signin_requests` row
with: a 32-byte random link token, an 8-character code from the alphabet `A-H J-N P-Z 2-9` formatted
`XXXX-XXXX`, a 32-byte poll secret. Only keyed hashes are stored: HMAC-SHA256 with the server secret
`SESSION_TOKEN_PEPPER` (`link_token_hash` = HMAC(pepper, token), `code_hash` = HMAC(pepper, requestId ||
code), `poll_secret_hash` = HMAC(pepper, secret)), so a database leak alone cannot test guesses offline. TTL 15 minutes (CHECK). Single use: redeem
is one guarded UPDATE `where redeemed_at is null and expires_at > now() and attempts < 5`. Each failed
code try increments `attempts`; the fifth failure kills the request. The email contains the link
`https://waronsaas.com/auth/verify?r=<requestId>&t=<linkToken>` and the code; nothing else. Workstream:
control-plane. Tests: token reuse, expiry, sixth try, hash-only storage (grep the row).

**S-2 Binding to the starting client.** Redemption requires the poll secret, which never leaves the
client that started the flow (returned in the start response to Desktop/CLI; set as HttpOnly cookie
`wos_signin` for web). So a link forwarded to, or phished from, another device cannot complete someone
else's sign-in. Desktop: the `wos://auth?r=...&t=...` deep link is handled by the main process, which
pairs it with the poll secret it holds; if the deep link does not arrive (other machine, blocked
handler) the user types the code. CLI: the user types the code. Web: link opened in the same browser
completes; in another browser the page asks for the code on the original tab. Workstream:
control-plane, desktop, cli, web. Test: redeem with the right token and a wrong poll secret fails.

**S-3 No enumeration, rate limits.** The start response is identical (shape, status, timing budget) for
known and unknown emails; accounts are created on first redeem. Limits in `rate_limits`: 5 starts per
email per hour, 20 per IP per hour (IP hashed with a daily salt), 5 code tries per request, 60
authenticated requests per minute per account on write routes. Exceeding returns `429 RATE_LIMITED`.
Workstream: control-plane. Tests: response equality, limit boundaries.

**S-4 Sessions.** Opaque random 32-byte tokens; only HMAC-SHA256(`SESSION_TOKEN_PEPPER`, token) is stored (the same keyed hash as S-1; the `bytea` columns named `*_hash` hold these HMACs). Access token 1 hour, refresh 30 days,
rotating: each refresh issues a new pair and marks the old refresh `rotated_at`; presenting a rotated
refresh token revokes every session in the family (theft signal). Logout revokes the family.
Desktop stores tokens with Electron `safeStorage`; CLI with `@napi-rs/keyring`; never plain files.
Suspension revokes all families and active leases. Workstream: control-plane, desktop, cli. Tests:
refresh reuse revokes family; no token material written outside the keychain (CLI test inspects the
config directory).

**S-5 Web cookies and CSRF.** Web session cookie `wos_session`: HttpOnly, Secure, SameSite=Lax,
`Domain=waronsaas.com`. State-changing web requests must send header `X-wOS-Csrf` equal to the
non-HttpOnly cookie `wos_csrf` (double submit). CORS on the API allows only `https://waronsaas.com`
with credentials. Workstream: control-plane, web. Test: POST without the header is 403.

**S-6 GitHub linking.** Uses the wOS GitHub App's user authorisation (device flow for Desktop/CLI,
web flow with a hashed `state` for the site), brokered by the server. The server reads `GET /user`
once and discards the GitHub token; wOS stores only id, login, account creation date and avatar. One
GitHub per account and one account per GitHub (`GITHUB_LINKED_ELSEWHERE`). After unlink the GitHub id
stays reserved to the account for 90 days (`GITHUB_RESERVED`), so a GitHub identity cannot hop between
accounts to launder independence or reputation. Unlink is refused while the account holds an active
lease, a live attempt or a sealed review. Every contributor route requires a linked GitHub
(`403 GITHUB_REQUIRED`). Workstream: control-plane. Tests: each refusal code; token not persisted.

### Server and data

**S-7 Installing contributor code.** Every install command in `wos.json` must disable lifecycle
scripts (`npm ci --ignore-scripts`); the repo manifest review rejects anything else. Verification
steps are run by the orchestrator with a minimal environment (PATH, HOME, LANG, and the variables in
the provider spec), never the user's full shell environment, and inside the worktree as cwd.
Remaining risk, stated plainly: `wos build` runs tests written by other contributors on your machine.
Those tests were reviewed by two independent reviewers and passed CI before merge, but candidate code
under review is not. V1 mitigation: builders only run checks at their own base commit plus their own
changes; reviewers run no code at all (read-only, S-14). Container isolation for local verification is
a V2 item (see GAPS.md). Workstream: github-build (orchestrator), verification. Test: a postinstall
script in a fixture repo does not run.

**S-8 Secrets.** All server secrets live only in Vercel environment variables of `waronsaas-api`
(names in FOUNDER-CHECKLIST.md). None are in the repo, the database, the product repo or client
builds. Desktop signing credentials live only in the platform repo's GitHub Actions environment
`release` with required reviewers. The control plane never logs request bodies of auth routes.
Workstream: control-plane, verification. Test: a secret scanner runs in CI over the platform repo.

**S-9 Row-level security.** The app connects as `wos_app` (NOBYPASSRLS, not the table owner). RLS is
enabled on every `wos` table. Public project data (targets, roadmaps, ABUs, PRs, events, ledger,
progress) has a permissive `app_all` policy because it is public anyway; authorisation there is the
control plane's state-machine guards. Private tables have row policies keyed on
`wos.actor_id()` / `wos.actor_kind()`: `account_emails`, `devices`, `provider_attestations`,
`github_link_requests`, `leases` (own rows or privileged); `sessions`, `email_signin_requests`
(system actor only); `reviews` and `findings` (sealed until the round is revealed, S-11); `events`
rows with `visibility = 'private'` are readable only by privileged actors and the account they concern
(`actor_account_id` or `payload.accountId`; migration 0002). Request
handlers run as the calling account; only after authorisation succeeds may a handler switch the
transaction to `system` for work that must see other accounts' private rows (e.g. eligibility needs
the other slot's reviewer). Schema `wos` is not exposed through Supabase's Data API, and `anon` and
`authenticated` have no rights on it. Workstream: architect (policies), control-plane (actor setting).
Test: `packages/db/test/db-assertions.sql` (sealed review invisible to another account, email rows).

**S-10 Append-only records and the hash chain.** `ledger_entries`, `events`, `event_consumptions`,
`context_manifests`, `agent_runs`, `changesets`, `candidate_commits`, `reviews`, `finding_responses`,
`verification_runs`, `provenance_records`, `progress_snapshots`, `provider_attestations`,
`github_identity_history`, `inventory_items` and `wos_meta.schema_migrations` reject UPDATE, DELETE and
TRUNCATE by trigger for every role, and `wos_app` holds only SELECT and INSERT on them. The ledger is a
sha256 hash chain with gapless `entry_no` assigned under an advisory lock, so a row edited or deleted
by a database owner (who could drop a trigger) is detectable by anyone replaying the public ledger API.
The rewards workstream publishes the chain head daily as a commit to the platform repo
(`ledger/heads.jsonl`) so tampering after publication is provable. Workstream: architect, rewards.
Test: db-assertions (owner UPDATE/DELETE/TRUNCATE fail, chain verifies).

**S-11 Sealed verdicts.** A verdict is stored with `sealed_at`; nobody but its author and privileged
actors can read it until both slots are in; then the round is revealed atomically in one transaction.
The review context of one slot never contains the other slot's current verdict (CONTEXT-PROTOCOL.md).
GitHub review comments are posted by the App only after reveal. Workstream: control-plane,
context-policy. Tests: RLS test; context test that no manifest of slot A references slot B's current
review.

**S-12 Reviewer independence.** Reviewers are assigned by the server (`POST /v1/reviews/claim`), never
chosen. Excluded: any account that authored any changeset of the subject (document) or built the
attempt; the other slot's reviewer of the same round (trigger `check_review_independence`; the only exception is two `bootstrap_self` reviews by a solo founder in bootstrap);
reviewers who already reviewed the same author 5 times in 7 days (`bootstrap_self` reviews do not
count, `exemptSelfReviewFromSameAuthorCap`). The DB trigger `check_review_independence` (migration 0002)
is the backstop: the review's task must be the review task of that round and slot, the lease must be
that task's active lease held by the reviewer, the manifest must belong to that lease, the author rule
holds, and `bootstrap_self` / `bootstrap_maintainer` are accepted only while bootstrap mode is on and
only from a maintainer. Bootstrap exceptions are labelled
(`bootstrap_maintainer`, `bootstrap_self`) and shown publicly (AGENT-POLICY.md "Bootstrap mode").
Workstream: context-policy (`checkEligibility`), control-plane. Test: author claim refused; DB trigger
rejects direct insert.

### What attestation proves (D1)

**S-13 Model identity is an attestation.** wOS launches the contributor's own `claude` and `codex`
with explicit `--model` and effort flags and records a signed `AgentRunRecord`: CLI version,
`authMethod` from `claude auth status` / `codex login status`, requested model and effort, the model id
the CLI's own event stream reports (`modelIdReported`, may be null), argv hash, transcript hash, output
hash, device Ed25519 signature. What this proves: a registered device of that account signed a record
claiming those facts. What it does not prove: that the model actually ran, at that effort, unmodified.
A modified client can sign anything.

Therefore "Astra MAX / Fable MAX" is published as "attested", and wOS never relies on attestation alone:

- every contribution is judged by two OTHER people's agents plus CI on GitHub (D2);
- deterministic facts are recomputed server-side (scope, hashes, CI);
- rewards are held for 14 days and void on revert;
- random audit re-reviews (S-28) catch reviewers who rubber-stamp or never ran a model;
- transcripts are hashed so an audit can ask the contributor to produce the transcript that matches.

Workstream: github-build (records), context-policy (policy), rewards (holds). Test: unsigned or
wrong-key records are stored with `signature_valid = false` and block qualification.

### Agents on contributor machines

**S-14 Agent runtime restrictions.** Claude Code always runs with `-p --restricted --safe-mode
--strict-mcp-config --no-session-persistence --permission-prompts none` and an explicit `--tools`
list: `--restricted` ignores user/project/local settings files and removes code-running tools unless
named; `--safe-mode` disables CLAUDE.md, hooks, plugins, skills and MCP (so a repo's CLAUDE.md cannot
inject instructions, and the contributor's personal setup cannot change behaviour). Read-only roles use
`--permission-mode dontAsk` with Read/Grep/Glob only. The builder uses `--permission-mode acceptEdits`
with `--allowedTools` limited to the exact verify and acceptance commands; anything else that would
prompt is denied. Codex runs `codex exec --sandbox read-only --ignore-user-config --ignore-rules
--ephemeral -c project_doc_max_bytes=0 -c approval_policy="never"` (AGENTS.md ignored). `--bare` is not
used because it reads only `ANTHROPIC_API_KEY` and would break subscription sign-in (D1). No role has
network tools. Workstream: context-policy (`buildInvocation`). Test: snapshot of argv per role vs the
policy JSON; an integration test with a fixture CLAUDE.md containing instructions shows no effect
(UNVERIFIED combinations are listed in AGENT-POLICY.md).

**S-15 Changesets contain only regular files.** The client captures changes with `lstat`: symlinks,
submodules, device files, files outside the worktree and paths through a symlinked directory are
reported as rejected, never followed. A `Changeset` can only express `upsert` of mode `100644`/`100755`
or `delete`; modes `120000` and `160000` cannot be represented. Workstream: github-build
(`captureChanges`), architect (schema). Test: contracts test "cannot carry symlinks"; fixture with a
symlink escaping the worktree.

**S-16 Server-side scope validation.** The control plane re-runs `validateChangeset` against the ABU (or
document) scope at the attempt's base commit before anything reaches GitHub: every path must be inside
a write scope; toolchain paths need an exclusive `toolchain:<path>` resource
(`TOOLCHAIN_WITHOUT_RESOURCE`, S-33); `RepoPath` forbids absolute paths, `..`, `.`, empty segments, backslashes, NUL and any
`.git` segment; case-insensitive collisions with existing paths are rejected (`CASE_COLLISION`, protects
macOS/Windows checkouts); each file's sha256 is recomputed (`HASH_MISMATCH`); `submissionSha256` is
recomputed (`SUBMISSION_HASH_MISMATCH`); the device signature is verified (`SIGNATURE_INVALID`); the
manifest must be the accepted one for this lease (`MANIFEST_MISMATCH`); total size <= `maxChangesetBytes`
and 4,000,000 bytes; a secret scanner runs over added content (`SECRET_DETECTED`). The normative
pattern list is `packages/verification/src/secrets.ts` (private keys, AWS, GitHub, Anthropic, OpenAI,
Slack, Stripe live, Google, npm and Resend keys, non-local Postgres URLs with passwords); changing it
is reviewed by the architect like a contract change (B-0004-verification). All hashes and the
signature check use `@waronsaas/contracts/canonical` (S-32). CI re-runs the same
validator from the build graph at the base commit using the commit trailers. Workstream: verification,
control-plane. Test: one test per `ChangesetErrorCode`.

**S-17 Protected, generated, lockfile and migration paths.** Regardless of ABU scope: `protectedPaths`
(always `.github/**` and `wos.json`, plus `catalog/**` and `roadmaps/**` for builders) are
rejected; inside `features/`, a builder may write ONLY under `features/<feature>/acceptance/**` — every
other file there (`CONTRACT.yaml`, `BUILD-GRAPH.yaml`) is rejected by a built-in `validateChangeset` rule
with `PROTECTED_PATH`, and the suite template no longer lists `features/**` in `protectedPaths`
(contracts 3.1.0, B-0006-verification); document author tasks keep their own `documentPaths`; (`PROTECTED_PATH`, `WORKFLOW_FILE`); `generatedPaths` are rejected (`GENERATED_PATH`); files in
`lockfiles` need a `lockfile:<path>` resource and files under `migrationsDir` need `db:migrations`
(`LOCKFILE_WITHOUT_RESOURCE`, `MIGRATION_WITHOUT_RESOURCE`). The build-graph validator refuses graphs
whose ABUs write protected paths. Workstream: verification, planning. Tests: per code.

### The PR gate (D9)

**S-18 Only the App opens PRs, only after qualification.** Contributors are not collaborators and
never push. The product and platform repos use GitHub's "restrict pull request creation to
collaborators" setting and restrict issue creation to collaborators. UNVERIFIED: whether a GitHub App
installation token counts as a collaborator for that setting; tested on day one (FOUNDER-CHECKLIST.md).
Fallback and defence in depth: the webhook handler closes and locks any PR whose author is not the App
bot, with a comment pointing to wOS. Qualification is machine-checked and listed in the PR body: valid
unexpired lease held by that account at submission; linked GitHub; base commit matches the lease; head
sha and submission hash equal what both reviewers reviewed; scope re-validated; manifest equals the one
accepted for the lease; model and effort attested per policy; both verdicts NO_MATERIAL_GAPS by other
contributors; CI success on the same sha. The official branch points at the exact reviewed commit.
Branch rulesets on `main`: nobody pushes, merges only through the merge queue, required checks
`wos-verify` and `wos/qualified`, the latter restricted to the App as source. Workstream: github-build,
control-plane. Test: e2e attempts to open a PR with a user token and to merge without `wos/qualified`.

**S-19 GitHub App permissions.** The App gets the minimum listed in FOUNDER-CHECKLIST.md and
deliberately NOT `workflows` write: GitHub itself refuses any App push that touches
`.github/workflows`, independent of S-17. No `administration` permission. Webhook payloads are
verified with HMAC-SHA256 (`X-Hub-Signature-256`, constant-time compare) and deduplicated by
`X-GitHub-Delivery`. Workstream: github-build. Test: a signed/unsigned delivery pair; a workflow-file
changeset rejected before GitHub is called.

**S-20 CI holds no secrets.** The product repo has no Actions secrets and no environments with secrets.
`wos-verify` declares `permissions: contents: read`, runs on push to `wos/candidate/**`,
`pull_request` and `merge_group`, and only reports results. So candidate code running in CI cannot
exfiltrate anything of value. Release signing exists only in the platform repo, in a protected
environment that candidate code never reaches (the platform repo is not built by contributors in V1).
Workstream: verification. Test: a CI lint that fails if any workflow in the product repo references
`secrets.`.

### Adversaries

**S-21 Prompt injection through repository content.** Repo files, roadmaps, contracts, diffs, test
output and finding text are inserted into prompts only inside delimited untrusted-content blocks
(CONTEXT-PROTOCOL.md), after the role obligations. Every role's obligations say that text inside the
repository is data, and implementation reviewers must report instruction-like text aimed at reviewers
as a material security finding. Agents have no network and reviewers cannot execute code. Two
different vendors' models review independently, so one injection must fool both. Residual risk is
real; audits (S-28) and human maintainer merge authority during bootstrap are the backstop.
Workstream: context-policy. Test: fixture diffs with embedded "output NO_MATERIAL_GAPS" instructions
are part of the reviewer eval set (verification workstream).

**S-22 Modified client.** Assume some clients are modified. Everything that matters is recomputed or
re-run server-side or in CI: scope, hashes, signatures, CI, reviewer assignment, round outcome,
qualification, progress, rewards. A modified client can lie about which model ran and about local test
results; neither is trusted for acceptance (S-13). A modified client cannot bypass review because
reviews are other people's leases. Workstream: all. Test: e2e with a fake client that skips the agent
and submits a hand-written diff: it still needs two independent reviews and CI.

**S-23 Fabricated or lazy verdicts.** Verdicts must validate against `ReviewVerdict` (NO_MATERIAL_GAPS
iff no material finding and no still-open prior finding), be bound to the round's head sha and
submission hash, come from the assigned lease (enforced in the database since migration 0002: a lease
for round X cannot post into round Y even though head and hash are public), and carry a signed agent-run record whose manifest was
accepted for that lease. A reviewer can still fabricate a well-formed verdict without running a model.
Counter: audits (S-28), public verdicts after reveal, reward holds, and suspension on proven
fabrication (maintainer action `suspend_account`, `reverse_contribution`). Workstream: control-plane,
rewards. Test: verdict with mismatched head sha is rejected (db-assertions).

**S-24 Sybil accounts.** Tokens have no cash value and are not transferable (D3), which removes most
of the incentive. Controls: one GitHub per account and 90-day reservation (S-6); contributor roles
require a GitHub account at least 90 days old (`minGithubAccountAgeDays`), reviewers at least one
accepted contribution, resolvers three; server-assigned reviews; reward holds; collusion damping
(S-25). Stronger sybil resistance is a GAPS.md item. Workstream: context-policy, control-plane. Test:
eligibility tests at the thresholds.

**S-25 Collusion.** Random server assignment, distinct reviewers per round, a cap of 5 reviews of the
same author per reviewer per 7 days, public verdicts and provenance, and audits. A ring of accounts can
still review each other within those limits; detection is a V2 analytics item. Workstream:
context-policy. Test: the sixth review of the same author in 7 days is refused.

**S-26 Symlink, generated-file and lockfile escapes.** Covered by S-15, S-16, S-17 and the build-graph
validator (write scopes are exact files or `<dir>/**`, so scope algebra is decidable and a builder
cannot claim `**`). Dependency changes (`package.json` + lockfile) need an ABU that declares
`lockfile:package-lock.json` exclusively, so two builders never edit the lockfile concurrently and the
change is reviewed as its own unit. Workstream: verification, planning.

**S-27 Denial of service on the pipeline.** Lease limits per account (2 build, 2 review), hard
deadlines, revision windows (48 h), maximum rounds, `maxFailedAttemptsPerAbu` (3) then
`needs_decomposition`, changeset size caps, API rate limits. Workstream: control-plane.

**S-28 Random audit re-reviews.** Five percent of revealed implementation rounds, and every round in
bootstrap mode, are re-reviewed later by a third independent contributor at max reasoning with the same
context plan. A contradicting material finding upheld by a ruling reverses the original reviewers'
review contributions (held tokens void) and is public. Workstream: control-plane, rewards (V1 builds
the task kind as a normal `implementation_review` with an audit flag in `carry`; see GAPS.md for the
rate decision).

### Desktop

**S-29 Electron hardening.** `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`; renderer loaded only from
the packaged bundle; navigation and `window.open` denied; a strict CSP; the preload exposes exactly
`window.wos: WosBridge` via `contextBridge`; every IPC handler validates its payload with zod and checks
the sender frame; `openExternal` only for `https://waronsaas.com/...` and
`https://github.com/waronsaas/...`; the `wos://` deep link handler accepts only `auth` with the
expected parameters. Workstream: desktop. Tests: renderer has no `require`/`process`; IPC fuzz;
openExternal allowlist.

**S-30 Signing and updates.** macOS builds are signed with a Developer ID certificate and notarised in
GitHub Actions only (D7). Auto-update via `electron-updater` from GitHub Releases of the platform repo,
which verifies signatures on macOS; Windows builds are signed or not shipped (GAPS.md). The CLI is
published to npm with provenance from Actions. Workstream: desktop, verification. Test: release
workflow refuses to publish an unsigned macOS artefact.

### Operations

**S-31 Incident and revocation procedures.** Maintainer actions exist for each response, all public
and audited as events:
- compromised account: `suspend_account` (revokes sessions, leases, pending tasks; open attempts fail);
- compromised device: device revocation (`devices.revoked_at`), signatures from it are invalid from
  then on;
- bad merged change: revert through the normal pipeline, then `reverse_contribution` (held awards void,
  released ones clawed back);
- leaked App key or webhook secret: rotate in GitHub, update Vercel env, redeploy; the App key is never
  on any laptop;
- database tampering suspicion: replay the ledger hash chain against the published heads (S-10);
- bootstrap abuse: bootstrap cannot be re-entered once ended (trigger `bootstrap_one_way`, migration
  0002, applies to every role including the owner's normal sessions).
Workstream: control-plane. Test: each maintainer action has an integration test.

### Contracts 2.0.0 additions

**S-32 One canonical hashing and signing definition.** Every hash and signature in wOS is computed by
`@waronsaas/contracts/canonical` (rules C-1..C-7: RFC 8785 JCS, `sha256:<hex>`, the diff hash with deletes
as `{path, op}` only, signed bytes = JCS of the parsed changeset without `signature` and with each
upsert's `contentBase64` replaced by its sha256, device keys as base64 of the raw 32-byte Ed25519 key,
signatures as base64 of 64 bytes). No package keeps its own copy. The database refuses any other device
key encoding (`devices_public_key_raw_ed25519`). Workstream: all; test vectors in
`packages/contracts/test/canonical.test.ts`.

**S-33 Trusted verification cannot be redefined by the candidate (B-0005-verification).** The files that
decide what "verify" means are `RepoManifest.toolchainPaths` (at least `DEFAULT_TOOLCHAIN_PATHS`:
`wos.json`, every `package.json`, `package-lock.json`, `tsconfig*.json`, biome, vitest, vite, eslint and
prettier configs, `.npmrc`, `.nvmrc`). (1) A submission may change one only if its ABU declares the
exclusive resource `toolchain:<path>` (the build-graph validator and `validateChangeset` both enforce
it). (2) A PR that changes a toolchain path needs a maintainer's CODEOWNERS approval before it can
merge. (3) The required `wos-verify` check never trusts the candidate's definitions: it reads the verify
steps from the BASE commit's `wos.json` and restores every toolchain path from the base commit before
install and verify; a second, non-required job runs the candidate's own toolchain so reviewers can see
the effect. (4) Implementation reviewers treat any unrequested change to how verification runs as a
material finding. Workstream: verification (workflow, validator), planning (build-graph rule),
control-plane (qualification), context-policy (policy rule rendering).

## 3. Subscription terms

Orchestrating contributors' Claude and ChatGPT subscriptions for platform work may conflict with the
providers' consumer terms. wOS does not proxy or store credentials and runs the official CLIs as the
signed-in user on their own machine, but this is not a legal opinion. See GAPS.md; FOUNDER DECISION.

## 4. Contracts 4.0.0 additions (D13)

**S-34 Toolchain attestations are claims.** `ToolchainAttestation` (os, version, tools) decides only who may claim native ABUs; a false one wastes the lessee's time, never lets unverified code in, because CI and reviews still decide. Stored append-only (`wos.toolchain_attestations`, own rows only under RLS). Workstream: context-policy (eligibility), control-plane.

**S-35 Mobile signing is CI-only and separate.** EAS Build signs iOS and Android builds of the replacement apps only from the protected `release` environment of `waronsaas/product`; the credentials (Apple distribution certificate, App Store Connect API key, Google Play upload key, EAS token) never reach contributor machines or candidate CI, and are separate from wOS Desktop's Developer ID. Workstream: verification (workflows).

**S-36 No vendor trade dress.** Reviewers at roadmap, contract and implementation level treat copying the vendor's trade dress, logos, icons or visual design as a material finding (policy `materialFindingRules`). This limits legal exposure (GAPS G-23) and keeps the product ours.
