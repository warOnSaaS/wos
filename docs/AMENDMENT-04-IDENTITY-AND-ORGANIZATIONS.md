# Amendment 04: Identity and organizations (D65, 2026-09-30)

Status: accepted by the founder ("do what you think"), written by the Lead Architect. It is incorporated as contracts 5.12.0
(`packages/contracts/src/identity.ts`, `IdentityRoutes` in `api.ts`, `data/identity-policy.v1.json`) and migration
`0012_identity_and_organizations.sql`. Amendments 02 and 03 are the protocol and connections.

## 1. What exists and what this adds

Today, before this amendment:
- **Accounts.** A wOS account is created on the first redeemed email code (D8). It has exactly one verified email (`account_emails`).
- **GitHub.** An account can link one GitHub account (`startGithubLink`: device or web flow). A link is required to contribute, and an unlinked GitHub stays reserved to its account for 90 days.
- **Organizations.** Every account has a personal organization. It may own up to 10 team organizations. Roles are `owner`, `admin` and `member`, and every organization keeps an owner (0006).
- **Apps.** Applications declare permission grants per role in their manifests (WOS-APP). Entitlements are per organization.
- **Self-hosting.** A self-hosted Core signs users in with `local` (email code) or `oidc`.

This amendment makes identity and organizations usable by companies:

| Area | V1 | When |
|---|---|---|
| Sign in with GitHub, a first-class method on every client | active | Wave 3b |
| Invites by email with a role | active | Wave 3b |
| Member management: change role, remove, leave | active | Wave 3b |
| Verified domains and per-domain join policy | active | Wave 3b |
| Per-app permission overrides by admins | active | Wave 3b |
| Rate limits, quotas, abuse guards | active | Wave 3b |
| SSO (OIDC, SAML) enforced per verified domain | **dormant** | when an enterprise pays (D50) |
| SCIM provisioning | **dormant** | when an enterprise pays |
| Audit export | **dormant** | when an enterprise pays |

## 2. Sign in with GitHub

**First-class on every client.** GitHub sign-in sits beside the email code on web, desktop, cli, mobile and web_app.
- The wOS GitHub App's user authorization does the sign-in (the same App as linking).
- desktop, cli and mobile use the **device flow**: the user enters a code at github.com.
- web and web_app use the **web flow**. The App's callback at the control plane redirects to a landing page on the client's own origin (`waronsaas.com/auth/github` or `app.waronsaas.com/sign-in/github`), and that page finishes the sign-in.

**Binding (S-2).** Every GitHub sign-in is bound to the client that started it by a pollSecret, exactly as for email codes.
- For web, the pollSecret is in the `wos_signin` cookie. For every other client it is in the response body.
- The OAuth `state` is single use and stored hashed.
- The GitHub token is discarded after reading `/user` and `/user/emails`.

**Resolving the account.** Only GitHub emails that GitHub marks **verified** are considered. Deterministic, in order:
1. **The GitHub user is linked to an account.** Sign in to that account. Its email does not matter.
2. **The GitHub user is reserved** (unlinked from an account within 90 days). Refused with `GITHUB_RESERVED`: sign in with the email code and link again.
3. **The primary verified GitHub email belongs to an existing account.** Do **not** merge. The result is `email_proof_required`: the control plane emails a code to that address. The GitHub user is linked to the existing account and signed in only when the same client (same pollSecret) redeems that code. That is proof of both the GitHub account and the mailbox. Any other verified GitHub email that belongs to an account is handled the same way, primary first.
4. **Otherwise**, create the account with the primary verified GitHub email, link the GitHub user, create the personal organization, and sign in. GitHub account age rules for contributing apply unchanged.
5. **No verified email on GitHub.** Refused with `GITHUB_EMAIL_UNVERIFIED`: sign in with an email code and link GitHub from the account.

A GitHub sign-in **is** the contributor's GitHub link: the same columns, history and reservation.

**Edge cases, decided:**
- Two existing accounts are never merged: not by GitHub, not by email, not by a maintainer in V1. A person with two accounts keeps both; the one they abandon can be deleted later (account deletion is a separate, later change).
- An account's email is not replaced by GitHub's. Changing the account email is a later change; it needs a code to the new address.
- Unverified GitHub emails are ignored everywhere, including verified-domain matching.
- A suspended account cannot sign in by either method.
- The email-code method is unchanged. An account created by GitHub can also sign in with a code sent to its email.

## 3. Organizations: invites and members

**Invites.** Owners and admins invite by email with a role.
- Admins may invite `member` or `admin`. Only owners may invite `owner`.
- An invite is pending for 7 days, then expires. The inviter or any owner or admin can revoke it.
- The email links to wOS Web (`app.waronsaas.com/invites/<id>`). To accept, the account must be signed in and hold the invited email (the email must match exactly after normalization), so a forwarded invite cannot be used by someone else. The invitee may also decline.
- Accepting creates the membership in the same transaction. If the account is already a member, the invite is accepted without changing the role.
- A personal organization cannot invite.
- Machine: `OrgInviteMachine` (pending → accepted | declined | revoked | expired).

**Members.**
- **Change role:** owners change any role; admins change `member` ↔ `admin` only.
- **Remove:** owners remove anyone; admins remove members only.
- **Leave:** anyone may leave, except the last owner. The database already refuses an organization without an owner; the API answers `LAST_OWNER`.
- **Transfer ownership:** promote someone to owner, then step down.

Every change writes `organization.member_changed`. Removing a member revokes their environment tokens by the 15-minute lifetime (S-41) and ends their access to the org's apps; it deletes none of the org's data.

## 4. Verified domains and join policy

**Proof.** An owner adds a domain. The control plane gives a TXT record, `_wos-verification.<domain>` = `wos-domain-verification=<token>`, and checks DNS until the record is seen (up to 7 days), then every 24 hours.
- A domain that fails its check for 7 consecutive days **lapses**. A lapsed domain loses its join policy and can be claimed by another organization.
- Verification is exact: a subdomain is its own domain.
- An organization may hold several domains (quota in policy data).

**Rules.**
- A domain belongs to one organization. The first to verify wins; the others fail with `DOMAIN_CLAIMED`.
- Public email domains are refused (`PUBLIC_EMAIL_DOMAIN`): the blocklist is policy data (gmail.com, outlook.com, icloud.com, proton.me, and more).
- Personal organizations cannot verify domains.

**Join policy, per domain:**
- `off` (the default): nothing happens.
- `request`: an account whose email is on the domain sees the organization in "Organizations you can join" (`listJoinableOrganizations`). It may ask to join; owners and admins approve or deny (`OrgJoinRequestMachine`).
- `auto_join`: on sign-in, an account whose email is on the domain becomes a `member`, and `organization.member_changed` records it.

**What happens on sign-in with a matching email.**
- The match uses the account's verified email (an email-code account, or a GitHub-created account with a GitHub-verified email). Only verified domains with a policy other than `off` count.
- `auto_join` adds the membership once. If the account later leaves or is removed, a join exclusion is recorded and it is never added again automatically; it can still be invited.
- `request` only makes the organization discoverable. Nothing is joined without an approval.
- Verifying a domain never mass-adds existing accounts: each is added at its own next sign-in, so every join is visible to the person it affects.
- When SSO is enforced for the domain (dormant, section 7), a member's access to that organization additionally requires an SSO session.

## 5. Per-app permissions

Grants stay manifest-driven: each permission's `grantedTo` roles (WOS-APP section 3). An owner or admin may override per organization: grant a permission to a role that the manifest does not, or withhold one it does.
- An override may not grant anything to a role outside the organization.
- `core.*` permissions cannot be withheld from owners.

The effective set is computed by `effectiveGrants(manifest, overrides)`. It is carried to hosted Core in the environment token's optional `permissions` claim: the permission keys granted to the subject in active apps. Without that claim, Core uses the manifest defaults. Self-hosted Core keeps its own overrides.

## 6. Traffic: rate limits, quotas, abuse guards

All values are policy data (`identity-policy.v1.json`). They are enforced by the control plane with the existing `rate_limits` buckets (`account:<id>`, `org:<id>`, `ip:<hash>`).
- **Rate limits.**
  - Per account: API requests per minute, sign-in starts per hour, invites per hour.
  - Per organization: API requests per minute.
  - A refusal answers `RATE_LIMITED` with `Retry-After`.
- **Quotas per organization, by plan.** Every organization is on plan `free` (a paid plan comes later; there is no billing in V1). The plan sets members, pending invites, verified domains, team organizations owned per account (10, as today) and invites per day. A refusal answers `QUOTA_EXCEEDED` with the quota's name and value.
- **Abuse guards.**
  - Invites go only to syntactically valid addresses that are not on the disposable-domain list.
  - An organization younger than 24 hours sends at most a small number of invites.
  - A member removed from an organization cannot be re-invited by an admin for 24 hours (owners can).
  - The rules for an unverified-domain claim are as above.
  - Every refusal is logged without the email address (a hash only).

## 7. Dormant until an enterprise pays: SSO, SCIM, audit export

These are designed now, contracts only. They are served only after activation. Before it, their routes answer `MODULE_DORMANT`.
- **Trigger.** A paying enterprise customer's signed order that requires the module (D50).
- **Activation.** A public AdminAction sets the module's status in `identity-policy` from `dormant` to `active`, recorded like protocol module activations (D55).
- **Self-hosting.** Dormancy gates only the hosted service, never self-hosted code (S-41). A self-hosted Core may run the open-source implementation of any of these as soon as it exists.

**SSO (`OrgSsoConnection`).** Per organization, `oidc` (issuer, client id, secret reference) or `saml` (entity id, SSO URL, certificate), attached to one or more verified domains, with enforcement `optional` or `required`.
- With `required`, members whose email is on those domains need a fresh SSO session (at most 12 hours old) to get an environment token or manage the organization.
- Their wOS account stays theirs: Build and contributing never need a company's SSO.
- Owners always keep a break-glass path: email code plus a second owner's approval.

**SCIM (`ScimToken`, SCIM 2.0 `/scim/v2/Users` and `/Groups`).** Per organization, a bearer token (stored hashed). It provisions memberships and roles for accounts on the organization's verified domains: create means invite-and-accept, deactivate means remove.

**Audit export (`AuditExportRequest`).** The organization's audit events (membership, role, invite, domain, entitlement, permission-override and SSO events) for a date range, as JSONL, delivered through a signed URL that expires after 24 hours.

## 8. Self-hosted Core

A self-hosted Core has its own organizations, members and roles. It never uses wOS Cloud's (S-41).
- **Sign-in.** It uses `local` (email code through the operator's SMTP) or `oidc` (the operator's IdP). OIDC maps the subject to a Core user, and optionally a groups claim to roles (operator configuration). GitHub sign-in is not part of self-hosted Core in V1.
- **Organizations.** V1 has one organization per Core (the operator's). Invites, member management and permission overrides follow the same rules as sections 3 and 5, through Core routes (`/v1/core/org/...`). Their contracts are added when suite-shell builds them, reusing the schemas of `identity.ts`.
- **Domains.** Verified domains are replaced by the operator's `WOS_ALLOWED_EMAIL_DOMAINS`: addresses on them may sign in, and join as `member` if the operator enables auto-join.
- **SSO, SCIM and audit export** are not dormant on self-host; they arrive with their open-source implementation.

## 9. Contributors

Contributors use the same wOS account.
- Build is enabled on the personal organization (D16). Company organizations do not gate contributing unless their own admins enable Build for their members inside that organization.
- Joining or leaving a company organization changes nothing about leases, reviews, eligibility or rewards.
- A company organization cannot see its members' contributions beyond what is public.
- SSO enforcement (dormant) governs access to the company organization only, never the account's sign-in for Build.

## 10. Founder input needed

1. **Plan quotas for `free`.** The provisional values are in `identity-policy.v1.json` (members 25, pending invites 50, verified domains 5, invites per day 100). When a paid plan comes, its limits and its price.
2. **The public-domain and disposable-domain lists.** A starting list is in policy data. Should it track a maintained open list?
3. **SSO break-glass.** Is "email code plus a second owner's approval" acceptable, or should one owner's recovery codes suffice?
4. **Account deletion and email change.** Both are needed eventually (GDPR); this amendment does not design them. Should they come before Wave 3b?
5. **The GitHub App's account permission "Email addresses: read".** GitHub sign-in needs `/user/emails` to find verified addresses. The founder enables it in the App's settings; existing installations then accept the new permission. No repository permission changes.
6. **GitHub sign-in on the public site.** The site would offer "Sign in with GitHub" next to the email code. This is a copy and brand decision.

## 11. Decisions on section 10 (D66, 2026-09-30)

The founder said "do what you think"; the coordinator decided:
1. **"Email addresses: read"** on the GitHub App: the founder enables it (FOUNDER-CHECKLIST); GitHub sign-in waits for it.
2. **Plan quotas.** The `free` quotas are accepted as drafted. A paid plan stays undecided until one is sold.
3. **Blocklists.** Maintained open lists are pinned by commit hash and refreshed only by a reviewed PR, never fetched live.
   - Disposable domains: `disposable-email-domains/disposable-email-domains` (CC0-1.0, licence checked), committed as `data/disposable-email-domains.v1.json` with its commit and source sha256. `node tools/domain-lists/refresh-disposable.mjs <sha>` refreshes it.
   - Public mail providers: the curated list committed in `identity-policy.v1.json`.
4. **SSO break-glass.** An email code plus a second owner's approval. Where an organization has only one owner, a wOS maintainer AdminAction with a public label is the fallback.
5. **Account deletion and email change** are designed before Wave 3b: addendum A below.
6. **The public site** shows "Sign in with GitHub" next to the email code once the routes are live.

## Addendum A. Data export, account deletion, email change (D66, contracts 5.13.0)

Designed now so Wave 3b builds them with the rest of Amendment 04. The contracts are in `identity.ts` (`DataExportRequest`, `AccountDeletionRequest`, `RETENTION_RULES`, `accountDeletionRefusals`, `EmailChangeRequest`, `emailChangeComplete`), `AccountDeletionMachine`, and eight `IdentityRoutes`.

**A1. Export (GDPR access and portability).**
- `POST /v1/me/export` emails a confirmation code, at most once per 24 hours.
- Once confirmed, the export is built asynchronously as one JSON document (`wos-account-export.v1`) with the sections in `DATA_EXPORT_SECTIONS`: account, email, GitHub link, devices, session metadata (never tokens), organizations and roles, invites, join requests, tasks and leases, attempts, reviews, authored documents, contributions, ledger entries, bug reports, and events where the account is the actor.
- It is delivered as a signed URL valid for 24 hours, and `account.export_ready` is emitted.
- Organization data belongs to the organization and is not in a member's personal export. Exporting it is the dormant audit export's job.

**A2. Deletion (GDPR erasure).**
- **Steps:**
  1. Request; a code is emailed.
  2. Confirm; deletion is scheduled for 14 days later. The person can cancel until then and can still sign in.
  3. Completion is carried out by the system in one transaction (`AccountDeletionMachine`).
- **Blocked** (`DELETION_BLOCKED`) while:
  - the account is the sole owner of a team organization that has other members (transfer ownership or delete that organization first);
  - it holds active leases (release or finish them);
  - it is a maintainer (another maintainer removes the role first).
- **What happens to each record** (`RETENTION_RULES`):
  - **Deleted:** profile (name, avatar, handle, preferences), the email, sign-in requests, sessions, devices, attestations, memberships, join requests, and pending invites to the address.
  - **Pseudonymised, kept:**
    - contribution records (attempts, reviews, documents, PR provenance);
    - the ledger and protocol receipts, which are append-only, hashed and public;
    - the event log's actor ids.

    They are shown under `former-contributor-<10 hex>`, an HMAC of the account id with a server secret: stable, and not reversible without the secret. The account id is a random UUID with no personal data. Balances have no cash value (D3) and are forfeited by a ledger entry.
  - **Retained hashed:** an HMAC of the GitHub user id for 90 days (the existing reservation), so deletion cannot be used to reset a GitHub link. Then it is deleted.
  - **Retained:** git history in public repositories. Commits are authored by the wOS GitHub App (D9); co-author trailers name the GitHub login, and published history is not rewritten. The deletion notice says so. Also retained: already-hashed security and email logs, which expire on their own schedule.
- **Protocol:** live-money receipts and entitlements (P2+) need the protocol's own rule for a deleted beneficiary. Devnet is not live, so V1 forfeits. That is a note for the protocol architect.

**A3. Email change.**
- `POST /v1/me/email` emails a code to the new address and a separate code to the current address. The change completes when the new address is proven AND either the current address confirms or a fresh GitHub sign-in by the linked GitHub account does (within 10 minutes; for a lost mailbox).
- **No linked GitHub and a lost mailbox:** a maintainer AdminAction with a public label, after a 7-day wait, is the only path.
- **The new address:**
  - must not belong to another account (`CONFLICT`);
  - is re-checked against the disposable list;
  - does not change organization memberships. Domain joins are evaluated at the next sign-in, and exclusions stay.
- Both addresses are notified when the change completes. Sessions stay; `account.email_changed` is emitted.
