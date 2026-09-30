# DocuSign (TGT-09): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

40 capability areas (40 confirmed from sources, 0 unconfirmed). Generated from `docusign.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

Docusign eSignature plans (Personal, Standard, Business Pro, Enhanced plans) and the IAM plans (IAM Starter, IAM Standard, IAM Professional, IAM for Enterprise) with the platform features sold with them: Agreement Manager (formerly Navigator), Workflow Builder (formerly Maestro), Web Forms, Identify/ID Verification, Notary, Monitor, Document Generation/Agreement Preparation, Agreement Desk, Iris AI and agents, App Center, Admin.

Left out of this scan:

- Docusign CLM (Contract Lifecycle Management) - separate enterprise product with its own plans
- Docusign Rooms / Rooms for Real Estate - separate transaction-management product (has its own Rooms API)
- Docusign Gen for Salesforce - Salesforce-native document generation app sold separately
- Docusign Click - clickwrap product with its own API
- eOriginal - negotiable-instrument vaulting service mentioned on the features page

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | Docusign eSignature (web app) | not stated | [1](https://www.docusign.com/products/electronic-signature/features) [2](https://ecom.docusign.com/plans-and-pricing/esignature) |
| ios | Docusign - Upload & Sign Docs | iPhone, iPad, Apple Vision | [1](https://apps.apple.com/us/app/docusign-upload-sign-docs/id474990205) |
| android | Docusign - Upload & Sign Docs | Android | [1](https://play.google.com/store/apps/details?id=com.docusign.ink&hl=en_US) |
| browser_extension | Docusign eSignature for Chrome | Chrome | [1](https://chromewebstore.google.com/detail/docusign-esignature-for-c/blkboeaihdlecgdjjgkcabbacndbjibc) |
| email_addin | Docusign eSignature for Google Workspace | Gmail, Google Drive, Google Docs | [1](https://workspace.google.com/marketplace/app/docusign_esignature_for_google_workspace/469176070494) |
| email_addin | Docusign for Outlook | Microsoft Outlook | [1](https://www.docusign.com/integrations/microsoft) |
| other | Docusign eSignature for Microsoft Word | Microsoft Word | [1](https://www.docusign.com/integrations/esignature-for-microsoft-word) [2](https://www.docusign.com/integrations/microsoft) |
| other | Docusign for Microsoft Teams | Microsoft Teams | [1](https://appsource.microsoft.com/en-us/product/office/wa200002755?tab=overview) |

## Public API

**Style:** REST (JSON) with OAuth 2; Connect webhooks; per-product REST APIs; MCP server (beta)

eSignature REST API (plus legacy SOAP) with OAuth 2 token auth and embedded signing; Connect for real-time envelope events. OpenAPI files are published for eSignature, Web Forms, Maestro, Navigator, Connected Fields, Click, Admin, Rooms and Monitor. Rate limits not captured: the developer site's limits page is JS-rendered.

Sources: [1](https://www.docusign.com/products/electronic-signature/features) [2](https://developers.docusign.com/tools/openapi-files/) [3](https://developers.docusign.com/platform/mcp-server/) [4](https://developers.docusign.com/docs/maestro-api/maestro101/)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `e-signature` | Agreements | Docusign eSignature | Send documents for legally binding electronic signature and sign them remotely or in person, with a tamper-sealed result (ESIGN Act, PKI). Signing is free for recipients. | web, ios, android, api | Personal (Personal is 5 envelope sends/month; Standard and Business Pro 100/user/year; Enhanced custom) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) [3](https://apps.apple.com/us/app/docusign-upload-sign-docs/id474990205) |
| `signing-order-routing` | Agreements | Signing workflow / Conditional routing | Serial, parallel and mixed recipient routing, signing groups, delegated signing, delayed routing and conditional routing based on agreement data. | web | Personal (Basic signing workflow on all plans; delegated signing Standard; conditional and delayed routing, signing groups contact sales (Enhanced)) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `document-fields-logic` | Agreements | Fields and form fields (conditional, calculated, validation) | 20+ standard and custom fields, drop-downs, radio buttons, drawing fields, data validation, auto-placement by anchor text, pre-filled fields, value calculator and conditional/calculated fields inside the document being signed. | web | Personal (Basic fields on all plans; pre-filled fields and value calculator Standard; form fields and drawing fields Business Pro) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `templates` | Platform | Templates (reusable, shared, locked) | Reusable document templates; shared templates for teams and locked templates for controlled sending. Agreement Preparation adds template management across IAM. | web, ios | Personal (Shared templates Standard; locked templates Business Pro) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/agreement-preparation) [3](https://apps.apple.com/us/app/docusign-upload-sign-docs/id474990205) |
| `bulk-send` | Agreements | Bulk Send | Send one document or template to a large recipient list, each receiving their own envelope. | web | Business Pro (Also IAM Professional and IAM for Enterprise; not IAM Starter/Standard) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://ecom.docusign.com/plans-and-pricing/iam) [3](https://www.docusign.com/products/electronic-signature/features) |
| `forms` | Platform | Web Forms / PowerForms | Web Forms: interactive forms with conditional logic that capture data and populate it into agreements for signature, also usable for data collection and reporting, with API pre-fill. PowerForms: self-service signing links. | web | Business Pro (IAM: IAM Professional and IAM for Enterprise only) | [1](https://www.docusign.com/products/web-forms) [2](https://ecom.docusign.com/plans-and-pricing/esignature) [3](https://ecom.docusign.com/plans-and-pricing/iam) |
| `payment-collection-in-documents` | Agreements | Payment collection (Docusign Payments, Stripe) | Collect a payment from the signer as part of signing, processed through Stripe or Docusign Payments. | web | Business Pro | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `signer-identity-verification` | Agreements | ID Verification / Docusign Identify | Signer authentication and verification: email access codes, SMS and phone OTP, knowledge-based authentication (US), government ID document check with liveness/biometrics, electronic IDs, CLEAR, digital identity wallets, and EU Qualified Electronic Signature / standards-based signatures (eIDAS). | web | Standard (Access codes all plans; 5 bonus ID verifications on Standard and Business Pro and 5 complimentary on IAM plans; SMS/phone auth, KBA and full ID verification contact sales (Enhanced)) | [1](https://www.docusign.com/products/identify) [2](https://ecom.docusign.com/plans-and-pricing/esignature) [3](https://www.docusign.com/products/electronic-signature/features) |
| `notary` | Agreements | Docusign Notary (remote online notary) | Remote online notarization over audio-video with ID proofing (photo ID and KBA), electronic journal, session recording and tamper-evident certificate; use in-house notaries or the on-demand OneNotary network (consumer notarization from $25). | web | Enhanced plans (Contact sales; aimed at organisations notarizing 200+ documents a year) | [1](https://www.docusign.com/products/notary) [2](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `document-generation` | Agreements | Document Generation / Agreement Preparation | Generate custom agreements from templates and data, dynamically inserting data so it reads native to the agreement; also a step inside Workflow Builder. | web | IAM Starter ("Advanced Document Generation" in all IAM plans; not listed in eSignature plan table) | [1](https://ecom.docusign.com/plans-and-pricing/iam) [2](https://www.docusign.com/products/agreement-preparation) [3](https://www.docusign.com/products/electronic-signature/features) |
| `agreement-repository` | Agreements | Agreement Manager (formerly Navigator) | AI-powered repository of executed agreements: Iris extracts key terms, dates and obligations; search, renewal and obligation tracking, access controls, dashboards and AI worksheets; import via APIs and connectors. | web, api | IAM Starter (All IAM plans: unlimited processing for new documents; not in eSignature-only plans) | [1](https://www.docusign.com/products/platform/navigator) [2](https://ecom.docusign.com/plans-and-pricing/iam) [3](https://community.docusign.com/tips-from-docusign-155/docusign-trainer-tips-use-docusign-workflow-builder-formerly-maestro-to-automate-agreement-workflows-26763) |
| `workflow-automation` | Platform | Workflow Builder (formerly Maestro) | No-code builder for end-to-end agreement workflows chaining ID verification, Web Forms, document generation, eSignature, agents, Agreement Desk and App Center extension steps, with templates; has its own API. eSignature also has agreement actions for post-signature automation. | web, api | IAM Starter (Workflow limits: IAM Starter 1, IAM Standard 3, IAM Professional 10, IAM for Enterprise 10) | [1](https://www.docusign.com/products/platform/maestro) [2](https://ecom.docusign.com/plans-and-pricing/iam) [3](https://community.docusign.com/tips-from-docusign-155/docusign-trainer-tips-use-docusign-workflow-builder-formerly-maestro-to-automate-agreement-workflows-26763) |
| `contract-lifecycle-management` | Agreements | Agreement Desk | Collaborative hub for agreement intake (requests by email become tracked tasks), review and finalization, with an audit trail of edits and approvals; sold within IAM (the separate CLM product is excluded). | web | not stated | [1](https://www.docusign.com/products/agreement-desk) [2](https://support.docusign.com/s/document-item?language=en_US&bundleId=msb1736279079453&topicId=fub1743087942169.html&_LANG=enus) |
| `approvals` | Platform | Agreement Desk approvals | Add approvals with approvers to an agreement request and route sign-offs to stakeholders automatically. | web | not stated | [1](https://support.docusign.com/s/document-item?language=en_US&bundleId=msb1736279079453&topicId=fub1743087942169.html&_LANG=enus) [2](https://www.docusign.com/products/agreement-desk) |
| `ai-assistant` | Platform | Docusign Iris (AI-Assisted Summary, Q&A, field suggestions) | Iris AI: AI-assisted agreement summary and Q&A for signers, agreement type detection and field suggestions for senders, risk-clause flagging and AI-assisted review, extraction in Agreement Manager. | web | not stated (AI extraction listed in all IAM plans; eSignature tier for summary/Q&A not stated) | [1](https://www.docusign.com/products/electronic-signature/features) [2](https://www.docusign.com/products/platform/ai) [3](https://ecom.docusign.com/plans-and-pricing/iam) |
| `ai-agents` | Platform | Iris agents | Ready-made agents (Intake & Triage, Smart Redlining, Relationship Intelligence) plus custom agents described in natural language; agents can run as Workflow Builder steps. | web | not stated (No plan stated on the public page) | [1](https://www.docusign.com/products/agents) [2](https://www.docusign.com/products/platform/ai) [3](https://www.docusign.com/products/platform/maestro) |
| `audit-log` | Platform | Real-time audit trail / Certificate of completion | Per-envelope audit trail and certificate of completion recording every action with timestamps and IP; audit trails also in Agreement Manager and Agreement Desk. | web | Personal | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) [3](https://workspace.google.com/marketplace/app/docusign_esignature_for_google_workspace/469176070494) |
| `security-activity-monitoring` | Platform | Docusign Monitor | Near real-time tracking of account activity across web, mobile and API (logins, password changes, envelope deletions) with pre-built and custom alerts, dark-web credential monitoring and a Monitor API for SIEM tools such as Splunk. | web, api | Enhanced plans (Add-on to IAM and eSignature plans; contact sales) | [1](https://www.docusign.com/products/monitor) [2](https://ecom.docusign.com/plans-and-pricing/esignature) [3](https://developers.docusign.com/docs/monitor-api/) |
| `compliance-security` | Platform | Trust and security (ISO 27001, SOC 2, HIPAA, FedRAMP, 21 CFR Part 11, data residency, retention) | Certifications and regulated-industry support, AES-256 encryption, data residency, document retention policies with automatic purge, managed stamps, eWitness. | web | Personal (Certifications on all plans; managed stamps and eWitness Business Pro; data residency, HIPAA BAA, FedRAMP, 21 CFR Part 11 and retention policies contact sales) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `users-teams` | Platform | Add multiple users / groups | Multiple users on one account with groups, shared documents and folders, custody transfer. | web | Standard (Personal is single user; Standard and Business Pro up to 50 users; Enhanced 50+) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `roles-permissions` | Platform | User and group permissions | Permission profiles for users and groups, recipient permissions per signer, document visibility, feature access controls. | web | Standard (Document visibility contact sales (Enhanced)) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `sso-identity` | Platform | Access management & SSO | SAML SSO through the customer's identity provider, domain claim, just-in-time provisioning and SCIM provisioning/deprovisioning. | web | IAM Professional (eSignature: contact sales (Enhanced); IAM: Professional and Enterprise, contact sales on Starter/Standard) | [1](https://ecom.docusign.com/plans-and-pricing/iam) [2](https://ecom.docusign.com/plans-and-pricing/esignature) [3](https://www.docusign.com/products/admin) |
| `admin-console` | Platform | Docusign Admin / Organization management | Central administration across accounts: organization management, account cloning, domain claim, delegated admin roles, bulk user actions by CSV, settings comparison, aggregated reporting; Admin API. | web, api | IAM Starter (Included in all IAM plans; add-on (Organization management, contact sales) on eSignature) | [1](https://www.docusign.com/products/admin) [2](https://ecom.docusign.com/plans-and-pricing/esignature) [3](https://developers.docusign.com/docs/admin-api/) |
| `reporting-dashboards` | Platform | Reporting / Team reports / Agreement Manager insights | Envelope, recipient and account reports with real-time status; team reports; Agreement Manager dashboards and worksheets; Web Forms response reporting. | web | Personal (Team reports Standard) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) [3](https://www.docusign.com/products/platform/navigator) |
| `data-import-export` | Platform | Data export / Download envelope information | Export report data to CSV and download envelope data; bring agreements into Agreement Manager via APIs and connectors; bulk user CSV import in Admin. | web | not stated | [1](https://www.docusign.com/products/electronic-signature/features) [2](https://www.docusign.com/products/platform/navigator) [3](https://www.docusign.com/products/admin) |
| `custom-fields-objects` | Platform | Envelope custom fields | Admin-defined custom metadata fields attached to envelopes. | web | Business Pro | [1](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `custom-branding` | Platform | Customized branding | Sender logo, colours and custom email domain applied to signing experience and notifications. | web | Standard | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) [3](https://www.docusign.com/products/admin) |
| `comments-mentions` | Platform | Collaborative commenting | Real-time comments between senders and signers on a document during signing. | web | Standard | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `notifications` | Platform | Notifications and reminders | Automatic email reminders and status notifications, scheduled sending, push notifications in the mobile app. | web, ios, android | Personal (Scheduled sending Standard) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) [3](https://apps.apple.com/us/app/docusign-upload-sign-docs/id474990205) |
| `sms-messaging` | Marketing | SMS and WhatsApp delivery | Deliver signing requests and notifications by SMS or WhatsApp in addition to email. | web | Standard (Standard includes 5 bonus SMS deliveries; Business Pro and above contact sales) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `multi-currency-localization` | Platform | Multiple languages (44+ signing) | Signing experience in 44 languages with global time-zone support. | web | Personal | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) |
| `file-storage` | Platform | Shared documents and folders | Store envelopes in folders shared among users, and pull documents from cloud storage. | web | Standard | [1](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `search` | Platform | Agreement Manager AI-powered search | Search across the agreement repository using AI-extracted terms. | web | IAM Starter | [1](https://www.docusign.com/products/platform/navigator) [2](https://ecom.docusign.com/plans-and-pricing/iam) |
| `mobile-app` | Platform | Docusign - Upload & Sign Docs | Native iPhone, iPad and Android app to sign, send, scan documents, use templates, sign in person and work offline, with push notifications and Face ID. | ios, android | Personal (Pricing table lists the mobile app on all plans) | [1](https://apps.apple.com/us/app/docusign-upload-sign-docs/id474990205) [2](https://play.google.com/store/apps/details?id=com.docusign.ink&hl=en_US) [3](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `api-webhooks` | Platform | eSignature REST API / Connect | REST API with OAuth 2 for envelopes, templates and embedded flows; Connect pushes real-time envelope status webhooks. Separate APIs for Web Forms, Maestro/Workflow Builder, Navigator/Agreement Manager, Connected Fields, Click, Admin, Rooms and Monitor. | api | Business Pro ("Industry-leading APIs" from Business Pro) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://www.docusign.com/products/electronic-signature/features) [3](https://developers.docusign.com/tools/openapi-files/) |
| `embedded-signing` | Agreements | Embedded signing | Signing and sending embedded inside a third-party website or app through the API. | api | Business Pro (Requires API access (Business Pro and above)) | [1](https://www.docusign.com/products/electronic-signature/features) [2](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `developer-platform` | Platform | Developer account / SDKs / MCP Server | Free developer account, OpenAPI files for generating SDKs, extension apps published to App Center, and the Docusign MCP Server (open beta) connecting agents such as Claude and Copilot to Docusign. | api | Business Pro (Developer account listed from Business Pro on the pricing table) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://developers.docusign.com/tools/openapi-files/) [3](https://developers.docusign.com/platform/mcp-server/) |
| `sandbox-environments` | Platform | Enterprise development sandbox / developer account | Separate demo/developer environment for building and testing integrations. | api | not stated | [1](https://www.docusign.com/products/electronic-signature/features) [2](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `app-marketplace` | Platform | Docusign App Center | Directory of connector and extension apps (Salesforce, Google, Microsoft, HubSpot, Stripe, Box, Dropbox, ServiceNow) including real-time data verification of signer input; apps plug into Workflow Builder. | web | IAM Starter (App Center and 1000+ integrations in all IAM plans; 1000+ partner integrations from Business Pro on eSignature) | [1](https://www.docusign.com/products/platform/app-center) [2](https://ecom.docusign.com/plans-and-pricing/iam) [3](https://ecom.docusign.com/plans-and-pricing/esignature) |
| `native-integrations` | Platform | Integrations (Google, Microsoft, Salesforce, Slack, Zoom) | Vendor-built connectors: cloud storage (Google Drive, OneDrive, Dropbox, Box), Google Workspace and Microsoft 365 add-ins (Gmail, Docs, Outlook, Word, Teams), Slack, Zoom, Stripe, Salesforce, Microsoft Dynamics, NetSuite. | web | Personal (Cloud storage and productivity all plans; Slack/Teams/Zoom/Stripe Standard; Salesforce/Dynamics/NetSuite contact sales) | [1](https://ecom.docusign.com/plans-and-pricing/esignature) [2](https://workspace.google.com/marketplace/app/docusign_esignature_for_google_workspace/469176070494) [3](https://www.docusign.com/integrations/microsoft) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | yes | yes |

The eSignature REST API exposes envelope metadata, recipients, custom fields, documents (combined PDF, ZIP archive with certificate of completion), audit events and templates, and listStatusChanges takes from_date/to_date with a 'Changed' qualifier; Connect webhooks push status events. 'full' is partial because documents are fetched per envelope under a 3,000/hour default account limit, the web app has no multi-envelope document download (the bulk tool Retrieve is described as a paid add-on in community/search results), and purged documents are gone for good.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Export Envelope Data (Export as CSV) | From the envelope list, select envelopes and export a CSV with envelope ID, subject, sender, date sent, status, decline/void info and recipient data (ID, name, email, action, routing order, status). | CSV | not stated | not stated | [1](https://support.docusign.com/s/document-item?language=en_US&bundleId=oeq1643226594604&topicId=abb1578456349675.html&_LANG=kokr) |
| Download Form Data | CSV with a row per field in the documents: envelope ID, recipient name and email, field name and entered value. | CSV | Per search snippet: not available for drafts or for documents sent to you by others | not stated | [1](https://support.docusign.com/s/document-item?language=en_US&bundleId=oeq1643226594604&topicId=nlu1579891674153.html&_LANG=jajp) |
| Docusign Retrieve | Tool that runs on the customer's system to download envelopes, documents and data in bulk as a one-time or recurring request, with configurable file type and storage location. | PDF, other (configurable file type) | Search results describe it as a paid add-on available to specific plans; no tier named on the features page fetched | not stated | [1](https://www.docusign.com/en-au/products/electronic-signature/features) [2](https://community.docusign.com/esignature-111/how-can-i-download-all-of-the-signed-documents-that-i-sent-in-bulk-do-we-have-a-unified-option-instead-than-one-per-envelope-1253) |
| Per-envelope document download (web app) | Envelope documents and certificate of completion downloaded envelope by envelope; search results state there is no web-app option to bulk download documents across envelopes. | PDF, ZIP | One envelope at a time in the web app | not stated | [1](https://community.docusign.com/esignature-111/how-can-i-download-all-of-the-signed-documents-that-i-sent-in-bulk-do-we-have-a-unified-option-instead-than-one-per-envelope-1253) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| eSignature REST API: Envelopes listStatusChanges | incremental | Search envelopes by from_date/to_date with from_to_status (default 'Changed'), status list, user, and include=custom_fields,documents,attachments,extensions,folders,recipients,payment_tabs; up to 1,000 envelopes per call with nextUri/previousUri paging; without from_date only the last two years are returned; production calls cannot cross sites (NA2, EU1, CA...), so each site must be queried separately. | [1](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/liststatuschanges/) |
| eSignature REST API: EnvelopeDocuments get | read-api | Download one document, or all via documentId keywords: combined (single PDF, optional certificate), archive (ZIP of all PDFs plus certificate of completion), certificate (certificate only), portfolio (PDF portfolio); PDF byte stream or base64. | [1](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopedocuments/get/) |
| eSignature REST API: Envelopes listAuditEvents | read-api | Gets the audit events for a specified envelope (one envelope per call). | [1](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/listauditevents/) |
| eSignature REST API: Templates list/get | read-api | Lists account templates (filterable by folder, owned/shared) with include=powerforms,documents,folders,favorite_template_status,advanced_templates; get returns a template definition. | [1](https://developers.docusign.com/docs/esign-rest-api/reference/templates/templates/list/) |
| Docusign Connect | webhooks-events | Account-level, user-level, envelope-level (eventNotification) and organization-level webhook configurations that POST XML or JSON to a public listener on envelope/recipient events (sent, delivered, completed, declined, voided, purge/delete, template modified/deleted, etc.); retries with exponential back-off; Connect messages do not count against API limits; preset configs can send documents to Box, OneDrive, Salesforce, eOriginal. | [1](https://developers.docusign.com/platform/webhooks/connect/) [2](https://developers.docusign.com/platform/webhooks/connect/event-triggers/) |
| Admin API user list export (createUserListExport / getUserListExport) | bulk-export | Asynchronous bulk export of an organization's users to CSV; requires Docusign Admin scopes; request then poll the export. | [1](https://developers.docusign.com/docs/admin-api/how-to/bulk-export-users/) |
| Agreement Manager API (formerly Navigator API) | read-api | Access to agreements and AI-extracted metadata (parties, dates, financial and renewal terms, clauses) in the Docusign agreement repository; getAgreementsList endpoint. Described as limited availability, enabled per account. | [1](https://www.docusign.com/blog/developers/navigator-api-bulk-ingestion-made-simple) |

### Auth for a third-party importer

**Models:** oauth-app, admin-consent

OAuth 2 with Public or Confidential Authorization Code Grant or JWT Grant (JWT impersonation needs user consent or organization admin consent; admin consent for external apps is granted by an org admin via an authorization URI and covers the org's users). Admin API needs Docusign Admin scopes. To use a production account the integration key must pass Go-Live review (OAuth configured, paid production account, admin access; public multi-customer integrations must join the partner program; manual reviews typically 24-48 hours).

Sources: [1](https://developers.docusign.com/platform/auth/consent/obtaining-admin-consent-external/) [2](https://developers.docusign.com/platform/go-live/) [3](https://developers.docusign.com/docs/admin-api/how-to/bulk-export-users/)

### Rate limits and quotas

By default at most 3,000 API requests per hour from all apps on an account (includes polling); burst limit 500 calls per 30 seconds; hourly eSignature limit can be raised via API limit management if prerequisites are met. Polling: GET of any specific URL no more than once every 15 minutes, and no polling of objects in a terminal state (e.g. completed/voided). Apps must honour rate-limit headers and stop until reset. Connect notifications are recommended instead of polling and do not count against limits.

Sources: [1](https://developers.docusign.com/platform/api-guidelines/) [2](https://developers.docusign.com/platform/webhooks/connect/)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| attachments-files | Signed documents come per envelope (combined/archive call per envelope); at 3,000 requests/hour default, a large archive takes many hours; the web app has no cross-envelope bulk download, and bulk export via Retrieve is an add-on. listStatusChanges cannot cross production sites, so multi-site accounts need separate calls per site. | [1](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopedocuments/get/) [2](https://developers.docusign.com/platform/api-guidelines/) [3](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/liststatuschanges/) |
| history-audit | Audit trail is per envelope (listAuditEvents) and the certificate of completion is a PDF per envelope; neither has a bulk endpoint in the pages checked, so each costs one or more calls per envelope against the hourly limit. The certificate is a PDF, not structured data. | [1](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/listauditevents/) [2](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopedocuments/get/) |
| other | Purged envelopes: Document Retention and Targeted Purge move documents to a purge queue and permanently remove documents and field data (event-triggers page: 'permanently removes documents and their field data from Docusign servers'; 14-day purge queue). An export must run before retention purges them. | [1](https://developers.docusign.com/platform/webhooks/connect/event-triggers/) [2](https://support.docusign.com/s/document-item?language=en_US&rsc_301=&bundleId=pik1583277475390&topicId=frq1583277404325.html&_LANG=enus) |
| other | listStatusChanges returns only the last two years unless from_date is set, and includes 'extraneous' envelopes for some status qualifiers, so an importer must re-check statuses client-side. | [1](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/liststatuschanges/) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Docusign Retrieve | out-of-vendor | Bulk download of envelopes, documents and data to an external storage location, one-time or recurring. | [1](https://www.docusign.com/en-au/products/electronic-signature/features) |
| Agreement Manager (Navigator) bulk ingestion | into-vendor | API jobs uploading historical agreements (up to 10,000 documents per job, 100MB per document) for AI extraction; limited availability. | [1](https://www.docusign.com/blog/developers/navigator-api-bulk-ingestion-made-simple) |

### Limits of the data-out scan

- support.docusign.com pages are JS-rendered and WebFetch returned only a loading state; Export Envelope Data, Download Form Data, Document Retention and Retrieve details come from search-result snippets and community threads, not the page text.
- developers.docusign.com is JS-rendered; its content was read from the Gatsby page-data JSON (developers.docusign.com/page-data/<path>/page-data.json) with curl.
- Plan tiers for CSV export, Retrieve, Connect and Document Retention were not confirmed; the features page fetched names no tiers.
- Agreement Manager/Navigator reference page-data returned 404; its details come from the Docusign developer blog, which said GA was planned for early 2026 (current status unconfirmed).
- Did not check Maestro/Web Forms/Rooms/CLM export or workflow-definition APIs; eSignature UI template download/upload (JSON) was not confirmed from a fetched source.
- No injected instructions noticed in fetched content.

| Kind | What | Result |
|---|---|---|
| fetch | https://developers.docusign.com/platform/account/rate-limits/ | 404 (guessed URL) |
| fetch | https://developers.docusign.com/platform/api-guidelines/ (HTML) | JS shell only; used page-data JSON instead |
| fetch | https://developers.docusign.com/page-data/docs/esign-rest-api/reference/envelopes/audit-events/listauditevents/page-data.json | 404 (wrong path; correct path fetched) |
| fetch | https://developers.docusign.com/page-data/docs/navigator-api/page-data.json and .../navigator/agreements/getagreementslist/page-data.json | 404 |
| fetch | https://support.docusign.com/s/document-item?...topicId=abb1578456349675.html | JS loading shell, no content |

## Limits of this scan

- developers.docusign.com pages (home, eSignature API reference, rules-and-limits, OpenAPI files) returned only the page title to the fetcher (JS-rendered); API resource lists and rate limits are not captured, and API surfaces are listed only where a product page or search snippet shows an API.
- Google Play listing fetch returned no usable content; the Android app is sourced from a search result snippet.
- The IAM pricing page does not use the names Navigator or Maestro; the renames to Agreement Manager and Workflow Builder come from a Docusign community post and search snippets, and the /navigator and /maestro URLs now serve the renamed pages.
- Pricing tables were read through a summarising fetcher; individual cells (especially IAM tiers for Document Generation, ID verification counts) should be spot-checked in a browser.
- One fetch summary of the eSignature API overview appeared to echo the prompt's own list of resources and was not used as a source.
- Tiers for Iris AI summary/Q&A, agents, Agreement Desk and Notary beyond 'contact sales' are not stated publicly.
- No injected instructions were seen in fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://www.docusign.com/products-and-pricing | 301 redirect to ecom.docusign.com/plans-and-pricing/esignature (followed) |
| fetch | https://www.docusign.com/products/identity | 404; used /products/identify |
| fetch | https://www.docusign.com/products/platform/monitor | 404; used /products/monitor |
| fetch | https://www.docusign.com/products/platform/admin | 404; used /products/admin |
| fetch | https://developers.docusign.com/ | title only (JS-rendered) |
| fetch | https://developers.docusign.com/docs/esign-rest-api/reference/ | title only (JS-rendered) |
| fetch | https://developers.docusign.com/tools/openapi-files/ | title only (JS-rendered); API list taken from search snippet |
| fetch | https://developers.docusign.com/docs/esign-rest-api/esign101/rules-and-limits/ | title only (JS-rendered) |
| fetch | https://play.google.com/store/apps/details?id=com.docusign.ink | empty/truncated content |
