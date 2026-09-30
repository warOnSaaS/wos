# Salesforce (TGT-01): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

52 capability areas (51 confirmed from sources, 1 unconfirmed). Generated from `salesforce.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

Sales Cloud across the editions on the public pricing page (Free Suite, Starter Suite, Pro Suite, Core, Advanced, Max) and the core Salesforce Platform it runs on: objects, Flow, Lightning App Builder, reports, security, AgentExchange, APIs, and Agentforce as it applies to sales.

Left out of this scan:

- Service Cloud (Customer Service Management, Contact Center, Field Service) - separate cloud; only the case and knowledge rows bundled in Sales Cloud editions are noted
- Field Service - part of Service, separate product
- Marketing Cloud / Marketing Cloud Next - separate cloud; only the Starter/Pro Suite email marketing is noted
- Commerce Cloud (B2C Commerce, B2B Commerce, Order Management, Point of Sale) - separate cloud
- Data 360 (Data Cloud) as a separate product - only the bundled data sync features are noted
- Tableau / Tableau Next / CRM Analytics as separate products - only what Sales Cloud editions bundle
- MuleSoft - separate integration product
- Slack as a product - only its bundling with Sales Cloud is noted
- Industries clouds (Automotive, Communications, Consumer Goods, Education and others) - vertical products
- Experience Cloud / Websites & Custom Apps as a separate product - PRM noted only as an add-on
- Revenue Cloud / Revenue Lifecycle Management and CPQ in depth - add-on; noted only under quotes
- Heroku, Informatica, Net Zero Cloud - separate products

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | Salesforce (Lightning Experience) | not stated | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| ios | Salesforce | iPhone, iPad, Mac, Apple Vision | [1](https://apps.apple.com/us/app/salesforce/id404249815) |
| android | Salesforce | Android | [1](https://play.google.com/store/apps/details?id=com.salesforce.chatter) |
| email_addin | Outlook integration | Outlook desktop and Outlook on the web | [1](https://help.salesforce.com/s/articleView?language=en_US&id=email_int_overview.htm&type=5) |
| browser_extension | Gmail integration (Salesforce Chrome extension) | Chrome | [1](https://help.salesforce.com/s/articleView?language=en_US&id=sales.app_for_gmail_user_install.htm&type=5) |
| browser_extension | CRM Extension (Sales Cloud Everywhere) | not stated | [1](https://www.salesforce.com/sales/engagement-platform/) |
| desktop | Data Loader | not stated | [1](https://help.salesforce.com/s/articleView?id=xcloud.import_with_data_import_wizard.htm&language=en_US&type=5) |

## Public API

**Style:** REST (JSON) and SOAP, plus Bulk API 2.0, GraphQL, Metadata and Tooling APIs, and gRPC Pub/Sub API for platform and Change Data Capture events

Help lists REST, SOAP, Connect REST, Apex REST/SOAP, Analytics REST, User Interface, GraphQL, Tooling, Bulk 2.0, Metadata and Pub/Sub APIs, authenticated by OAuth 2.0 or session ID. Web Services API is included from Core and costs $25 USD/user/month extra on Pro Suite. Rate limits not captured in this scan.

Sources: [1](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5) [2](https://www.salesforce.com/editions-pricing/sales-cloud/) [3](https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/bulk_api_2_0.htm)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `leads` | CRM | Lead Management | Lead records with capture, assignment and routing rules; Starter Suite adds built-in sales flows for lead routing. | web, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5) |
| `contacts` | CRM | Account and Contact Management | Contact records linked to accounts with activity history. | web, ios, android, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://apps.apple.com/us/app/salesforce/id404249815) |
| `organizations` | CRM | Accounts / Person Accounts | Account (company) records that group contacts, opportunities and activity; Person Accounts model individual consumers. | web, api | Free Suite (Person Accounts from Pro Suite) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `pipelines-deals` | CRM | Opportunity Management | Opportunities through a customizable sales process, with Sales Teams, Opportunity Splits, Pipeline Inspection, Deal Insights and waterfall charts on higher editions. | web, api | Free Suite (Sales Teams, Opportunity Splits, Pipeline Inspection, Deal Insights from Core) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `forecasting` | CRM | Collaborative Forecasts / Advanced Forecast & Pipeline Management | Forecasts rolled up by role or territory with adjustments, embedded forecast charts and a forecasting mobile app; Predictive and Consumption Forecasting on higher editions. | web, ios, android | Pro Suite (Pro Suite card lists 'Sales Quoting and Forecasting'; the 'Advanced Forecast & Pipeline Management' row starts at Core; Predictive Forecasting purchasable on Core, included Advanced) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=000334120&language=en_US&type=1) |
| `territory-management` | CRM | Sales Territories (Enterprise Territory Management) | Model sales territories that map reps to accounts; territory hierarchy can drive forecast rollups. | web | Core | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=000387713&language=en_US&type=1) |
| `quotes-cpq` | CRM | Quotes / Revenue Cloud (CPQ) | Basic quotes built from products and price books; full configure-price-quote is the separate Revenue Cloud add-on; Agentforce can create quotes from natural language. | web, api | Pro Suite (CPQ via Revenue Cloud add-on, from $200 USD/user/month) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/ai-sales-agent/) |
| `products-price-books` | CRM | Products and Price Books | A product catalogue with price books used on opportunities and quotes. | web, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `contracts-renewals` | CRM | Contracts and Orders | Contract records for approvals and renewals, plus sales order records. | web, api | Pro Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `lead-scoring` | CRM | Lead Scoring / Opportunity Scoring | Predictive scoring that ranks leads and opportunities by likelihood to convert, showing the factors behind each score. | web | Core (Lead Scoring purchasable on Core, included Advanced and Max; Opportunity Scoring included from Core) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `sales-sequences` | CRM | Sales Cadences (Sales Engagement) | Step-by-step cadences of email, call and social tasks that guide reps through prospecting, built in Cadence Builder. | web | not stated (Sales Engagement add-on listed at $50 USD/user/month; pricing table does not name the lowest edition) | [1](https://www.salesforce.com/sales/engagement-platform/) [2](https://help.salesforce.com/s/articleView?language=en_US&id=sales.se_cadences_builder_2.htm&type=5) |
| `sales-engagement-tools` | CRM | Email Productivity / Sales Engagement | Email tracking, send-later, dynamic meeting scheduling, a unified to-do list, Sales Workspace seller homepage and the CRM Extension for working from the web. | web | Free Suite (Email Productivity from Free Suite; Sales Workspace from Core) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/engagement-platform/) |
| `conversation-intelligence` | CRM | Conversation Intelligence (Einstein Conversation Insights) / Call Summaries | Logs and transcribes sales calls, extracts action items, keywords, competitor and pricing mentions, and supports coaching playlists; AI call summaries. | web | Core (Call Summaries purchasable on Core/Advanced, included Max) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/engagement-platform/) |
| `email-calendar-sync` | Platform | Outlook and Gmail Integration / Activity Capture | Work with Salesforce records inside Outlook and Gmail, log emails and events, and automatically capture and sync email and calendar activity. | web, desktop | Free Suite (Activity Capture from Starter Suite; Inbox features need an Inbox license) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?language=en_US&id=email_int_overview.htm&type=5) [3](https://help.salesforce.com/s/articleView?language=en_US&id=sales.app_for_gmail_user_install.htm&type=5) |
| `email-sending` | Marketing | Mass Email / List Email | Send emails to targeted lists of leads or contacts and track who received them. | web | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `email-marketing` | Marketing | Dynamic Email Marketing and Analytics | Marketing email with analytics bundled in Starter Suite and Pro Suite (the SMB suites that include marketing). | web | Starter Suite (Full marketing platform is Marketing Cloud, out of scope) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `campaigns-attribution` | Marketing | Campaign Management / Campaign Influence | Campaign records and attribution of opportunities to multiple campaigns. | web, api | Free Suite (Campaign Influence from Pro Suite (3 campaigns per opportunity; 5 from Core)) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `forms` | Platform | Web-to-Lead Capture | Website forms that create lead records from visitor submissions. | web | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `data-quality-dedup` | Platform | Duplicate Blocking / Validation Rules | Duplicate rules that prevent duplicate records, and validation rules enforced on save and import. | web | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=xcloud.import_with_data_import_wizard.htm&language=en_US&type=5) |
| `tasks` | Platform | To Do List / Task Management | Tasks with owners and due dates and a seller to-do list. | web, ios, android, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://apps.apple.com/us/app/salesforce/id404249815) |
| `activities` | CRM | Activity Feed / Activity Timeline | Logged calls, emails, events and tasks on each record's activity feed. | web, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `comments-mentions` | Platform | Chatter | Feeds, posts and @mentions on records for internal collaboration and with outside parties. | web, api | Pro Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5) |
| `file-storage` | Platform | Files | Upload and share files on deals and records; file storage per user. | web, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5) |
| `templates` | Platform | Email Templates | Reusable email templates for sales outreach. | web | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/engagement-platform/) |
| `calendar-scheduling` | Platform | Salesforce Meetings / Meeting Scheduling | Meeting prep view of attendees and next steps; dynamic meeting-scheduling links in Email Productivity. | web | Pro Suite (Meeting-scheduling links in Email Productivity from Free Suite) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/engagement-platform/) |
| `reporting-dashboards` | Platform | Customizable Reports and Dashboards / Tableau Next | Report builder and dashboards on CRM data; advanced reporting features and Tableau Next agentic analytics on higher editions. | web, ios, android, api | Free Suite (Advanced Reporting Features and Tableau Next from Core) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://apps.apple.com/us/app/salesforce/id404249815) [3](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5) |
| `workflow-automation` | Platform | Flow Builder | Point-and-click flows that automate business processes; Flow Orchestration for multi-step processes. | web | Pro Suite (Pro Suite limited to 5 flows per org; Flow Orchestration is a paid add-on on all editions) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/platform/integration-automation/) |
| `approvals` | Platform | Approval Processes | Route records to approvers. | web | Core | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `low-code-builder` | Platform | Lightning App Builder | Build custom pages and apps with clicks; Mobile App Builder for mobile. | web | Pro Suite (Unlimited Custom Applications from Pro Suite) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/platform/enterprise-app-development/) |
| `custom-fields-objects` | Platform | Custom Objects / Record Types | Custom fields and objects that extend the data model, with record types per object to tailor processes and picklists. | web, api | Free Suite (Record Types per object from Free Suite; custom object limits per edition not on the pricing page) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=xcloud.import_with_data_import_wizard.htm&language=en_US&type=5) |
| `developer-platform` | Platform | Lightning Platform (Apex, Lightning Web Components, Salesforce CLI, DevOps Center) | Pro-code customisation with Apex (a Java-like language), Lightning Web Components and the Salesforce CLI for Salesforce DX projects. | web, api | Core (Pricing lists 'Lightning Platform' from Core) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_apex_developer_guide.pdf) [3](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_develop_create_lwc.htm) |
| `sandbox-environments` | Platform | Sandboxes | Developer, Developer Pro, Partial and Full sandbox copies of production for building and testing; Data Mask & Seed for sandbox data. | web | Pro Suite (Developer Sandbox from Pro Suite; 1 Partial from Core; 1 Full included from Advanced (purchasable on Core)) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/platform/enterprise-app-development/) |
| `roles-permissions` | Platform | Roles and Permissions / Profiles and Page Layouts | Roles, profiles and permissions for object and field access; agents inherit user permissions and field-level security. | web, api | Free Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `sso-identity` | Platform | Single Sign-On / Multi-Factor Authentication | SAML SSO with Salesforce as service or identity provider, and MFA required for employee logins including SSO. | web | not stated | [1](https://help.salesforce.com/s/articleView?id=xcloud.sso_about.htm&language=en_US&type=5) [2](https://help.salesforce.com/s/articleView?language=en_US&id=xcloud.mfa_sso_logins.htm&type=5) |
| `audit-log` | Platform | Setup Audit Trail / Field Audit Trail / Event Monitoring | Setup Audit Trail tracks admin setup changes; Shield adds Field Audit Trail (long-term field history) and Event Monitoring (user and API activity logs). | web | not stated (Field Audit Trail and Event Monitoring are part of Salesforce Shield) | [1](https://help.salesforce.com/s/articleView?id=sf.admin_monitorsetup.htm&amp=&language=en_US&amp=&type=5) [2](https://www.salesforce.com/platform/shield/guide/) |
| `compliance-security` | Platform | Shield / Security Center / Trusted Services | Shield Platform Encryption (at rest, BYOK), Data Detect, Security Center health checks across orgs, and Backup & Recover and Archive. | web | Advanced (Backup & Recover, Archive, Data Detect, Security Center included from Advanced (Security Center purchasable lower); Shield sold separately) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/platform/shield/guide/) |
| `data-import-export` | Platform | Data Import Wizard / Data Loader | Import standard and custom object records from files with the Data Import Wizard; Data Loader for bulk insert, update, upsert, delete and export. | web, desktop, api | not stated | [1](https://help.salesforce.com/s/articleView?id=xcloud.import_with_data_import_wizard.htm&language=en_US&type=5) [2](https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/bulk_api_2_0.htm) |
| `api-webhooks` | Platform | Web Services API | REST, SOAP, Bulk API 2.0, GraphQL, Metadata, Tooling, User Interface and Connect REST APIs, plus Pub/Sub API for platform and Change Data Capture events. | api | Core (Available on Pro Suite for an additional $25 USD/user/month) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://help.salesforce.com/s/articleView?id=platform.integrate_what_is_api.htm&language=en_US&type=5) [3](https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/bulk_api_2_0.htm) |
| `app-marketplace` | Platform | AgentExchange (formerly AppExchange) | Directory of partner apps and agents that install into the org. | web | Pro Suite | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/platform/integration-automation/) |
| `native-integrations` | Platform | Slack / Salesforce in Slack | Slack plan bundled by edition, with Salesforce records and Agentforce in Slack. | web | Free Suite (Slack Free on Free-Pro Suite; Slack Business+ on Core and Advanced; Slack Enterprise+ on Max) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/ai-sales-agent/) |
| `mobile-app` | Platform | Salesforce Mobile App | Native iPhone, iPad, Vision Pro and Android app with mobile home, records, dashboards and offline use. | ios, android | Starter Suite (Full offline mobile functionality from Pro Suite; Forecasting Mobile App from Pro Suite) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://apps.apple.com/us/app/salesforce/id404249815) [3](https://play.google.com/store/apps/details?id=com.salesforce.chatter) |
| `notifications` | Platform | Notification Builder / push notifications | Custom push notifications in the mobile app, powered by Notification Builder. | ios, android | not stated | [1](https://apps.apple.com/us/app/salesforce/id404249815) [2](https://play.google.com/store/apps/details?id=com.salesforce.chatter) |
| `ai-assistant` | Platform | Agentforce for Sales (built-in AI) | Generative AI inside Sales Cloud: drafts sales emails from CRM and call data, summarises calls, and researches accounts. | web | Core (Agentforce: Sales Emails from Core; Account Research from Advanced; Agentforce for Sales add-on from $125 USD/user/month) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/ai-sales-agent/) |
| `ai-agents` | Platform | Agentforce Sales Agents | Prebuilt agents for prospecting, lead nurture, pipeline updates (suggestive or autonomous), sales coaching and quoting, grounded in CRM data. | web | Core (Most agents purchasable on Core and Advanced, all included in Max; consumes Flex Credits) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) [2](https://www.salesforce.com/sales/ai-sales-agent/) |
| `customer-data-platform` | Marketing | Data Synchronization & Harmonization (Data Cloud / Data 360) | Connect Salesforce and external data through Data Cloud features bundled in Sales Cloud. | web | Core (Limited Data Cloud features on Pro Suite; Data 360 as a product is out of scope) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `partner-management` | CRM | Partner Relationship Management | Partner-facing experiences to drive channel revenue. | web | not stated (Add-on, from $10 USD/login/month) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `ticketing` | Service | Case Management | Basic case records included in Sales Cloud editions. | web | Free Suite (Full service desk is Service Cloud, out of scope) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `knowledge-base` | Service | Knowledge | Knowledge articles; read-only on Pro Suite to Advanced. | web | Free Suite (Read/Write on Free/Starter/Max; Read-only on Pro Suite, Core and Advanced) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `sales-performance-management` | CRM | Sales Performance Management (Sales Planning, Incentive Compensation / Spiff) | Plan territories and quotas and manage incentive compensation native to the CRM. | web | Max (Purchasable from Starter Suite; all included in Max) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `sales-enablement` | CRM | Sales Programs | Outcome-based seller enablement in the flow of work. | web | Advanced (Add-on from $100 USD/user/month on lower editions) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `maps-route-planning` | CRM | Salesforce Maps | Map-based territory and route planning for field sellers. | web | Max (Maps Advanced purchasable on lower editions) | [1](https://www.salesforce.com/editions-pricing/sales-cloud/) |
| `multi-currency-localization` | Platform | Multiple Currencies | **Unconfirmed** (Only an indirect mention ('Rules for Importing Multiple Currencies') in a search snippet; help centre pages would not render for a direct check). Multiple currencies on records. | web | not stated | [1](https://help.salesforce.com/s/articleView?id=xcloud.import_with_data_import_wizard.htm&language=en_US&type=5) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| yes | yes | yes |

Record data for all objects, including custom objects, can be pulled by Bulk API 2.0 query jobs (up to 1 TB of results per rolling 24 hours) or Data Loader, and the Data Export Service produces CSV backups that can include attachments and Salesforce Files. For deltas there are REST sObject Get Updated (30 days back) and Get Deleted (15 days back) resources, SystemModstamp-filtered SOQL, and Change Data Capture events kept for three days. Limits: CDC covers 5 entities without an add-on license, API access on Professional Edition must be enabled, and field history, audit trail and some metadata types have their own limits (see hardToExtract).

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Data Export Service (Export Backup Data) | Setup page that generates a CSV backup of org data, as zip files, with options to include images, documents and attachments, and Salesforce Files and CRM Content document versions. Salesforce's own Data Loader guide sends users here to export attachments. | CSV | Per search-result snippets (the help page did not render): manual export once every 7 days (weekly) or 29 days (monthly); Professional and Developer Edition only every 29 days / monthly schedule; files deleted 48 hours after they are ready. Not verified against rendered help text. | not stated | [1](https://help.salesforce.com/s/articleView?language=en_US&id=sf.admin_exportdata.htm&type=5) [2](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf) |
| Data Loader | Salesforce's desktop client (macOS/Windows, with a command line on Windows only) for bulk import and export of any object, including custom objects. Exports produce CSV files. 'Export All' also includes archived activities and soft-deleted records. It cannot export attachments. It supports up to 150 million records with Bulk API 2.0. | CSV | Up to 150,000,000 records per CSV; exporting attachments is not supported (the guide points to the weekly export instead). | Guide lists Enterprise, Performance, Unlimited and Developer editions | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| Bulk API 2.0 (query / queryAll jobs) | bulk-export | Asynchronous SOQL query jobs returning CSV, chunked automatically (PK chunking) for custom objects and for the Sharing and History tables of standard objects. queryAll also returns merged or deleted records and archived Task/Event records. It does not support GROUP BY/OFFSET/TYPEOF, aggregates, compound address or geolocation fields, or parent-to-child subqueries. Results can be fetched for 7 days, paged with locator and maxRecords. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_asynch.pdf) [2](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_app_limits_cheatsheet.pdf) |
| REST API sObject Get Updated / Get Deleted (SOAP getUpdated()/getDeleted()) | incremental | Returns the IDs of records added or changed (Get Updated, v31.0+) or deleted (Get Deleted, v29.0+) for an object within a date range, which the docs say is for data replication. Updated reaches back at most 30 days and Deleted at most 15 days (less if the Recycle Bin was purged, and the delete log can be trimmed). Each call returns at most 600,000 IDs (EXCEEDED_ID_LIMIT). Full replication needs View All Data. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf) |
| Change Data Capture (via Pub/Sub API or CometD) | webhooks-events | Publishes create, update, delete and undelete change events for selected standard and custom objects. The header carries changedFields, nulledFields, commitTimestamp and transactionKey. Events stay on the event bus for three days and can be replayed by ReplayId. There are gap and overflow events, and the docs say some events may, in rare cases, never be persisted or delivered. Available in Enterprise, Performance, Unlimited and Developer; up to 5 entities without an add-on license. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_change_data_capture.pdf) |
| REST API sObject Blob Get | read-api | Retrieves binary content for blob fields on Attachment, ContentNote, ContentVersion, Document, Folder and Note. It takes one request per record and cannot be used inside Composite requests. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf) |
| Metadata API (retrieve) | other | Retrieves configuration (objects, fields, flows, profiles and so on) as a zip of XML components listed in package.xml. Retrieves are capped at 10,000 files and about 39 MB compressed per call, and some metadata types are not supported at all. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf) |

### Auth for a third-party importer

**Models:** oauth-app

REST access is authorised by OAuth 2.0 through an External Client App or a Connected App configured in the customer's org. Creating new connected apps is restricted as of Spring '26 (existing ones keep working) and Salesforce recommends external client apps. Replicating all data needs a user with View All Data, and results follow sharing rules.

Sources: [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf)

### Rate limits and quotas

Daily API calls per org, pooled across all users: Developer Edition 15,000. Enterprise and Professional with API access enabled: 100,000 + 1,000 per Salesforce license + purchased add-ons. Unlimited and Performance: 100,000 + 5,000 per Salesforce license + add-ons. Full Sandbox: 5,000,000. These count REST, SOAP, Bulk API and Bulk API 2.0 calls. Paid orgs can briefly exceed the limit up to a hard cap. Long-running (20 s or more) concurrent requests: 25 in production and sandboxes, 5 in Developer and trial orgs. Bulk API 2.0: 10,000 query jobs and 1 TB of query results per rolling 24 hours; 15,000 ingest batches per 24 hours, shared with Bulk API 1.0. Metadata API: 10,000 files and about 39 MB per retrieve.

Sources: [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_app_limits_cheatsheet.pdf) [2](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| history-audit | Field History Tracking keeps 18–24 months of data (up to 20 fields per object). Keeping it until deleted requires Field Audit Trail (Shield or a Field Audit Trail license, Enterprise and up), which stores it in the FieldHistoryArchive big object, readable by API only. Setup Audit Trail is reported as kept for 180 days, per a third-party search snippet that was not verified. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/field_history_retention.pdf) [2](https://gearset.com/blog/salesforce-audit-trail/) |
| attachments-files | Data Loader cannot export attachments. Binary content comes either from the Data Export Service zip (include-attachments and include-files options) or from one REST Blob Get call per record, each of which counts against the daily API allocation. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf) [2](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf) |
| metadata-config | Some features' metadata types are not available in Metadata API and 'can't be retrieved or deployed'; they have to be recreated by hand (see the Metadata Coverage Report). Retrieves are capped at 10,000 files and about 39 MB compressed, and some types have daily retrieve limits. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf) |
| other | Deletions are only traceable for 15 days through Get Deleted/queryAll, and the delete log can be purged earlier. CDC keeps only three days of events, covers 5 entities without an add-on, and the docs say some events may be lost. A delta sync therefore needs a periodic full reconciliation. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf) [2](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_change_data_capture.pdf) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Data Loader | both | Official bulk import/export client. Its guide also covers migrating attachments between orgs by using the export's Attachment.csv. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf) |
| Data Import Wizard | into-vendor | In-app wizard for loads under 50,000 records into supported objects, with duplicate prevention. | [1](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_data_loader.pdf) |
| Data Export Service | out-of-vendor | Scheduled or manual CSV backup of org data, with optional attachments and files. | [1](https://help.salesforce.com/s/articleView?language=en_US&id=sf.admin_exportdata.htm&type=5) |

### Limits of the data-out scan

- developer.salesforce.com returned 403 to both WebFetch and curl, and help.salesforce.com renders by JavaScript, so neither WebFetch nor curl got article text. Facts were read instead from the official static PDF guides on resources.docs.salesforce.com ('latest', Winter '27 v68.0, updated 2026-09-11).
- Data Export Service frequency, the 48-hour download window and edition rules come only from search-result summaries, not rendered Salesforce text.
- Setup Audit Trail's 180-day retention comes only from a third-party search snippet (gearset.com).
- The CDC event-delivery allocation numbers and Pub/Sub API limits were not captured.
- Whether Professional Edition includes API access by default was not confirmed here. The limits guide says 'Professional Edition with API access enabled', and the Data Loader and CDC guides list Enterprise, Performance, Unlimited and Developer editions only.
- Whether Bulk API 2.0 query can return base64/blob fields was not confirmed.
- No injected instructions were noticed in fetched content.

| Kind | What | Result |
|---|---|---|
| fetch | https://help.salesforce.com/s/articleView?id=sf.admin_exportdata.htm&type=5 | JS-rendered shell only (WebFetch and curl) |
| fetch | https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm | HTTP 403 (WebFetch and curl) |
| fetch | resources.docs.salesforce.com PDFs salesforce_data_export / salesforce_import_export / salesforce_field_history_retention | 404 (guessed names) |

## Limits of this scan

- Pricing matrix read from the structured data embedded in the edition page (per-feature edition flags), not from the rendered table; a WebFetch summary of the same page returned wrong cells (e.g. API on Free Suite), so only the embedded data was used.
- Public pricing now shows Free Suite, Starter Suite, Pro Suite, Core, Advanced and Max; no standalone Enterprise, Unlimited or Agentforce 1 editions appear (Unlimited is mentioned only as bundling Premier Success). Help articles still use the older edition names, so their edition lines were not used for tiers.
- help.salesforce.com articles mostly failed to render through the fetch tool (CSS error / loading screen); help URLs cited are search results whose snippets were seen, except the 'Which API Do I Use?' article which did render.
- developer.salesforce.com returned 403 / an error page to direct fetches, including /docs/llms.txt; developer docs are cited from search results only.
- Rate limits, per-edition custom object limits, global search and admin Setup were not scanned.
- No injected instructions seen in fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://developer.salesforce.com/docs/apis | HTTP 403 |
| fetch | https://developer.salesforce.com/docs/llms.txt | error page |
| fetch | https://help.salesforce.com/s/articleView?id=sales.cadences_overview.htm&type=5 | loading screen / CSS error, no content |
| fetch | https://help.salesforce.com/s/articleView?id=sales.forecasts3_intro.htm&type=5 | loading screen / CSS error, no content |
| fetch | https://help.salesforce.com/s/articleView?id=platform.admin_monitorsetup.htm&type=5 | loading screen / CSS error, no content |
| fetch | https://help.salesforce.com/s/articleView?language=en_US&id=sales.se_cadences_builder_2.htm&type=5 | loading screen / CSS error, no content |
| fetch | https://play.google.com/store/apps/details?id=com.salesforce.chatter (WebFetch) | summariser got truncated content; title and description read from raw HTML instead |
