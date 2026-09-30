# Zendesk (TGT-08): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

40 capability areas (40 confirmed from sources, 0 unconfirmed). Generated from `zendesk.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

Zendesk for customer service: Zendesk Support and Zendesk Suite (ticketing, messaging and live chat, voice, help center/knowledge and community, AI agents, Copilot, Explore analytics, platform/APIs), and the add-ons Zendesk WFM, Zendesk QA and Zendesk Contact Center.

Left out of this scan:

- Zendesk Sell (sales CRM): a separate product with its own APIs
- Zendesk Employee Service (the internal help desk, priced separately from $29), including its service catalog and IT Asset Management
- Forethought AI agents: named as a partnership on the pricing page, not scanned

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | Zendesk Agent Workspace / Admin Center | Browser | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/service/messaging/) |
| ios | Zendesk Support | iOS | [1](https://support.zendesk.com/hc/en-us/articles/4408846407066-About-the-Zendesk-Support-mobile-app) |
| android | Zendesk Support | Android | [1](https://support.zendesk.com/hc/en-us/articles/4408846407066-About-the-Zendesk-Support-mobile-app) [2](https://play.google.com/store/apps/details?id=com.zendesk.android&hl=en) |
| other | Web Widget and Zendesk SDKs for iOS, Android and Unity (end-user messaging inside a customer's site or app) | Web, iOS, Android, Unity | [1](https://developer.zendesk.com/api-reference/) [2](https://www.zendesk.com/service/messaging/) |

## Public API

**Style:** REST (JSON) plus webhooks; the Apps framework and Zendesk Integration Services (ZIS); Sunshine Conversations messaging API; embeddable SDKs

OAuth access tokens are recommended; API tokens and basic auth are deprecated. Support and Help Center APIs are limited per minute by plan: Suite Team 200, Growth and Professional 400, Enterprise 700, Enterprise Plus 2500. The High Volume add-on raises that to 2500.

Sources: [1](https://developer.zendesk.com/api-reference/) [2](https://developer.zendesk.com/api-reference/introduction/rate-limits/) [3](https://developer.zendesk.com/api-reference/introduction/security-and-auth/)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `ticketing` | Service | Ticketing (Zendesk Support) | Email and ticketing system where customer requests from every channel become tickets that agents work in the Agent Workspace; also available on the Support mobile app. | web, ios, android, api | Support Team | [1](https://www.zendesk.com/pricing/) [2](https://developer.zendesk.com/api-reference/) [3](https://support.zendesk.com/hc/en-us/articles/4408846407066-About-the-Zendesk-Support-mobile-app) |
| `omnichannel-routing` | Service | Omnichannel routing / skills-based routing | Routes tickets, messaging conversations and calls to agents by availability and capacity; skills-based routing is added on higher plans. | web, api | Suite Team (Basic ticket routing on Support Team; skills-based routing from Suite Professional) | [1](https://www.zendesk.com/pricing/) [2](https://developer.zendesk.com/api-reference/) |
| `live-chat-messaging` | Service | Messaging and live chat | Real-time and asynchronous conversational messaging through the Web Widget and iOS/Android/Unity mobile SDKs, handled in the Agent Workspace. | web, api | Suite Team | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/service/messaging/) [3](https://developer.zendesk.com/api-reference/) |
| `sms-messaging` | Marketing | Social messaging (WhatsApp and others) | Messaging extends to WhatsApp, Facebook Messenger, Instagram and Apple Messages for Business; SMS specifically was not confirmed on the pages fetched. | web | not stated | [1](https://www.zendesk.com/service/messaging/) |
| `phone-calling` | Meetings | Zendesk Voice (Telephony) | Built-in telephony: toll-free and international numbers, IVR phone tree, queues and overflow routing, callbacks, voicemail, extensions, call recording, warm transfer and barging. | web, api | Suite Team (IVR phone tree from Suite Professional) | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/service/voice/) [3](https://developer.zendesk.com/api-reference/) |
| `contact-center` | Meetings | Zendesk Contact Center | A contact-centre add-on with business units, holiday and emergency closures, voicemail-as-tickets and back-office direct routing. | web | not stated (Add-on, $83/agent/month on the pricing page) | [1](https://www.zendesk.com/pricing/) [2](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `transcription-captions` | Meetings | Call transcription and summarisation | Automatic transcription and summaries of voice calls; generative AI for voice is listed on Suite Enterprise. | web | not stated (Generative AI for Voice listed under Suite Enterprise; plan for basic transcription not stated) | [1](https://www.zendesk.com/service/voice/) [2](https://www.zendesk.com/pricing/) |
| `knowledge-base` | Service | Help center / Knowledge | Customer-facing help centre and knowledge base with generative search (quick answers), knowledge surfaced in the agent workspace, web crawler and knowledge connectors. | web, api | Suite Team | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/service/help-center/) [3](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `community-forums` | Service | Help center community | Community posts and topics inside the help centre where customers ask questions, answer and share ideas; moderators can pin and feature posts. | web, api | Suite Professional (Help-centre article lists community forums at Professional) | [1](https://support.zendesk.com/hc/en-us/articles/4408846875034-About-the-Zendesk-Suite-plan-types) [2](https://support.zendesk.com/hc/en-us/articles/4408882689306-Planning-and-activating-community-in-your-help-center) |
| `customer-portal` | CRM | Help center request list | Signed-in end users see and filter their own requests in the help centre (new request list experience, generally available March 2026). | web | not stated | [1](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `sla-management` | Service | SLA policies | Policies with conditions and response/resolution targets measured on tickets. | web | Suite Growth (Help-centre plan name; Support: Professional or Enterprise) | [1](https://support.zendesk.com/hc/en-us/articles/4408829459866-Defining-SLA-policies) |
| `csat-surveys` | Service | CSAT surveys | Customer satisfaction surveys on solved tickets across email and messaging with customisable questions and rating scales. | web | Suite Growth (Help-centre plan name; Support: Professional or Enterprise) | [1](https://support.zendesk.com/hc/en-us/articles/7689997846554-Sending-a-CSAT-survey-to-your-customers) |
| `macros-canned-responses` | Service | Macros (pre-written responses) | Saved replies and ticket actions agents apply in one step. | web | Support Team | [1](https://www.zendesk.com/pricing/) |
| `workflow-automation` | Platform | Triggers, automations and Action Builder | Business rules (triggers and automations) on tickets, plus Action Builder, a no-code flow builder for multi-system workflows. | web, api | Support Team (Action Builder from Suite Team) | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/platform/) |
| `approvals` | Platform | Approval workflows | Approval steps in service workflows. | web | Suite Enterprise | [1](https://www.zendesk.com/pricing/) |
| `forms` | Platform | Multiple ticket forms and conditional fields | Several ticket forms with conditional ticket fields for customers and agents. | web, api | Suite Professional (Help-centre plan name 'Professional') | [1](https://support.zendesk.com/hc/en-us/articles/6579939982746-Getting-started-with-Zendesk-Suite-Part-14-Additional-features) |
| `custom-fields-objects` | Platform | Custom objects and custom fields | Admin-defined custom objects with schemas, lookup relationships and templates (Contracts, Orders, Products, Projects, Subscriptions) usable in tickets, triggers and Explore; legacy custom objects sunset July 2026. | web, api | Suite Team (Support plans: Enterprise only) | [1](https://support.zendesk.com/hc/en-us/articles/5392409465370-Creating-custom-objects-to-integrate-with-custom-data) [2](https://developer.zendesk.com/api-reference/) |
| `ai-agents` | Platform | Zendesk AI agents | Autonomous agents that resolve inquiries over messaging, email and voice and take actions in connected systems; value-based pricing with an included resolution allowance. | web, api | Suite Team (Resolution allowance included; more is pre-purchased; AI agents - Advanced / AI Expert tiers exist) | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/service/ai/ai-agents/) [3](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `ai-assistant` | Platform | Copilot (auto assist, intelligent triage, admin copilot, writing tools) | Agent-side AI: suggested next steps and drafted replies, classification by intent/sentiment/language, admin recommendations, and generative writing tools. | web | Suite Professional (Writing tools and Admin Copilot on Suite Professional; full Copilot is a $50/agent/month add-on, bundled in 'Suite Enterprise + Copilot') | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/service/ai/copilot/) [3](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `reporting-dashboards` | Platform | Explore analytics | Prebuilt dashboards on all plans, live dashboards, and custom reports on Professional and above; a newer analyst copilot answers plain-language questions. | web | Support Team (Prebuilt dashboards on Support Team; Quick Reports on Suite Professional; custom reports need Explore Professional or Enterprise) | [1](https://www.zendesk.com/pricing/) [2](https://support.zendesk.com/hc/en-us/articles/4408846844826-Understanding-Explore-dashboards) [3](https://www.zendesk.com/service/analytics/) |
| `workforce-management` | Service | Zendesk WFM | AI forecasting, automated scheduling, time off and real-time and historical agent-activity monitoring. | web, api | not stated (Add-on $25/agent/month, or $50 in the Workforce Engagement bundle with QA) | [1](https://support.zendesk.com/hc/en-us/articles/6851584037146-Buying-Zendesk-workforce-engagement-management-add-ons-Zendesk-WFM-Zendesk-QA-and-WEM-bundle) [2](https://www.zendesk.com/service/workforce-engagement-management/) [3](https://developer.zendesk.com/api-reference/) |
| `quality-assurance` | Service | Zendesk QA | AI-scored review of all conversations, from human and AI agents alike, with risk detection and coaching. | web | not stated (Add-on $35/agent/month, or in the WEM bundle) | [1](https://support.zendesk.com/hc/en-us/articles/6851584037146-Buying-Zendesk-workforce-engagement-management-add-ons-Zendesk-WFM-Zendesk-QA-and-WEM-bundle) [2](https://www.zendesk.com/service/workforce-engagement-management/) |
| `roles-permissions` | Platform | Custom agent roles and light agents | Custom agent roles with granular permissions such as audit-log access, plus light agents who can view and add private comments. | web | Suite Enterprise (Light agents from Professional per the help centre; custom roles Enterprise) | [1](https://www.zendesk.com/pricing/) [2](https://support.zendesk.com/hc/en-us/articles/6579939982746-Getting-started-with-Zendesk-Suite-Part-14-Additional-features) [3](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `sso-identity` | Platform | Single sign-on (SAML, JWT, OpenID Connect) | Enterprise SSO for agents and end users through SAML, JWT or OIDC, with several configurations and IP-based routing. | web | Support Team (Help centre: all Suite and Support plans) | [1](https://support.zendesk.com/hc/en-us/articles/4408887505690-Enabling-SAML-single-sign-on) |
| `audit-log` | Platform | Audit log and access log | Admin Center audit log of account changes, which can be filtered and exported to CSV; an access log comes with the Advanced Data Privacy and Protection add-on. | web | Suite Enterprise (Help centre says 'Enterprise plans and above'; access log needs the ADPP add-on) | [1](https://support.zendesk.com/hc/en-us/articles/4408828001434-Viewing-the-audit-log-for-changes-to-your-account) [2](https://support.zendesk.com/hc/en-us/articles/6066010357530-Using-the-access-log-to-monitor-agent-activity-ADPP-add-on) |
| `compliance-security` | Platform | Data center locality, advanced compliance, redaction | Encryption, flexible data hosting locations, automated data deletion, sensitive-data redaction; Enterprise Plus adds enhanced disaster recovery. | web | Suite Professional (Help-centre plan name; data locality and advanced compliance from Professional) | [1](https://support.zendesk.com/hc/en-us/articles/6579939982746-Getting-started-with-Zendesk-Suite-Part-14-Additional-features) [2](https://www.zendesk.com/platform/) |
| `sandbox-environments` | Platform | Sandbox | A separate test copy of the account for trying workflows; also offered for AI agents - Advanced. | web | Suite Enterprise (Add-on for plans that do not include it) | [1](https://www.zendesk.com/pricing/) [2](https://support.zendesk.com/hc/en-us/articles/6579939982746-Getting-started-with-Zendesk-Suite-Part-14-Additional-features) [3](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `low-code-builder` | Platform | App Builder | Builds custom apps for the agent workspace with little code. | web | Suite Professional | [1](https://www.zendesk.com/pricing/) [2](https://www.zendesk.com/platform/) |
| `developer-platform` | Platform | Apps framework, Zendesk Integration Services, SDKs | Apps framework (ZAF) for sidebar apps, Zendesk Integration Services (ZIS), Web Widget and Android/iOS/Unity SDKs. | api | not stated | [1](https://developer.zendesk.com/api-reference/) [2](https://www.zendesk.com/platform/) |
| `api-webhooks` | Platform | Zendesk APIs and webhooks | REST APIs for ticketing, help center, conversations, voice, custom data, omnichannel, AI agents and WFM, plus webhooks; rate limits by plan. | api | Support Team (Rate limit rises with plan; High Volume API add-on) | [1](https://developer.zendesk.com/api-reference/) [2](https://developer.zendesk.com/api-reference/introduction/rate-limits/) |
| `app-marketplace` | Platform | Zendesk Marketplace | Directory of installable apps and integrations for Support and Chat. | web | Support Team | [1](https://support.zendesk.com/hc/en-us/articles/4408824421146-Using-the-Zendesk-Marketplace) |
| `native-integrations` | Platform | Knowledge connectors and Copilot actions | Connectors to Google Drive, Confluence and SharePoint for knowledge; Copilot actions in Shopify, Jira and Slack; Google Workspace connectors. | web | not stated | [1](https://www.zendesk.com/service/help-center/) [2](https://www.zendesk.com/service/ai/copilot/) [3](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `mobile-app` | Platform | Zendesk Support mobile app | iOS and Android app for agents and team leads to view, filter, create and update tickets. | ios, android | Support Team (Article lists Support Team, Professional, Enterprise) | [1](https://support.zendesk.com/hc/en-us/articles/4408846407066-About-the-Zendesk-Support-mobile-app) [2](https://play.google.com/store/apps/details?id=com.zendesk.android&hl=en) |
| `search` | Platform | Ticket and help-centre search | Keyword search for tickets on web and mobile, and generative search over the help centre. | web, ios, android | not stated | [1](https://support.zendesk.com/hc/en-us/articles/4408846407066-About-the-Zendesk-Support-mobile-app) [2](https://www.zendesk.com/service/help-center/) |
| `notifications` | Platform | Ticket notifications | Ticket alerts in the Support mobile app, kept for 30 days. | ios, android | not stated | [1](https://support.zendesk.com/hc/en-us/articles/4408846407066-About-the-Zendesk-Support-mobile-app) |
| `admin-console` | Platform | Admin Center | Central admin for security, SSO, logs, objects and rules, billing, and in-product purchase of the Copilot add-on. | web | not stated | [1](https://support.zendesk.com/hc/en-us/articles/4408887505690-Enabling-SAML-single-sign-on) [2](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `contacts` | CRM | Users (end users) | Customer records with context shown beside tickets, managed through the Support API's users resource. | web, api | Support Team | [1](https://www.zendesk.com/pricing/) [2](https://developer.zendesk.com/api-reference/) |
| `organizations` | CRM | Organizations | Organization records that group users and their tickets. | web, api | not stated | [1](https://developer.zendesk.com/api-reference/) |
| `multi-brand` | Service | Multibrand | Several brands, each with its own help centre and channels, in one account; custom objects can relate to brands. | web | Suite Professional (Help-centre plan name 'Professional') | [1](https://support.zendesk.com/hc/en-us/articles/6579939982746-Getting-started-with-Zendesk-Suite-Part-14-Additional-features) [2](https://support.zendesk.com/hc/en-us/articles/10356997021850-What-s-new-in-Zendesk-March-2026) |
| `side-conversations` | Service | Side conversations | Separate threads started from a ticket to work with other teams or third parties; email ones can be viewed and answered in the mobile app. | web, ios, android | Suite Professional (Help-centre plan name 'Professional') | [1](https://support.zendesk.com/hc/en-us/articles/6579939982746-Getting-started-with-Zendesk-Suite-Part-14-Additional-features) [2](https://support.zendesk.com/hc/en-us/articles/4408825697434-Working-with-tickets-in-the-Support-mobile-app) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | yes | yes |

Tickets (with comments), users and organizations come out via the Admin Center JSON/CSV/XML export (off by default, account owner must ask Support to enable it, Professional/Growth+) and via the Incremental Exports API with cursor or start_time and deleted-ticket markers, plus a ticket event stream. 'partial' because config objects need separate list endpoints, reporting data cannot be migrated per Zendesk, and UI exports drop comments on tickets over 1 MB.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Full JSON export | Tickets, users, or organizations as NDJSON for a chosen date range (by system-generated timestamp); ticket comments included unless a single ticket exceeds 1 MB, in which case comments are omitted and the ticket is listed in an error file. Organization exports include deleted organizations. Items updated within 6 minutes of the request are excluded. | JSON (NDJSON) | Recommended for accounts over 200,000 tickets; accounts over one million tickets are downloaded in 31-day increments; not available in sandbox; export must first be enabled by Zendesk Support at the account owner's request; download link valid for at least three days; may take minutes to a day or more. No frequency limit stated on the page. | Suite Growth, or Support Professional | [1](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) |
| CSV export | Ticket data (IDs, requester, assignee, group, subject, tags, status, dates, metrics columns) for a date range. Excludes deleted tickets, ticket comments and descriptions, multi-line text, multi-select and custom date fields; tickets over 1 MB are excluded. Dates converted to the account time zone. | CSV | Not available in sandbox; same enablement requirement as JSON export. | Suite Growth, or Support Professional | [1](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) |
| Full XML export / User XML export | Full XML: account settings, groups, organizations, tickets (including comments) and users. User XML: groups, organizations, users. No date range or data-type selection. Per the page, XML omits custom ticket fields, metric sets and comment metadata for tickets, and custom fields for users and organizations. | XML | Capped at 500 MB (roughly 200,000 tickets) per the page. | Suite Growth, or Support Professional | [1](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) |
| Export View (CSV) | GET /api/v2/views/{view_id}/export returns the CSV of a view, enqueuing a job to produce it if necessary. Allowed for agents. | CSV | Rate-limits page lists Exporting Views at 100000 requests per hour. | not stated | [1](https://developer.zendesk.com/api-reference/ticketing/business-rules/views/) [2](https://developer.zendesk.com/api-reference/introduction/rate-limits/) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| Incremental Ticket Export (cursor-based and time-based) | incremental | GET /api/v2/incremental/tickets/cursor (start_time once, then cursor) or /incremental/tickets (start_time/end_time). Returns tickets changed since the start time, up to 1,000 per page, end_of_stream flag, include sideloads (not last_audits), exclude_deleted option; deletions appear in the stream by default. Data for the most recent minute is not returned. Admins only. Cursor-based is 'highly encouraged'. | [1](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) |
| Incremental Ticket Event Export | incremental | GET /api/v2/incremental/ticket_events?start_time= returns a stream of ticket changes, each with the fields updated in that change; comment bodies only with the comment_events sideload (otherwise only comment_present/comment_public booleans). Recommended by Zendesk for change data instead of List All Ticket Audits. | [1](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) [2](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/) |
| Incremental User / Organization / Ticket Metric Event / Custom Object Record / Article exports | incremental | Users (cursor and time-based), organizations (time-based), ticket metric events, custom object records (cursor-based, documented under Custom Objects) and Help Center articles (/api/v2/help_center/incremental/articles.json?start_time=) are listed on the Incremental Exports page. A sample export endpoint returns up to 50 results for testing. | [1](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) [2](https://developer.zendesk.com/api-reference/help_center/help-center-api/articles/) |
| Ticket Audits | read-api | Read-only history of every ticket update (field changes, comments, tags, notifications). List All Ticket Audits excludes archived tickets (use List Audits for a Ticket for those) and Zendesk says it should not be used for change data because records are skipped when chasing the cursor tail. Requires the global 'read' OAuth scope. | [1](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/) |
| Attachments | read-api | Attachment objects carry content_url (may be hosted externally), size, malware_scan_result and deleted flags; files flagged as malware cannot be downloaded unless malware_access_override is true. Get Ticket Attachment Content is listed at 2500 requests per minute. | [1](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket-attachments/) [2](https://developer.zendesk.com/api-reference/introduction/rate-limits/) |
| Business rules list endpoints (macros, triggers, automations, views, SLA policies, etc.) | read-api | List Macros (admins get all macros including agents' personal ones) and List Ticket Triggers are available, cursor-paginated, max 100 per page; Zendesk's migration article says views, macros, groups, triggers, automations, SLAs, schedules, ticket forms and ticket/user/organization fields each need their own list endpoints. | [1](https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/) [2](https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/) [3](https://support.zendesk.com/hc/en-us/articles/4408887037082-How-do-I-merge-or-migrate-two-Zendesk-accounts) |
| Webhooks (Zendesk event subscriptions) | webhooks-events | Webhooks send HTTP requests on Zendesk activity, either subscribed to event types (article, community post, organization, user, agent availability, ticket, messaging, access log events, payload type zen:event-type:...) or connected to triggers/automations via conditional_ticket_events. Signing secret for verification. Trial accounts limited to 10 webhooks. | [1](https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/) [2](https://developer.zendesk.com/api-reference/webhooks/event-types/webhook-event-types/) |

### Auth for a third-party importer

**Models:** oauth-app, api-key, basic

OAuth access tokens are the supported method; API tokens are marked deprecated and customers on basic auth or API tokens 'will have to migrate' to OAuth. An app used by multiple Zendesk customers must use a global OAuth client, which developers cannot create themselves: build with a local OAuth client (identifier prefixed 'zdg-', all fields completed), then request it from Zendesk, which may approve it and may restrict its allowed scopes. The Developer Terms prohibit customers sharing API credentials with third parties. Incremental exports and audits are admin-only; audits need the global 'read' scope.

Sources: [1](https://developer.zendesk.com/api-reference/introduction/security-and-auth/) [2](https://developer.zendesk.com/documentation/marketplace/building-a-marketplace-app/set-up-a-global-oauth-client/) [3](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/)

### Rate limits and quotas

Support and Help Center API requests per minute by Suite plan: Team 200, Growth 400, Professional 400, Enterprise 700, Enterprise Plus 2500 (Help Center counted separately from Support). High Volume API add-on raises a qualifying plan to 2500/min (Suite Growth+ or Support Professional+, minimum 10 agent seats). Incremental Exports: 10 requests per minute global, 30 with High Volume add-on (users cursor export listed at 20, 60 with add-on). List Tickets with page over 500: 50/min. Export Search Results 100/min. Up to 30 queued or running background jobs.

Sources: [1](https://developer.zendesk.com/api-reference/introduction/rate-limits/) [2](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| other | Reporting/analytics data: Zendesk says migrating reporting data between accounts is not supported; only the underlying ticket data moves. | [1](https://support.zendesk.com/hc/en-us/articles/4408887037082-How-do-I-merge-or-migrate-two-Zendesk-accounts) |
| history-audit | Full ticket history is split: incremental ticket export does not support the last_audits sideload; the event stream omits comment bodies unless comment_events is sideloaded; List All Ticket Audits skips archived tickets and records when used for change data. Ticket metrics (first reply, first resolution) are not carried over when importing tickets into a new account. | [1](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) [2](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/) [3](https://support.zendesk.com/hc/en-us/articles/6696005837082-How-can-I-migrate-information-from-another-platform-into-Zendesk) |
| attachments-files | The UI data-export article does not mention attachments; files are fetched per attachment via content_url (possibly externally hosted), malware-flagged files are blocked by default, and redacted attachments become an empty redacted.txt. | [1](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) [2](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket-attachments/) |
| custom-objects-fields | UI exports lose custom data: CSV drops multi-line, multi-select and custom date fields; XML drops custom ticket fields, metric sets and comment metadata, and user/org custom fields. JSON export omits comments for tickets over 1 MB. | [1](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) |
| automations-workflows | Macros, triggers, automations, views, SLAs, schedules and forms are API-readable but not in the UI exports; each needs its own list endpoint per Zendesk's migration article. No triggers run on imported tickets. | [1](https://support.zendesk.com/hc/en-us/articles/4408887037082-How-do-I-merge-or-migrate-two-Zendesk-accounts) [2](https://support.zendesk.com/hc/en-us/articles/6696005837082-How-can-I-migrate-information-from-another-platform-into-Zendesk) |
| permissions | Data exports are disabled by default and only enabled by Zendesk Support at the account owner's request; exports can additionally be restricted to certain admins. Incremental export endpoints are admin-only. | [1](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) [2](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Self-service API migration (Incremental Export API + Ticket Import API) | both | Zendesk's documented route for moving data between accounts: export with incremental exports, import with the Ticket Import API; bulk user and organization import also documented. | [1](https://support.zendesk.com/hc/en-us/articles/4408887037082-How-do-I-merge-or-migrate-two-Zendesk-accounts) [2](https://support.zendesk.com/hc/en-us/articles/6696005837082-How-can-I-migrate-information-from-another-platform-into-Zendesk) |
| Zendesk partners / Zendesk Professional Services | unknown | Paid partner or Zendesk Services data migration, arranged through the account executive; Marketplace third-party apps also suggested. | [1](https://support.zendesk.com/hc/en-us/articles/4408887037082-How-do-I-merge-or-migrate-two-Zendesk-accounts) |
| Help Desk Migration (third party) | both | Third-party migration service with Zendesk migration guides; seen in search results only, not fetched. | [1](https://help-desk-migration.com/help/zendesk-migration-guides/) |

### Limits of the data-out scan

- No frequency limit for the Admin Center exports is stated on the export article; none recorded.
- Admin Center export plan tiers were read from the article's 'What's my plan?' box; the team-member export and 'Restricting data exports to certain admins' articles were not fetched.
- Help Center article export via UI not found; only the incremental article API was confirmed.
- Whether automations, SLA policies, schedules and other config endpoints match the macros/triggers pattern was taken from the migration article, not from each endpoint page.
- Developer pages were read by curl and HTML text extraction; no injected instructions were noticed.
- Third-party migration tools (Help Desk Migration, Import2) seen only in search results.

## Limits of this scan

- The full plan comparison table on zendesk.com/pricing is JS-rendered; only the headline features for each plan came through, and /pricing/compare/ returned 404. The tiers here come from the pricing page headlines and the plan-availability lines in help articles.
- Plan names differ between sources. The pricing page shows Support Team, Suite Team, Suite Professional and 'Suite Enterprise + Copilot'. Help articles also list Suite Growth and Enterprise Plus. Where only a help article gave the tier, it is reported as 'Suite Growth', 'Suite Professional' and so on, with a note.
- The Apple App Store listing returned 404 (the ID was a guess) and the Google Play fetch came back empty. Both mobile platforms are confirmed from the Zendesk help article and a Google Play search-result entry.
- zendesk.com/marketplace returned 403, so the app count is unknown.
- Sunshine platform branding was not seen on the pages fetched. The platform page describes APIs, the app framework, App Builder and Action Builder without that name.
- No injected instructions were found in the fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://www.zendesk.com/pricing/compare/ | 404 |
| fetch | https://apps.apple.com/us/app/zendesk-support/id368796011 | 404 |
| fetch | https://play.google.com/store/apps/details?id=com.zendesk.android | empty/unusable content |
| fetch | https://www.zendesk.com/marketplace/ | 403 |
| fetch | https://www.zendesk.com/pricing/?plans=suite | feature matrix not rendered (JS) |
