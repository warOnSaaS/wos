# QuickBooks (TGT-06): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

41 capability areas (41 confirmed from sources, 0 unconfirmed). Generated from `quickbooks.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

QuickBooks Online US plans as the pricing page names them (Free, Simple Start, Essentials, Plus, Advanced) plus the add-ons sold with them: Payroll (Workforce bundles), QuickBooks Payments, QuickBooks Time, and the QBO mobile and desktop apps.

Left out of this scan:

- QuickBooks Desktop (Pro/Premier/Enterprise): separate installed product
- Intuit Enterprise Suite: separate mid-market product, mentioned only where QBO pages pair it with Advanced
- QuickBooks Solopreneur / Self-Employed: separate product
- Intuit Accountant Suite: firm product; QBO Accountant noted only as accountant access
- Intuit Expert / Live Bookkeeping and Full Service Bookkeeping: human services, not software
- Non-US QuickBooks editions (CA, UK, AU, global)

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | QuickBooks Online | browser | [1](https://quickbooks.intuit.com/pricing/) |
| ios | Intuit QuickBooks for Business | iPhone, iPad and Apple Watch | [1](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) |
| android | Intuit QuickBooks for Business (listed as QuickBooks Online Accounting in some regions) | Android | [1](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) |
| desktop | QuickBooks Online desktop app | Windows; macOS (Apple silicon and Intel) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/download-products/download-use-quickbooks-online-advanced-desktop/L9BrRPlDD_US_en_US) |
| other | Workforce app (QuickBooks Time / Payroll employee app) | not stated | [1](https://quickbooks.intuit.com/time-tracking/pricing/) |

## Public API

**Style:** REST (JSON) plus webhooks, Change Data Capture and batch operations

QuickBooks Online Accounting API on developer.intuit.com. Webhooks notify of changes to subscribed entities; CDC returns entities changed since a date-time; a batch request holds up to 30 payloads. Auth (OAuth 2.0) and the throttling limits are documented but the pages could not be read, so they are not confirmed here.

Sources: [1](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks) [2](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/batch) [3](https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features) [4](https://help.developer.intuit.com/s/article/API-call-limits-and-throttling)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `general-ledger` | Finance | Track income and expenses / books | Double-entry books of record for the company: income, expenses and accounts that feed every report; the pricing page lists income and expense tracking on every plan including Free. | web | Free | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/) |
| `bank-feeds-reconciliation` | Finance | Connect bank account, bank rules, Book reconciliation | Bank and card connections pull transactions into a For review list; up to 2,000 bank rules auto-categorise them, and accounts are reconciled against statements. Pricing lists an AI-assisted book reconciliation on Plus. | web, ios, android | Free (Free connects 1 bank; AI reconciliation and auto-verification listed from Plus) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/set-bank-rules-categorize-online-banking-online/L0mjJl0nD_US_en_US) [3](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) |
| `invoicing` | Finance | Invoices and estimates | Create and send invoices from templates, and estimates that customers can sign on mobile and that convert into invoices; bulk invoice creation (AI) from Essentials and batch invoices on Advanced. | web, ios, android | Free (Free is limited to 2 invoices a month (unlimited with Payments)) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/) [3](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) |
| `accounts-receivable` | Finance | Get paid faster / Payments AI | Tracks invoice status and payments received; Payments AI analyses customer payment behaviour, drafts reminders and gives cash-flow visibility to raise collection rates. | web | Essentials (Payments AI is listed from Essentials) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/payments-agent/) |
| `accounts-payable` | Finance | Bill pay | Record vendor bills and pay them by ACH from QuickBooks; approval workflows for bills on Advanced; Bill Pay Elite is a separate add-on tier. | web | Simple Start (approval workflows on Advanced; Bill Pay Elite add-on) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/) [3](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/user-roles-access-rights-quickbooks-online/L66POfRrI_US_en_US) |
| `expense-management` | Finance | Expense tracking and receipt capture | Categorise expenses (AI categorisation from Simple Start) and snap receipts on mobile; QuickBooks reads merchant, date and amount and matches them to bank transactions. An Expense Submitter role lets staff submit expenses. | web, ios, android | Simple Start (expense categorisation listed from Simple Start) | [1](https://quickbooks.intuit.com/pricing/) [2](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) [3](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) |
| `mileage-tracking` | Finance | Mileage tracking | Automatic GPS trip tracking in the mobile app with swipe classification of business vs personal trips, to claim vehicle deductions; QuickBooks Time Elite also tracks employee mileage. | ios, android | not stated | [1](https://quickbooks.intuit.com/accounting/mileage/) [2](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) [3](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) |
| `payments-acceptance` | Finance | QuickBooks Payments | Accept cards, ACH, Apple Pay, PayPal/Venmo and Affirm on invoices and payment links, and in person via tap to pay on iPhone (card reader on Android); payments post automatically to QuickBooks Online, with instant deposit. | web, ios, android | not stated (sold as an add-on service with per-transaction fees) | [1](https://quickbooks.intuit.com/payments/) [2](https://quickbooks.intuit.com/pricing/) |
| `subscriptions-recurring-billing` | Commerce | Recurring transactions / recurring payments | Recurring invoices and other transactions that are recorded automatically, as reminders or as unscheduled templates; QuickBooks Payments can charge customers on a schedule. | web | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_US_en_US) [2](https://quickbooks.intuit.com/payments/) |
| `payroll` | Finance | QuickBooks Payroll (Workforce Payroll / Workforce Premium) | Payroll add-on bundled with a QBO plan: auto payroll, tax filing, next- or same-day direct deposit, benefits and workers' comp access; Payroll AI can collect employee info and run payroll. | web | not stated (add-on; bundles named Workforce Payroll + Simple Start/Essentials and Workforce Premium + Plus) | [1](https://quickbooks.intuit.com/payroll/pricing/) [2](https://quickbooks.intuit.com/pricing/) [3](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/overview-agents-quickbooks-online/L9irCAtK4_US_en_US) |
| `hr-people` | Operations | HR tools (Workforce) | HR tools included in the payroll bundles (basic on Workforce Payroll, advanced on Workforce Premium) and an HR Manager user role. | web | not stated (payroll add-on only) | [1](https://quickbooks.intuit.com/payroll/pricing/) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/user-roles-access-rights-quickbooks-online/L66POfRrI_US_en_US) |
| `time-tracking` | Finance | QuickBooks Time | Employee time tracking on a mobile Workforce app or kiosk, shift and job scheduling, time off, and timesheets flowing to invoices and payroll; Time Elite adds project tracking and budget vs actual hours. Requires a QuickBooks Online account. | web | not stated (separate add-on (Time Premium, Time Elite) or included in Workforce Premium + Plus; pricing lists 'employee time to invoices' from Essentials) | [1](https://quickbooks.intuit.com/time-tracking/pricing/) [2](https://quickbooks.intuit.com/payroll/pricing/) [3](https://quickbooks.intuit.com/pricing/) |
| `sales-tax` | Finance | Automated sales tax / Sales Tax AI | Calculates sales tax from state rules, tracks liabilities and records or e-files returns in some states; Sales Tax AI categorises items and checks returns for discrepancies before filing. | web | not stated (Sales Tax AI discrepancy checks listed from Plus) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/sales-taxes/set-use-automated-sales-tax-quickbooks-online/L4Lx8eL7V_US_en_US) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-sales-taxes/file-sales-tax-return-record-tax-payment-online/L7ZeSlAr1_US_en_US) [3](https://quickbooks.intuit.com/pricing/) |
| `tax-1099-compliance` | Finance | 1099 e-filing | Prepare and e-file 1099-NEC and 1099-MISC for contractors from data in the account; Advanced adds free 1099 e-filing with approval workflows. | web | not stated (1099 e-filing with approval workflows listed on Advanced) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/form-1099-nec/create-file-1099s-using-quickbooks-online/L2BapEpb1_US_en_US) [2](https://quickbooks.intuit.com/pricing/) |
| `financial-reports` | Finance | Reports (P&L and more) | Profit and loss on every plan, with enhanced reports from Essentials and comprehensive reports from Plus; mobile apps show real-time reports. | web, ios, android | Free (report depth rises by plan) | [1](https://quickbooks.intuit.com/pricing/) [2](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) [3](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) |
| `reporting-dashboards` | Platform | Custom KPI dashboards | Personalised dashboards with custom KPIs and metrics; unlimited custom KPIs on Advanced. | web | Advanced | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/advanced/) |
| `budgeting-planning` | Finance | Budgets, scenario planning, cash flow | Budget planning from Plus, with a chat to model scenarios and save them as budgets (beta); cash flow projections in the mobile app; Finance AI summarises performance for planning on Advanced. | web, ios | Plus | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/) [3](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) |
| `project-accounting` | Finance | Projects / project profitability | Track profitability per project from Plus; Advanced adds Project Management AI that auto-creates projects and allocates costs, advanced project financials and construction job costing. | web | Plus | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/advanced/) [3](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/overview-agents-quickbooks-online/L9irCAtK4_US_en_US) |
| `inventory-management` | Commerce | Inventory | Track quantities and costs of inventory items. | web | Plus | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/) |
| `purchasing-procurement` | Finance | Purchase orders | Create and send purchase orders to vendors and attach accepted POs to bills, expenses or checks. | web | Plus (help article: Plus and Advanced only) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/purchase-orders/create-send-purchase-orders-quickbooks-online/L2mVpjOoq_US_en_US) |
| `tracking-dimensions` | Finance | Classes and locations | Tag transactions with classes and locations to report by department, site or segment. | web | Plus (40 classes/locations on Plus; unlimited on Advanced) | [1](https://quickbooks.intuit.com/pricing/) |
| `revenue-recognition` | Finance | Revenue recognition | Automated revenue recognition schedules per product or service that post deferred revenue without spreadsheets. | web | Advanced | [1](https://quickbooks.intuit.com/online/advanced/revenue-recognition/) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-standards/set-revenue-recognition-schedule-quickbooks-online/L0edAQ1Eg_US_en_US) |
| `fixed-assets` | Finance | Fixed assets | Automates fixed asset acquisition, depreciation and disposal. | web | Advanced | [1](https://quickbooks.intuit.com/global/resources/accountants/quickbooks-online-advanced-fixed-assets/) |
| `multi-currency-localization` | Platform | Multicurrency | Invoice and bill in foreign currencies with automatically updated exchange rates. | web | Essentials (help article: Essentials, Plus and Advanced; not Simple Start) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US) |
| `users-teams` | Platform | Users | Invite users into the company; billable user limits of 1 (Free, Simple Start), 3 (Essentials), 5 (Plus) and 25 (Advanced), plus non-billable roles. | web | Free | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/user-roles-access-rights-quickbooks-online/L66POfRrI_US_en_US) |
| `roles-permissions` | Platform | User roles / custom roles | Preset roles (Standard all access, In-house accountant, Bookkeeper, AR/AP manager, Sales/Expense/Inventory/Project manager, reports-only, time-only and more); custom roles with area and action-level permissions on Advanced. | web | not stated (custom roles on Advanced only) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/user-roles-access-rights-quickbooks-online/L66POfRrI_US_en_US) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/add-manage-custom-roles-quickbooks-online-advanced/L8Ugph7xl_US_en_US) [3](https://quickbooks.intuit.com/pricing/) |
| `audit-log` | Platform | Audit log | Records sign-ins, settings changes, list edits, transactions and payroll submissions, kept for two years, viewable by clients and accountants. | web | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/audit-log/use-audit-log-quickbooks-online/L2WoVnW6I_US_en_US) |
| `custom-fields-objects` | Platform | Custom fields | Custom fields on sales forms, purchase orders, expenses and customer and vendor profiles; enhanced custom fields (up to 12 active per form or profile type) need Advanced. | web | not stated (enhanced custom fields require Advanced) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/purchase-orders/create-edit-custom-fields-quickbooks-online/L56PQNif3_US_en_US) |
| `workflow-automation` | Platform | Workflow automation | Automate invoicing reminders, approvals and everyday workflows. | web | Advanced | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/advanced/) |
| `approvals` | Platform | Approval workflows | Approval workflows for bill pay and for 1099 e-filing, with Bill Approver/Clerk/Payer roles. | web | Advanced | [1](https://quickbooks.intuit.com/online/advanced/) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/user-roles-access-rights-quickbooks-online/L66POfRrI_US_en_US) |
| `ai-assistant` | Platform | AI Chat / Intuit Intelligence | A chat assistant for instant insights into the books (limited capacity, beta) and voice or document-based invoice creation on mobile. | web, ios | Simple Start (listed as limited on lower plans) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/advanced/) [3](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) |
| `ai-agents` | Platform | Intuit AI agents | A set of named agents: Accounting AI (categorisation, reconciliation, asks for missing context), Payments AI, Customer AI, Project Management AI, Finance AI, Payroll AI, Sales Tax AI and Business Tax AI; pricing adds anomaly detection and continuous books quality checks on higher plans. | web | Simple Start (automated bookkeeping listed from Simple Start; individual agents gated by plan (e.g. Payments AI from Essentials, Customer AI from Plus, Finance and Project AI on Advanced)) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/overview-agents-quickbooks-online/L9irCAtK4_US_en_US) [2](https://quickbooks.intuit.com/pricing/) |
| `leads` | CRM | Customer AI / lead sourcing | Lead collection from Essentials; Customer AI from Plus automates lead generation, qualification, nurturing, outreach and proposals. | web | Essentials | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/overview-agents-quickbooks-online/L9irCAtK4_US_en_US) |
| `forms` | Platform | Lead collection forms | Forms that collect leads into QuickBooks. | web | Essentials | [1](https://quickbooks.intuit.com/pricing/) |
| `templates` | Platform | Invoice templates | Choose from multiple invoice templates or create your own. | web, android | not stated | [1](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) |
| `accountant-collaboration` | Finance | Accountant access / QuickBooks Online Accountant | Accountant user seats (2 on Simple Start to Plus, 3 on Advanced) plus the QuickBooks Online Accountant workspace for firms, which the accountants page says is retired on 31 Dec 2026 in favour of Intuit Accountant Suite. | web | Simple Start | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/accountants/) |
| `data-import-export` | Platform | Import data / Spreadsheet Sync | Upload bank transactions manually and move data in and out; Advanced syncs data both ways with Excel. | web | not stated (Excel data sync on Advanced) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/advanced/) |
| `app-marketplace` | Platform | QuickBooks App Store / integrations | A directory of third-party apps (Intuit pages cite 800+ and 1,500+ integrations); pricing says integrations are not available on Free, and third-party data integration is listed from Essentials. | web | not stated (not on Free) | [1](https://quickbooks.intuit.com/pricing/) [2](https://quickbooks.intuit.com/online/) [3](https://quickbooks.intuit.com/online/advanced/) |
| `mobile-app` | Platform | QuickBooks mobile app | Free companion app with paid plans: invoicing, receipts, mileage, payments, bank sync, reports and AI on iPhone, iPad, Apple Watch and Android. | ios, android | Simple Start (not available with QuickBooks Free) | [1](https://quickbooks.intuit.com/pricing/) [2](https://apps.apple.com/us/app/quickbooks-accounting/id584606479) [3](https://play.google.com/store/apps/details?id=com.intuit.quickbooks&hl=en_US) |
| `desktop-app` | Platform | QuickBooks Online desktop app | A downloadable Windows and macOS (Apple silicon and Intel) app for QuickBooks Online that keeps users signed in and opens several companies in tabs. | desktop | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/download-products/download-use-quickbooks-online-advanced-desktop/L9BrRPlDD_US_en_US) |
| `api-webhooks` | Platform | QuickBooks Online Accounting API | REST API with webhooks for changes to subscribed entities, Change Data Capture as a polling alternative, and batch requests of up to 30 payloads. | api | not stated | [1](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks) [2](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/batch) [3](https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | yes | partial |

The UI Export data tool gives reports and lists as Excel in one .zip, with separate exports for attachments, estimates, POs, recurring templates and more, but the audit log cannot be exported to Excel and has no API. Backups exist only on Advanced, and restoring one leaves out budgets and inventory history. The Accounting API has query, Attachable and Change Data Capture (changedSince, up to 30 days back, deletes flagged), plus webhooks. So delta sync is possible, but not all data can be pulled by API.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Export data (Settings > Tools > Export data) | Exports reports and lists as Excel files in one .zip file, covering posting transactions such as invoices, receipts and bills. You pick a date range and switch reports and lists on or off. | Excel, ZIP | No row or size limits stated on the page | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US) |
| Per-report / per-list Export to Excel | Separate exports for non-posting items: estimates, purchase orders, customer statements (print then download as PDF), recurring templates (Recurring Template List report), chart of accounts, and products and services. | Excel, PDF | not stated | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US) |
| Attachments batch export | Settings > Lists > Attachments: select attachments, then Batch actions > Export. The files come out in a zip file. | ZIP | not stated | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US) |
| Export after cancellation (read-only access) | After cancelling, you have read-only access and can export data to Excel or to a desktop version of QuickBooks. | Excel, QuickBooks Desktop file | Paid subscriptions: read-only access and export for one year after cancelling. Cancelled or expired trials: 90 days. A declined card leaves 14 days to update billing before the account is suspended. | not stated | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/happens-quickbooks-online-data-cancel/L6qDpbE1B_US_en_US) |
| Online Backup and Restore (Personal cloud archive export) | Automatic backups once turned on, a manual Full backup, and point-in-time restore that overwrites the whole company. Backups can be exported to a linked Google Drive as a Personal cloud archive in .cab format, and a cloud archive cannot be restored for now. | .cab | Keeps snapshots from the last year and restores to within one previous calendar year. Restore leaves out budgets (save them as CSV), inventory history and adjustments, and tax rates that use expense accounts. A Google Drive export may take 10 minutes or more. | QuickBooks Online Advanced (page is tagged Advanced and Intuit Enterprise Suite) | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/back-data/back-restore-quickbooks-online-advanced-company/L9sTCQn9P_US_en_US) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| Accounting API query | read-api | SQL-like query of Accounting API entities, paged (a client library pages at 1000 per page by default). Deleted entities are not returned by a standard query. Filtering on MetaData.LastUpdatedTime was not confirmed from a readable page. | [1](https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features) [2](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md) |
| Change Data Capture (CDC) | incremental | GET /v3/company/<realmID>/cdc?entities=<entityList>&changedSince=<dateTime> returns the listed entities changed since a date-time. Lookback is up to 30 days, and at most 1000 objects come back per response, so poll shorter windows if you hit it. Deleted entities come back with status "Deleted". | [1](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture) [2](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/changedatacapture) [3](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md) |
| Webhooks | webhooks-events | Notifies the app when subscribed entities change, per the earlier product scan. The event payload and retry details could not be read. | [1](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks) |
| Batch | other | Several operations or queries in one request. The maximum is 30 payloads per the Intuit search snippet and product scan, while the quickbooks-ruby README says 25. The official page could not be read to settle it. | [1](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/batch) [2](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md) |
| Attachable / Upload | read-api | Attachable entities hold attachment metadata and a temporary download URI (temp_download_uri) for the file. Invoice, SalesReceipt and Payment PDFs can be downloaded. This comes from a third-party client library's docs, not an official page. | [1](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md) |

### Auth for a third-party importer

**Models:** oauth-app

OAuth 2.0 authorization code flow: the authorize URL is appcenter.intuit.com/connect/oauth2, tokens come from oauth.platform.intuit.com/oauth2/v1/tokens/bearer, the scope is com.intuit.quickbooks.accounting, and a realmId identifies the company. Access tokens last 1 hour. The client library falls back to 100 days for refresh-token expiry when x_refresh_token_expires_in is not returned. All of this is from a third-party client README. The official OAuth page and the production-key/app-assessment requirements could not be read.

Sources: [1](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md)

### Rate limits and quotas

Not confirmed from a vendor page. An Intuit developer forum question title cites '500 QBO API requests per minute and the maximum of 10 concurrent requests'. A search snippet says some concurrent and batch limits were not enforced until they were corrected on August 10th, 2024. CDC caps a response at 1000 objects. The official throttling articles are JS-rendered and returned no text.

Sources: [1](https://help.developer.intuit.com/s/question/0D54R00008kHftwSAC/with-respect-to-calculating-throttling-limits-500-qbo-api-requests-per-minute-and-the-maximum-of-10-concurrent-requests-when-a-batch-query-containing-5-queries-is-sent-to-qbo-is-the-batch-query-considered-1-request-or-5-requests) [2](https://help.developer.intuit.com/s/article/API-call-limits-and-throttling) [3](https://help.developer.intuit.com/s/article/QuickBooks-Online-API-throttling-changes-coming-soon)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| history-audit | The audit log keeps events for two years, is admin-only, and shows 150 records at a time in the UI. Intuit forum answers (search snippets) say the audit trail is not exposed to the API, is only reachable in the UI, and cannot be exported to Excel (PDF save or copy-paste only). The official help article describes no export. | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/audit-log/use-audit-log-quickbooks-online/L2WoVnW6I_US_en_US) [2](https://help.developer.intuit.com/s/question/0D54R0000A0XUkaSQG/how-i-access-qbo-audit-logs-with-sdk-api) [3](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/qbo-audit-log/00/648418) |
| history-audit | Change Data Capture only reaches back 30 days, and a standard query does not return deleted entities. Deletions older than 30 days cannot be recovered by API, so a delta sync has to run at least that often. | [1](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture) [2](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md) |
| other | Restoring a backup leaves out budgets (they must be saved as CSV), inventory history and inventory adjustments. The Personal cloud archive (.cab) cannot be restored for now, and a restore replaces the whole company rather than un-deleting items. | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/back-data/back-restore-quickbooks-online-advanced-company/L9sTCQn9P_US_en_US) |
| attachments-files | In the UI, attachments are exported separately from the Export data zip, through the Attachments list's batch action. By API, each file needs its own Attachable download URI (from third-party docs). | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US) [2](https://raw.githubusercontent.com/ruckus/quickbooks-ruby/master/README.md) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Export to QuickBooks Desktop | out-of-vendor | After cancelling, data can be exported to a desktop version of QuickBooks as well as to Excel. | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/access-permissions/happens-quickbooks-online-data-cancel/L6qDpbE1B_US_en_US) |
| Third-party backup apps (app center) | out-of-vendor | The export help page points to third-party backup apps in the QuickBooks app center, without naming any. | [1](https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US) |

### Limits of the data-out scan

- developer.intuit.com doc pages (CDC, webhooks, batch, REST features, API reference) and help.developer.intuit.com articles are JS-rendered. WebFetch came back truncated and curl got only a shell with no text. CDC facts come from Intuit-domain search snippets, backed up by the third-party quickbooks-ruby README.
- Throttling limits (requests per minute, concurrency, batch rate) are not confirmed from a vendor page. The only figure is a developer-forum question title.
- Batch maximum conflicts: 30 (Intuit snippet and product scan) against 25 (quickbooks-ruby README).
- OAuth token lifetimes and endpoints come from a third-party README. The production-key requirements (app assessment, questionnaire) were not confirmed.
- Whether query supports filtering on MetaData.LastUpdatedTime was not confirmed.
- Webhook payload, retry and event-type details were not read.
- Whether the Export data zip covers every transaction type in full detail (not just reports) was not confirmed. The help page says posting transactions are included, but it states no limits or exclusions.
- No injected instructions were seen in fetched pages.

| Kind | What | Result |
|---|---|---|
| fetch | https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US | 404 (the right path is under list-management) |
| fetch | https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture | WebFetch truncated; curl got a JS shell with no doc text |
| fetch | https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/changedatacapture | WebFetch truncated |
| fetch | https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features and /docs/develop/webhooks | curl got a JS shell with no doc text |
| fetch | https://help.developer.intuit.com/s/article/QuickBooks-Online-API-Best-Practices | JS loading shell, no content |
| fetch | https://help.developer.intuit.com/s/article/API-call-limits-and-throttling | curl got no readable text |
| fetch | https://blogs.intuit.com/2023/08/24/building-smarter-with-intuit-stay-in-sync-with-cdc/ | redirects to medium.com/intuitdev index; not followed |

## Limits of this scan

- developer.intuit.com docs pages (API explorer, entity reference, webhooks, rest-api-features) came back truncated or JS-rendered, and help.developer.intuit.com gave a CSS-error shell. API facts rest on search snippets. The 'api' surface is marked only on api-webhooks, although many entities (invoices, bills, customers) are probably exposed; the entity list was not confirmed.
- The pricing page came back as plan cards only, with no full row-by-row comparison table. Tiers are taken from the plan cards, help articles and the Advanced page. Many lowestTier values are null where no page stated one.
- The pricing page now shows a Free plan ($0, 1 user, 2 invoices/month, 1 bank) beside Simple Start/Essentials/Plus/Advanced. Where the page states it, Free is used as lowestTier.
- The Google Play listing page came back truncated. Android facts come from search-result snippets of the Play listing and quickbooks.intuit.com.
- The QuickBooks App Store (apps.intuit.com, which redirects to quickbooks.intuit.com/app/apps/home/) is JS-rendered. App counts (800+ on /online/, 1,500+ on the Advanced page) are inconsistent across Intuit pages.
- A search snippet mentioned Advanced 'Backup and Restore' (automatic backup, version restore) but it could not be tied to a specific page, so it was left out. SSO/MFA, data security and sandbox companies were not scanned.
- Plan-by-plan availability of the AI agents is only partly stated: the agents help article gives no plans, so the agent tiers come from the pricing cards.
- No prompt-injection content was seen in the fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account | truncated / no usable content |
| fetch | https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api | truncated / no usable content |
| fetch | https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features | truncated / no usable content |
| fetch | https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks | truncated / no usable content |
| fetch | https://help.developer.intuit.com/s/article/API-call-limits-and-throttling | CSS error shell, no content |
| fetch | https://play.google.com/store/apps/details?id=com.intuit.quickbooks | truncated / no usable content |
| fetch | https://quickbooks.intuit.com/app/apps/home/ | JS loading shell only |
