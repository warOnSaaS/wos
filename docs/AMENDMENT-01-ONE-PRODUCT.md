# Architecture amendment 01: wOS is one product with modular applications (founder, verbatim, 2026-09-29)

This is the founder's amendment as given. It supersedes earlier architecture that treats CRM, Chat, Meet, Accounting, Commerce, Projects, etc. as independent end-user applications. Where it conflicts with `docs/DECISIONS.md`, the founder's answers to the open questions recorded in `docs/DECISIONS.md` (D16 onward) decide.

---

# ARCHITECTURE AMENDMENT: wOS IS ONE PRODUCT WITH MODULAR APPLICATIONS

This amendment supersedes any previous architecture that treats CRM, Chat, Meet, Accounting, Commerce, Projects, etc. as independent end-user applications.

## PRODUCT MODEL

wOS is ONE product.

Users install:

- wOS Desktop on macOS/Windows
- wOS Mobile on iOS/Android
- optionally access wOS Web through a browser

These are platform-specific shells for the SAME wOS product.

There must NOT be separate consumer applications such as:

- wOS CRM.app
- wOS Chat.app
- wOS Accounting.app

Instead, a user installs/logs into **wOS** and sees the applications/modules their organization has enabled.

Example:

wOS

- CRM
- Chat
- Projects
- Accounting
- Commerce
- Meet

The user's:

- account
- organization
- permissions
- enabled applications
- data
- subscription state
- contribution identity

are shared across all wOS surfaces.

---

# APPLICATION ENTITLEMENTS

Create a first-class concept:

`AppEntitlement`

An organization can enable or disable individual wOS applications.

Example:

```text
Organization: Acme

wOS Core       ENABLED
CRM            ENABLED
Chat           ENABLED
Projects       ENABLED
Accounting     DISABLED
Commerce       DISABLED
Meet           DISABLED
```

Architect for pricing such as:

wOS membership/core: base price

Each enabled application: additional recurring price

DO NOT implement real production billing in this amendment unless already required elsewhere in V1.

Implement the entitlement architecture and state transitions.

The UI must be capable of showing:

**Your Apps**

and:

**Available Apps**

Enabling an application updates the organization's entitlement.

---

# OPEN-SOURCE / HOSTED MODEL

Entitlements MUST NOT become DRM for the open-source software.

The distinction is:

## SELF-HOSTED

The source code is open.

A user may self-host an available wOS application without paying wOS for managed hosting.

## wOS HOSTED

wOS operates:

- infrastructure
- deployment
- upgrades
- backups
- monitoring
- scaling
- security operations
- managed services

Organizations pay for enabled hosted applications.

Therefore:

**Open-source code access and hosted-service entitlement are different concepts.**

Do not architect the source code so that a payment check is required merely to execute self-hosted software.

---

# wOS APPLICATION PROTOCOL

Create a versioned specification:

`WOS-APP`

Every application built by warOnSaaS must conform to this protocol.

Create a machine-readable manifest.

Example:

```yaml
protocol: wos-app/v1

app:
  id: crm
  name: wOS CRM
  version: 0.1.0

requires:
  wos: ">=0.1.0"

provides:
  - contacts
  - organizations
  - opportunities
  - pipelines

surfaces:
  web:
    supported: true

  desktop:
    supported: true

  mobile:
    supported: true

  api:
    supported: true

data:
  migrations: ./migrations

permissions:
  - crm.contacts.read
  - crm.contacts.write
  - crm.opportunities.read
  - crm.opportunities.write

events:
  publishes:
    - crm.contact.created
    - crm.contact.updated

  consumes: []

desktop:
  entry: ./desktop

web:
  entry: ./web

mobile:
  manifest: ./mobile
```

Create:

`WOS-APP-PROTOCOL.md`

Document:

- application identity
- versioning
- dependencies
- capabilities
- permissions
- events
- routes
- data ownership
- migrations
- navigation
- desktop surface
- web surface
- mobile surface
- API surface
- self-host requirements
- hosted requirements

---

# SHARED wOS PRIMITIVES

Do NOT allow every application to independently reinvent foundational concepts.

wOS Core should own shared primitives such as:

- User
- Organization
- Membership
- Identity
- Roles
- Permissions
- Notifications
- Search
- Files
- Audit events
- AppEntitlements
- application registry
- navigation registry
- event infrastructure

Applications extend wOS rather than creating competing versions of these primitives.

The exact domain boundaries should be documented by the Lead Architect.

---

# DESKTOP DELIVERY MODEL

wOS Desktop remains:

- Electron
- React
- TypeScript

Desktop should support TRUE modular application installation.

When an organization enables an application, wOS Desktop should be architected to:

1. retrieve the organization's entitlement manifest
2. determine which application modules are required
3. retrieve the appropriate signed/versioned module package
4. verify integrity/signature
5. verify WOS-APP compatibility
6. install/update the module
7. register routes/navigation/permissions
8. run approved migrations where applicable
9. expose the application inside wOS Desktop

DO NOT implement an unsafe arbitrary JavaScript plugin loader.

Modules must be:

- signed
- versioned
- schema validated
- permission declared
- compatibility checked

Design for rollback.

Desktop modules should not automatically receive unrestricted host-machine access.

The Electron main process remains the privileged boundary.

---

# MOBILE DELIVERY MODEL

wOS Mobile is also ONE application.

There must NOT be separate App Store applications for CRM, Chat, Accounting, etc.

A user downloads:

**wOS**

from the mobile platform.

After authentication, the same organization entitlements determine which applications appear.

Example:

```text
wOS Mobile

Your Apps

CRM
Chat
Projects

Available

Accounting
Commerce
Meet
```

Mobile MUST NOT depend on downloading arbitrary executable application code after App Store installation.

Instead use:

1. approved/bundled mobile modules
2. entitlement-controlled activation
3. a declarative wOS mobile UI/runtime where practical

The mobile runtime should provide reusable primitives such as:

- record list
- record detail
- forms
- tables
- cards
- navigation
- actions
- charts
- search
- filters
- relationships
- permissions
- notifications

Applications may provide declarative definitions describing how these primitives should be composed.

Example concept:

```yaml
screen:
  id: crm.contact.detail

  title:
    field: name

  sections:
    - type: fields
      fields:
        - company
        - email
        - phone

    - type: related_list
      relationship: opportunities

  actions:
    - call
    - email
    - create_task
```

The native/runtime implementation renders this definition.

Do NOT build a generalized low-code platform unnecessarily in V1.

Build only enough protocol/runtime architecture to prove that modular wOS applications can expose mobile surfaces without becoming separate mobile applications.

---

# WEB DELIVERY MODEL

wOS Web is another surface of the SAME product.

It uses:

- same account
- same organization
- same entitlements
- same permissions
- same application registry
- same data

Enabled applications appear in wOS Web navigation.

Web application modules may be loaded/deployed independently according to the WOS-APP protocol.

Remember that:

**warOnSaaS.com public Sniper List**

and:

**authenticated wOS Web application**

are conceptually different experiences even if implemented within the same web codebase.

Do not mix public consortium/roadmap pages with authenticated business application navigation without clear boundaries.

---

# CROSS-SURFACE CONSISTENCY

Enabling an application is organization-level.

Example:

User enables:

`CRM`

The organization now has:

```text
CRM = ENABLED
```

That entitlement propagates to:

- wOS Desktop
- wOS Mobile
- wOS Web

The user should NOT separately enable CRM on every device.

One account.

One organization.

One application selection.

Multiple surfaces.

---

# APPLICATION DATA

Application data must not be stored independently on each device as the canonical source.

For wOS Hosted:

PostgreSQL remains canonical.

Desktop/mobile/web synchronize against the same application data.

Architect for local caching/offline functionality later, but do not create unnecessary offline-sync complexity in V1.

For self-hosted installations, the organization's self-hosted backend becomes canonical.

The clients should be configurable to connect to:

- wOS Hosted
OR
- self-hosted wOS endpoint

This distinction must be architectural from V1 even if self-host UX is primitive initially.

---

# SELF-HOST CONNECTION MODEL

Add an account/environment concept.

A wOS client should eventually support:

```text
Environment

● wOS Cloud
○ Self-hosted

Server:
https://wos.example-company.com
```

Do not require wOS Cloud for the core open-source applications to function.

Authentication architecture must account for self-hosted environments.

---

# SNIPER LIST → INSTALLABLE APPLICATION

Every successful Sniper Target should eventually produce a WOS-APP-compatible application.

Examples:

```text
Salesforce
    ↓
wOS CRM

Slack
    ↓
wOS Chat

Zoom
    ↓
wOS Meet

Shopify
    ↓
wOS Commerce

QuickBooks
    ↓
wOS Accounting

NetSuite
    ↓
wOS ERP
```

The Sniper List tracks the TARGET.

The resulting open-source wOS application is the PRODUCT.

These concepts must remain distinct.

---

# SURFACE REQUIREMENTS IN ROADMAPS

Update the Application Roadmap and Feature Contract schemas.

Every Feature Contract must explicitly define required surfaces.

Example:

```yaml
surfaces:

  web:
    required: true

  desktop:
    required: true

  mobile:
    required: true

  api:
    required: true
```

A feature may define different requirements by surface.

Example:

```yaml
mobile:
  capabilities:
    - view_contact
    - edit_contact
    - create_contact
    - call_contact

desktop:
  capabilities:
    - view_contact
    - edit_contact
    - create_contact
    - bulk_import
    - bulk_edit
```

Do not assume feature parity means identical UX on every device.

The Feature Contract defines the accepted end state for each surface.

---

# PROGRESS CALCULATION

Application progress must account for required surfaces.

Do not mark a feature COMPLETE merely because its desktop implementation exists if its accepted Feature Contract requires:

- desktop
- web
- mobile
- API

Expose surface progress where useful.

Example:

```text
wOS CRM

Overall       31%

Desktop       48%
Web           45%
Mobile        17%
API           39%
```

These percentages must derive from real accepted work.

NO MOCK PROGRESS.

---

# APPLICATION REGISTRY

Build a central:

`AppRegistry`

It should know:

- application id
- name
- current version
- protocol version
- capabilities
- dependencies
- available surfaces
- entitlement state
- installed desktop version
- available mobile surface
- web availability
- self-host compatibility
- hosted compatibility

The registry is shared conceptually across wOS clients and control plane.

---

# V1 PROOF

V1 does NOT need ten completed modular applications.

V1 must prove the architecture.

Salesforce / wOS CRM remains the first executable target.

Demonstrate:

1. CRM exists in AppRegistry
2. organization enables CRM
3. entitlement synchronizes
4. CRM appears in Desktop navigation
5. CRM appears in Web navigation
6. CRM appears in Mobile navigation/runtime
7. disabling CRM removes it from hosted-product navigation
8. self-hosted CRM remains capable of operating independently of hosted entitlement
9. Sniper List tracks Salesforce replacement progress separately from CRM entitlement/install state

The implementation can be minimal because CRM itself is being built through the warOnSaaS roadmap.

DO NOT fake CRM functionality merely to make this demonstration look complete.

---

# ARCHITECTURAL PRINCIPLE

The user should perceive:

**ONE wOS.**

Not a bundle of unrelated applications.

Applications are capabilities added to wOS.

The technical implementation may differ by platform:

Desktop:
dynamically installed signed modules

Mobile:
bundled/runtime/declarative modules activated by entitlement

Web:
dynamically deployed/loaded modules

But these differences must be invisible to ordinary users.

The mental model is simply:

```text
Download wOS
     ↓
Sign in
     ↓
Choose your apps
     ↓
CRM
Chat
Projects
Accounting
Commerce
Meet
     ↓
Same account
Same data
Everywhere
```

This architecture must be incorporated BEFORE implementation agents establish application/module boundaries.

The Lead Architect must update all affected architecture documents and shared contracts before parallel implementation continues.
