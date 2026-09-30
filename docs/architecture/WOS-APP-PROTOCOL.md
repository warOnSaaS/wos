# WOS-APP protocol, version `wos-app/v1`

Status: frozen at contracts 5.0.0 (Amendment 01, D16, D17), 2026-09-29; Wave 3a additions at 5.2.0, 2026-09-30 (application progress, Build manifest, token wire format, module bundle, screen data). Owner: Lead Architect.

The ground truth is `packages/contracts/src/wos-app.ts` (schemas and pure helpers), plus:
- `canonical.ts` C-6: package signing.
- `state-machines.ts`: `EntitlementMachine`, `AppReleaseMachine`, `ModuleInstallMachine`.
- `api.ts`: `AppRoutes`.
- `packages/db/migrations/0006_one_product.sql`.

Where this document and that code disagree, the code wins and this document is a bug.

Every application warOnSaaS builds conforms to this protocol: CRM, Chat, Meet, Accounting, Build and the rest. wOS is ONE product: the user installs wOS, signs in and sees the applications their organization enabled. The applications are capabilities added to wOS; they are never separate programs, store listings or logins.

## 1. Terms

| Term | Meaning |
|---|---|
| Application (kind `app`) | Something an organization enables: `crm`, `chat`, `meet`, `build`. It is the only kind with an entitlement and a price class. |
| Module (kind `module`) | A shared business module several applications require, e.g. `contacts`. It is never enabled or priced by itself; it is active while any active application requires it. |
| Core (kind `core`, id `core`) | wOS Core: the platform primitives (section 4). It is always active and covered by the base membership. |
| Surface | One of the product's shells: `web`, `desktop`, `ios`, `android`, `api` (`ProductSurface`). |
| Environment | The server a wOS client talks to. It is either **wOS Cloud** (hosted by warOnSaaS) or a **self-hosted** wOS run by an organization. |
| Target | A rented product on the Sniper List (Salesforce). It maps to one or more applications (`wos.target_apps`, `Roadmap.apps`): Salesforce → `crm`; HubSpot → `crm`, `marketing`, `helpdesk`. The target is what we replace; the application is what we ship. |

## 2. Identity and versioning

- **`app.id`.** Lowercase, 3–32 characters, stable forever. It prefixes the app's permissions (`crm.contacts.read`), events (`crm.contact.created`), UI routes (`/crm`), API routes (`/apps/crm`) and its data schema (`app_crm`). The schema enforces every one of these prefixes.
- **`app.version`.** Semver, and it only increases. The registry refuses a release that is not newer than every earlier one (trigger `app_releases_rules`), and Desktop never installs an older version than the one it has (downgrade protection, S-39).
- **Protocol version.** `protocol: "wos-app/v1"`. A breaking protocol change is `wos-app/v2` and a contracts MAJOR. Clients refuse manifests of a protocol they do not know.
- **`requires.wos`.** The range of wOS Core versions the app works with. A client or Core outside the range does not activate the app and says why.

## 3. The manifest: `applications/<appId>/wos-app.json` (`WosAppManifest`)

Product applications live in `waronsaas/product` under `applications/<appId>/`. Build, which is first-party and part of the Desktop binary, has its manifest in `waronsaas/wos` at `apps/desktop/src/apps/build/wos-app.json`. JSON, not YAML: the manifest is hashed and signed (JCS, C-1).

```json
{
  "protocol": "wos-app/v1",
  "app": { "id": "crm", "name": "wOS CRM", "version": "0.1.0", "kind": "app", "billing": "addon",
           "summary": "Accounts, opportunities and pipelines." },
  "requires": { "wos": ">=0.1.0", "apps": [{ "id": "contacts", "version": "^0.1.0" }] },
  "provides": ["opportunities", "pipelines"],
  "features": ["opportunities", "pipelines"],
  "replaces": ["salesforce", "hubspot"],
  "surfaces": { "web": { "supported": true, "entry": "./web" }, "desktop": { "supported": true, "entry": "./desktop" },
                "ios": { "supported": true }, "android": { "supported": true }, "api": { "supported": true } },
  "mobile": { "screens": "./mobile/screens" },
  "data": { "schema": "app_crm", "migrations": "./migrations", "owns": ["opportunity", "pipeline"] },
  "permissions": [{ "key": "crm.opportunities.read", "description": "Read opportunities", "grantedTo": ["owner", "admin", "member"] }],
  "events": { "publishes": ["crm.opportunity.created"], "consumes": ["contacts.contact.updated"] },
  "routes": { "ui": "/crm", "api": "/apps/crm" },
  "navigation": [{ "id": "crm.pipeline", "title": "Pipeline", "route": "/crm/pipeline",
                   "surfaces": ["web", "desktop", "ios", "android"], "permission": "crm.opportunities.read", "order": 10 }],
  "hosting": { "selfHost": { "supported": true, "services": ["postgres"] }, "hosted": { "supported": true } }
}
```

What each field means:

- **Dependencies (`requires.apps`).** Other apps or modules that must be active. Core is implicit. Enabling an application needs its required *applications* enabled first (`DEPENDENCY_NOT_ENABLED`). Required *modules* activate by themselves. Disabling an application that another enabled application requires is refused (`DEPENDENT_ENABLED`). `activeAppIds()` computes the active set, including transitive requirements.
- **Capabilities (`provides`).** Named capabilities other apps may depend on. They are unique across the registry, and publishing a duplicate is refused.
- **`features`.** The catalog features (D10) whose `modules/<featureKey>/**` code the app ships. This links the app to Feature Contracts, build graphs and progress (section 11).
- **Permissions.** Declared, prefixed and granted per org role by default; org admins change grants per org in Core. A navigation entry, screen or action names the permission it needs. A permission that is not declared cannot be checked, so it is refused.
- **Events (`events.publishes`, `events.consumes`).** An app publishes only its own `<id>.*` events and consumes other apps' events through Core's event bus (section 4). It never reads another app's tables.
- **Routes (`routes.ui`, `routes.api`).** `routes.ui` is the web and desktop prefix; `routes.api` is the API prefix `/apps/<id>`, set exactly when the `api` surface is supported. Core mounts the app's server routes under that prefix and applies the permission checks the app declares.
- **Data ownership and migrations.** The app owns the entities in `data.owns`, canonical in its own Postgres schema `app_<id>` (`core` for Core). Migrations in `data.migrations` are forward-only SQL. Core runs them when a released version is activated on an environment, never from a client, and in version order through a ledger like `wos_meta.schema_migrations`. An app's migration may create objects only in its own schema.
- **Navigation.** The Core navigation registry merges the navigation of every active app, ordered by `order` and filtered by permission and surface. Apps never edit a shell's navigation code (ARCHITECTURE section 12).
- **Hosting.** `selfHost.supported` means the app runs from the open-source code with the listed services; this is never conditional on a payment (S-41). `hosted.supported` means wOS Cloud offers it.

## 4. Core primitives versus app-owned data

**wOS Core owns** (kind `core`, schema `core`):
- User, Organization, Membership, Identity and sessions.
- Roles and Permissions: the grant table keyed by declared permission keys.
- Notifications: one inbox, and apps post to it.
- Search: one index, and apps register providers for their entities.
- Files: object storage with per-app access.
- Audit events.
- AppEntitlements: the hosted view (section 7).
- The application registry and the navigation registry.
- The event infrastructure: an outbox per app, delivered to consumers at least once and idempotent on event id.

Applications extend these through the interfaces Core exposes. They never keep a second user table, permission system, notification store or search index.

**Shared business entities are modules, not Core and not one app.** Contacts, the people and companies CRM, Helpdesk and Marketing all use, is the module `contacts`:
- It is the D10 catalog feature `contacts`, built once in `modules/contacts/**`, with its own schema `app_contacts`, its own API under `/apps/contacts` and its own events.
- CRM, Helpdesk and Marketing each declare `requires.apps: [{ "id": "contacts" }]`.
- It is free and never shown as something to buy. It is active whenever any application that needs it is active.

The two rejected alternatives:
- **Contacts in Core.** Core would become a business data model: a self-hosted Chat would carry CRM tables, and every business entity would argue its way into Core.
- **Contacts provided by CRM.** An organization that wants only Helpdesk would have to buy CRM, which couples pricing to data ownership.

The rule for any future shared entity (products, invoices, calendars) is the same. It is a module when two or more apps need it as canonical data. It stays inside one app when only that app does.

## 5. Surfaces

| Surface | Delivered how | Code lives in |
|---|---|---|
| `desktop` | One wOS Desktop (Electron, `waronsaas/wos apps/desktop`, signed by the platform, D7/D16/D17: macOS, Windows, Linux). Product apps' desktop UIs arrive as **signed module packages** (section 6) and run in the sandboxed renderer. Build is bundled in the binary. | Desktop surface source for each app: `waronsaas/product applications/<id>/desktop` and `modules/**`. It is built by `apps/desktop` in the product repo, which holds renderer bundles only. |
| `web` | Authenticated wOS Web at `https://app.waronsaas.com` (`waronsaas/product apps/web`). In V1, every released app's web code is compiled in and activated at runtime by `ActiveApps`; independently deployed web modules come after V1 (GAPS G-63). | `applications/<id>/web`, `modules/**` |
| `ios`, `android` | One wOS Mobile (`apps/mobile`, React Native + Expo, ONE store listing each). App code is **bundled in the store build** and activated by `ActiveApps`; screens are declarative where practical (section 9). Nothing executable is downloaded after install (S-38). | `applications/<id>/mobile`, `modules/**` |
| `api` | Core's HTTP API, with each app's routes under `/apps/<id>`, on every environment. | `apps/api`, `modules/**` |

**The public Sniper List** is `https://waronsaas.com`, from `waronsaas/wos apps/web`. It is a different experience from authenticated wOS Web:
- It is a different origin and a different Vercel project, and no cookie is shared between them.
- The public site links to wOS Web but never shows business navigation.
- wOS Web never shows consortium or roadmap pages except through Build.

## 6. Desktop delivery: signed modules

When an organization enables an app, Desktop does the following. The client-local states are in `ModuleInstallMachine`.

1. It reads the org's active apps from its environment: `GET /v1/core/apps` (`ActiveApps`), which on wOS Cloud is derived from entitlements.
2. For each active app that supports desktop, it resolves the package for the active version from the registry (`AppRegistryEntry.surfaces.desktop.package`, with URL, sha256 and keyId).
3. It downloads the package into `<userData>/modules/<app>/<version>/` and verifies it: every file hash, the signature against a key **pinned in the Desktop binary** (`verifyModulePackage`), the manifest hash and schema, and that the entry exists. It is then `staged`.
4. It checks compatibility: `requires.wos` against this Desktop's Core protocol, the protocol version, and that the version is newer than the active one and not yanked.
5. It **activates** the package (`active`); the previous version becomes `previous`, kept for rollback.
6. It registers the app's routes, navigation and permissions from the signed manifest in the renderer's registry.
7. Migrations are **not applicable** on Desktop in V1. Postgres on the environment is canonical, and Core runs app migrations server-side (section 3). Desktop keeps no canonical data.
8. The app appears in the wOS navigation.

Rollback: if the new version fails to load or is yanked, Desktop re-activates `previous`. It never downloads an older version; if there is no previous version, it shows the app as unavailable.

Loading rules (S-38):
- Module code runs only in the sandboxed renderer, under `wos-module://<app>/<version>/`, with a CSP allowing scripts from that origin only.
- There is no Node, no `eval`, no remote script, and no main-process code from a package.
- The module talks to its environment only through the host bridge `window.wos.app(<id>)`, which attaches the environment session and enforces the manifest's declared API prefix and permissions.
- Modules get no filesystem, process or git access. Only Build has those, and Build is built in (D16, S-40).

**Package flow (wos repo signs; the product repo holds no secrets, S-20):**
1. A maintainer tags `waronsaas/product` with `<app>@<version>` after the release PR merges. The tag is created by the wOS GitHub App (D9).
2. The workflow `.github/workflows/module-release.yml` in `waronsaas/wos` runs in the protected `release` environment. It checks out that tag, builds `apps/desktop` for the app deterministically, writes the `ModulePackage` with file hashes and the manifest, and signs it with the module-signing key, which exists only in that environment.
3. It uploads the package to the GitHub Release `modules/<app>@<version>` on `waronsaas/wos` and calls `publishAppRelease`.
4. The control plane re-verifies the signature before recording the release (`app_releases`, `app.release_published`).

A self-hosted environment can mirror packages anywhere. The pinned key makes the download location irrelevant to trust.

**Download format (5.2.0).** The package URL is ONE JSON file, a `ModuleBundle` (`wos-module-bundle.v1`): the signed `ModulePackage` plus every file's bytes in base64. The registry's `package.sha256` is `sha256Of` the downloaded bytes, a transport check only. Trust comes from `verifyModulePackage`, each file's sha256, and `contents` listing exactly the package's files. Desktop resolves the version `ActiveApps` names through `getAppRelease` (`GET /v1/public/apps/:app/releases/:version`), which also reports a yank. Build has no package: it is in the binary.

## 7. Entitlements (wOS Cloud only)

- **`AppEntitlement` scope.** One per (organization, kind-app application). There is no row until the first enable, which the API reports as `available`.
- **States and transitions (`EntitlementMachine`).** `available → enabled`, `enabled ↔ disabled`, `enabled → suspended`, and `suspended → enabled | disabled`. Only org owners and admins enable or disable; suspension is system or maintainer, for a billing lapse or abuse.
- **Events.** Each change writes `entitlement.changed`.
- **Disabling keeps data.** Disabling hides the app on every hosted surface and never deletes data.
- **Not DRM.** Entitlements decide what wOS Cloud *hosts and shows* for an org. They are never checked by self-hosted code (section 8, S-41).
- **Pricing (architecture only; no production billing in V1).** The base membership covers Core. Each `addon` app has its own recurring price. `free` apps (Build) and modules cost nothing.
- **Propagation.** One enable changes every surface: the org's entitlement is the single source.
  - Clients re-read `ActiveApps` on start, on focus, every 60 seconds while open, and when an environment token is refreshed.
  - Environment tokens carry the active app ids and expire after 15 minutes, so a disable takes effect on every surface within that bound.
  - Push invalidation comes after V1.
- **Your Apps / Available Apps.** `GET /v1/orgs/:id/apps` (`OrgApps`) splits the registry into the apps active for the org and the hosted-compatible apps it could enable.

## 8. Environments, self-hosting and authentication

- **Environment descriptor.** Every environment serves `GET /.well-known/wos-environment` (`EnvironmentDescriptor`): its id, name, kind (`cloud`, `self_hosted`), protocol, Core version, API base and auth method.
- **Choosing an environment.** Clients default to wOS Cloud (`https://core.waronsaas.com`, id `WOS_CLOUD_ENVIRONMENT_ID`). They can instead be pointed at `https://wos.example-company.com` from Settings → Environment.
- **Sessions are per environment.** Signing in to one never signs in to another.
- **Auth: `wos_cloud`.** The user signs in with the wOS account (D8: email link). The client then exchanges its control-plane session for an **environment token**: `issueEnvironmentToken`, a 15-minute EdDSA JWS, audience = environment id, claims `EnvironmentTokenClaims` = account, org, role, active apps. Hosted Core verifies it with `GET /v1/public/environment-keys` and trusts the org and app claims.
- **Token wire format (5.2.0, C-8).** A compact JWS: `base64url(canonicalJson(header)).base64url(canonicalJson(claims)).base64url(Ed25519 signature)`, with no padding.
  - The header is `{ alg: "EdDSA", typ: "wos-env+jwt", kid }`, and `exp - iat` is exactly 900 seconds.
  - Verifiers allow 60 s of clock skew and check that `aud` is their environment id.
  - `signEnvironmentToken` and `verifyEnvironmentToken` in `@waronsaas/contracts/canonical` are the only implementation.
  - Hosted Core takes the token as `Authorization: Bearer <token>` on every `CoreRoutes` call. A self-hosted Core takes its own local session token the same way.
- **Auth: `wos_cloud` on a phone (5.11.0).** wOS Mobile signs the wOS account in as clientKind `mobile`: the user types the emailed code; tokens are stored with expo-secure-store (S-2, S-4).
- **Auth: `local`.** The self-hosted Core's own sign-in: an email code through the operator's SMTP (`CoreRoutes.localSignInStart` / `localSignInRedeem` / `logout`, contracts 5.6.0); the redeemed token is the Bearer on that Core. Accounts, organizations and memberships live in that Core.
- **Auth: `oidc`.** The operator's identity provider. Core maps the subject to its own users.
- **Self-hosted activation.** The operator's configuration decides what is active: `WOS_APPS=crm,chat` or Core's admin screen. `ActiveApps.source` is `self_host_config`. A self-hosted Core never calls wOS Cloud to decide what may run; network access to wOS Cloud is optional and only for registry lookups and package downloads.
- **Build is not an environment feature.** Build always talks to `https://api.waronsaas.com` with the wOS account, whatever environment the business apps use. A contributor can use a self-hosted CRM and contribute to warOnSaaS at the same time.
- **Hosted product data is separate from the platform database.** wOS Cloud runs Core with its own Postgres (a separate Neon project). Core never holds credentials to the platform database (`wos` schema), and the control plane never reads product data.

## 9. Mobile runtime (V1 minimum)

wOS Mobile is ONE app. Applications' mobile surfaces are bundled modules plus declarative screens (`MobileScreen`, schema `wos-screen.v1`, files under `applications/<id>/mobile/screens/*.json`, served by `GET /v1/core/apps/:app/screens` and bundled as a fallback).

The V1 runtime renders three kinds of screen:
- **`list`:** a record list with up to 4 fields, optional search, and tap to open a screen.
- **`detail`:** field sections and related lists.
- **`form`:** field sections with typed inputs.

Actions are a fixed set: `call`, `email`, `open_screen`, `create`, `edit`, `delete`, and `invoke` (a POST to the app's own `/apps/<id>/...` route). Every screen and action names a declared permission. A screen reads only from the app's own API resource.

- **Data (5.2.0).** A screen reads only its app's API. The requests are:
  - list: `GET <resource>?q=&cursor=` returns `ScreenListData` (`items`, `nextCursor`).
  - detail: `GET` with `:id` substituted returns `ScreenRecordData`.
  - related list: `GET <detail resource>/<relationship>`.
  - create: `POST` a `ScreenFormBody`.
  - edit: `PATCH` a `ScreenFormBody`.
  - delete: `DELETE`.
  - invoke: `POST` returns `ScreenInvokeResult`.

  Records are flat, keyed by field name, with an `id`. A `select` input carries its fixed `options`.
- **No code in screens.** There are no expressions, scripts or URLs outside the app's API. Anything a screen cannot express is written as a normal React Native component in the app's bundled mobile module, where it is reviewed like any code and shipped in the next store build.
- **Deferred primitives.** Charts, tables, filters beyond search, notifications UI and relationship editing come after V1, added to the screen schema as MINOR changes when a Feature Contract needs them. We are not building a low-code platform.

## 10. Build (D16)

- **What it is.** Build is the first-party application `build` (kind `app`, billing `free`), off by default and enabled per organization.
  - Its registry row is seeded by migration 0006.
  - Every account's personal organization exists from sign-up, so an individual enables Build for themselves.
  - A business org's admins decide whether members may use Build in that org.
  - Accounts that existed before 0006 have Build enabled on their personal org.
- **Surfaces.** Build's desktop surface is the current `apps/desktop` functionality: Sniper List browse, BUILD, reviews, agents, git, worktrees. Its CLI surface is `wos`.
- **Server gate.** Claims (`claimBuild`, `claimTask`, `claimReview`) return `403 NOT_ENTITLED` unless Build is enabled for an organization the caller belongs to.
- **Client gate (S-40).** Desktop registers Build's privileged main-process handlers only while two things hold: Build is enabled for an org of the signed-in account, and the user has turned Build on for this device. Those handlers spawn the claude, codex and git processes, create worktrees under the workspace root, and read CLI attestations. When either condition lapses, Desktop releases held leases and unregisters the handlers within 60 seconds.
- **CLI.** `wos` refuses Build commands with the same explanation when the entitlement is missing, and `wos apps enable build` enables it on the personal org.

## 11. Progress: target versus application

- **Target progress (the Sniper List).** This stays exactly as before: per target, from its parity profile, D12 weights and D13 per-surface acceptance (`progress.ts`). Entitlements and installs never change it (V1 proof step 9).
- **Application progress (e.g. "wOS CRM, overall 31%, desktop 48%...") is derived from the same records.**
  - For each surface S the app supports, take the ABUs of the merged build graphs of the app's `features` whose requirements are tagged S. Weight them by size points, count those merged, and cap S below 100% until every feature's acceptance on S passed for at least one profile.
  - Overall is the size-point-weighted mean across the app's supported surfaces.
  - It uses no new weights and no mock numbers: an app with no merged work shows 0%.
  - `computeApplicationProgress` is in `progress.ts` (5.2.0) and is published by `GET /v1/public/apps/:app/progress` (`ApplicationProgressView`).
  - A supported surface with no work keeps the overall below 100%.
  - An app feature with no merged contract keeps every surface below 100%.
- **Independence is structural.** `computeAppProgress` (target) and `computeApplicationProgress` (application) take disjoint inputs. Neither takes an organization, an entitlement or an install state, and contracts tests freeze their input types.

## 12. Self-host and hosted requirements (per app)

An app is **self-host compatible** when:
- it runs from the open-source repository with only the services it declares, with no call to warOnSaaS services;
- its migrations apply to an empty database;
- it passes its acceptance suites against a self-hosted Core.

It is **hosted compatible** when, in addition:
- it has no per-tenant state outside Postgres and object storage;
- its data is scoped by organization id with Core's row-level security;
- its migrations are online-safe: additive, with no long locks;
- it exposes health and metrics endpoints.

The registry records both flags from the release manifest, and CI checks them (verification, Wave 3).
