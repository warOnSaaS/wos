# Dogfood log: mobile-runtime

One row per working session (WORKSTREAMS.md rule 9). Below the log, a plain-language guide to wOS Mobile for the founder.

| Date | Context at start (est. tokens) | Task scope | Files owned | Files changed | Duration | Blockers raised | Merge conflicts | Repair loops | Verification failures | Integration failures | Lessons |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-30 | ~60k (AGENTS.md, WORKSTREAMS 12 and 14, WOS-APP-PROTOCOL, SECURITY S-2/S-4/S-38/S-41/S-43, wos-app.ts, api.ts auth and AppRoutes, the template's Core, test support and CRM manifest) | Wave 3a: the ONE Expo app. Environment selection and discovery, local sign-in, wOS Cloud session and environment-token refresh, ActiveApps refresh, navigation from active manifests, the wos-screen.v1 renderer (list, detail, form, seven actions), bundled CRM module, V1 proof step 6 in process against the template's Core (self-hosted and hosted mode) | `templates/product/apps/mobile/**`, `tests/mobile-runtime.test.ts`, the template root `package.json`/lockfile (workspace entry only), this file, 1 blocker | ~30 | ~1 h 45 min | B-0001-mobile-runtime (no client kind for a phone on the control plane; 12.4 row lacks the account routes a phone needs to reach `issueEnvironmentToken`) | 0 | 3 (biome format pass; the font packages bundled every weight until imported per weight; ActiveApps kept the last list after sign-out) | 0 | 0 | Keeping the runtime free of React Native imports made every behaviour testable in the root vitest run with no simulator and no mocks; the views only draw a view model. The vendored contracts are Node ESM (`./x.js` for `x.ts`), which Metro does not resolve; a four-line resolver fallback fixes it without touching the vendor copy. The index of the vendored contracts pulls in node:crypto, so a phone must import the vendor files directly. |

## wOS Mobile, in plain words

### What it is

wOS Mobile is one app for iPhone and Android. When someone opens it, it asks where their organization's apps live:

- **wOS Cloud**, hosted by warOnSaaS (the default), or
- **a self-hosted wOS Core**, typed in by address (for example `wos.example.com`).

It then signs the person in to that place, asks it which apps the organization has switched on (`ActiveApps`), and shows those apps in its menu. Today the only app with a phone screen is **wOS CRM**, and CRM has no built feature yet, so opening it shows **0 RECORDS** and says it shows only what is built. That is the honest state; there are no sample contacts anywhere.

When the organization switches CRM off, CRM leaves the phone's menu within a minute (the app re-reads the list every 60 seconds, whenever it comes back to the foreground, and whenever its access token is renewed). If CRM is open at that moment, the phone goes back to the menu and says the app is no longer active and its data is kept.

### How an app's screens work

Apps do not ship code to the phone after it is installed (Apple and Google rules, and SECURITY S-38). Instead each app describes its phone screens as data (`wos-screen.v1`): "a list of these fields from this address", "a record with these sections", "a form with these inputs", plus a fixed set of buttons (call, email, open another screen, new, edit, delete, run). wOS Mobile has one built-in drawer for each kind. The app's server provides the data; the phone draws it. Anything a screen cannot describe is written as normal code inside wOS Mobile and ships in the next store version.

The drawer also enforces the rules: a screen may only read its own app's server addresses (`/apps/crm/...`), buttons appear only for people whose role has the permission, and nothing from a screen or a record is ever run as code.

### The technical choices, and why

| Choice | Why |
|---|---|
| **Expo, managed workflow** (React Native + TypeScript, Expo SDK 57) | One code base for iPhone and Android. "Managed" means we write no Xcode or Android Studio projects: Expo generates them when a build is made, and Expo's cloud service (EAS) builds and signs the store versions. No custom native code is used, so the app also runs inside the free **Expo Go** app during development. |
| **No navigation library** | The app has three places (environment, sign-in, menu) and a stack of screens inside an app. A small state machine does that with less to update and nothing native. |
| **The runtime is separate from the drawing** | Everything that decides something (addresses, sign-in, token renewal, permissions, form checks, what a button does) lives in `src/runtime/` and has no React Native import. The screens in `src/ui/` only draw what the runtime computed. |
| **Tests run with vitest in plain Node**, not jest-expo | Because the runtime has no React Native import, its tests need no simulator, no emulator and no React Native mocks, and they run in the same `npm test` as the rest of the repo (root `tests/mobile-runtime.test.ts`, like `tests/suite-shell.test.ts`). jest-expo would have added a second test runner and Babel setup only to test code that already has none of React Native in it. The drawing code is checked by the TypeScript typecheck and by bundling it with `expo export`. |
| **Proof step 6 runs against the real template Core** | `test/core-proof.test.ts` starts the template's wOS Core in the test process and points the phone runtime at it. Self-hosted: pick the environment, sign in with the emailed code, see CRM in the menu, open CRM's screen, get 0 records from CRM's own API. wOS Cloud: Core checks real signed environment tokens; when the token stops listing CRM, CRM leaves the menu at the next renewal. |
| **Tokens only in the phone's secure storage** (`expo-secure-store`: iOS Keychain, Android Keystore) | A lost phone's files do not expose a session. The 15-minute environment token is kept in memory only and re-made when needed. |
| **wOS Cloud sign-in is only accepted from the real wOS account service** | An environment tells the phone where to sign in. The phone refuses any `wos_cloud` sign-in address other than `https://api.waronsaas.com`, so a self-hosted server cannot collect wOS account sessions. |
| **https everywhere, plain http only on your own network** | So a developer can point a phone at a Core running on their Mac over Wi-Fi. Store builds of iOS and Android block plain http anyway. |
| **Fonts bundled** (Geist Mono Bold for the `wOS` mark, JetBrains Mono for text) | The brand look without downloading anything at run time. Only the three weights used are bundled. |
| **TypeScript 7.0.2**, the template's version | Expo suggests 6.0.3, but TypeScript is only used for checking (Expo's bundler strips types), and one version across the template keeps the lockfile simple. `expo install --check` is told to skip it. |
| **App identifiers `com.waronsaas.wos`**, display name `wOS` | Sensible defaults in `app.json`. They become permanent once a build is uploaded to a store, so change them before the first upload if you want different ones. |

### How you run it on a phone later

**Option 1: Expo Go (no accounts, about 10 minutes).** Good for seeing it and for trying a self-hosted Core.

1. On the phone, install **Expo Go** from the App Store or Google Play.
2. On the Mac, in the product repository (or in `templates/product` of this repo): `npm ci --ignore-scripts`, then `cd apps/mobile` and `npx expo start`.
3. A QR code appears. iPhone: scan it with the Camera app. Android: scan it from inside Expo Go. The phone and the Mac must be on the same Wi-Fi.
4. wOS Mobile opens inside Expo Go. Choosing **wOS Cloud** will stop at sign-in with "NOT AVAILABLE YET" until blocker B-0001-mobile-runtime is ruled on.
5. To try a self-hosted Core from the phone: follow the comments at the top of `docker-compose.yml`, but set `WOS_PUBLIC_URL=http://<your Mac's Wi-Fi address>:8080` in `.env` (for example `http://192.168.1.20:8080`; System Settings → Wi-Fi → Details shows the address), because the phone reaches the Core through that address. In the app, type the same address under Self-hosted address, sign in with the owner email, and read the code from `docker compose logs core` (or your email, if SMTP is set).

**Option 2: a development build or TestFlight / internal testing.** Needed only to see the real app name and icon on the home screen, to hand it to testers, or once the app needs something Expo Go does not contain. This needs the accounts below; then `npx eas-cli init` in `apps/mobile` (links the Expo project and writes its id into `app.json`) and `npx eas-cli build --profile preview` produces an installable build. Store releases run only from the product repo's `release-mobile.yml` on a `mobile-v*` tag (S-35).

### Accounts (FOUNDER-CHECKLIST section 10; nothing was created by this workstream)

| Account | Needed for | Cost |
|---|---|---|
| none | Expo Go on your own phone | free |
| Expo organisation `waronsaas` + an EAS access token as `EXPO_TOKEN` | development builds, TestFlight/internal builds, store builds | free tier is enough to start |
| Apple Developer Program (organisation, needs a D-U-N-S number; the same one wOS Desktop uses) | any iPhone build outside Expo Go, TestFlight, the App Store | yearly fee |
| Google Play Console | Play Store and its internal testing track | one-time fee |

### What is not built yet, on purpose

- **wOS Cloud sign-in** waits for blocker B-0001-mobile-runtime (the platform has no sign-in "client kind" for a phone). Everything after the emailed code is built and tested.
- **OIDC** environments (an operator's own identity provider) show "not supported yet".
- **App icon and splash artwork**: Expo's default icon until a brand asset exists.
- **Push notifications, charts, filters beyond search**: after V1 (WOS-APP-PROTOCOL section 9).
- **Maestro device flows** exist as files (`apps/mobile/maestro/`) for the verification workstream; nothing runs them yet.
