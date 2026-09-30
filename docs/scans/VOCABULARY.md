# Scan capability vocabulary

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

172 stable kebab-case ids for catalog-level capability areas, shared by all ten scans. A vendor's feature maps to an id when it is genuinely the same capability, whatever the vendor calls it; where versions differ materially the id stays one and the difference is noted. Generated from `vocabulary.json` by `tools/scans/build.ts`.

These ids are scan vocabulary only. They are not Feature Catalog keys; a roadmap may adopt, split or rename them through its own review.

## Platform

| Id | Definition | Scans using it |
|---|---|---|
| `users-teams` | User accounts, invitations, teams and groups inside a workspace or organisation. | 7 |
| `roles-permissions` | Roles, profiles and permission sets that decide who can see and change what. | 10 |
| `sso-identity` | Single sign-on (SAML/OIDC), multi-factor authentication and user provisioning (SCIM). | 9 |
| `audit-log` | A record of who did what and when, for admins and compliance. | 10 |
| `compliance-security` | Encryption controls, data residency, retention policies, legal hold and compliance certifications. | 8 |
| `data-import-export` | Bringing records in from files or other tools and exporting or backing them up. | 9 |
| `custom-fields-objects` | Admin-defined fields, record types and custom objects that extend the data model. | 8 |
| `low-code-builder` | Point-and-click builders for custom apps, pages, layouts or components on the platform. | 3 |
| `developer-platform` | Code-level customisation: a hosted language, SDKs, CLIs, packaging and deployment tooling. | 9 |
| `sandbox-environments` | Separate test or staging copies of an account for building and testing changes. | 7 |
| `search` | Finding records, messages, files or content across the product. | 7 |
| `notifications` | In-app, email and push alerts about activity a user cares about. | 6 |
| `mobile-app` | The vendor's native phone and tablet apps as a product area in their own right (offline use, mobile-only features). | 10 |
| `desktop-app` | The vendor's native desktop app for macOS, Windows or Linux. | 3 |
| `api-webhooks` | Public APIs and outgoing webhooks/events for programmatic access to the product. | 10 |
| `app-marketplace` | A directory of third-party and vendor apps and integrations that install into the product. | 10 |
| `native-integrations` | Vendor-built connectors to named outside products (email suites, calendars, accounting, dev tools). | 8 |
| `workflow-automation` | Rules, triggers and visual flows that perform actions automatically when conditions are met. | 10 |
| `approvals` | Routing a record or request to people who must approve or reject it. | 9 |
| `reporting-dashboards` | Reports, charts and dashboards built from the product's own data. | 10 |
| `ai-assistant` | A generative-AI assistant that helps the user inside the product (summaries, drafting, answering questions). | 10 |
| `ai-agents` | Autonomous or semi-autonomous AI agents that act on the user's or customer's behalf. | 10 |
| `multi-currency-localization` | Multiple currencies, languages and regional formats. | 8 |
| `templates` | Reusable templates for records, documents, messages or projects. | 6 |
| `file-storage` | Uploading, storing, previewing and sharing files and attachments. | 5 |
| `tasks` | To-dos with owners and due dates. | 3 |
| `forms` | Forms that collect data from people and create or update records. | 8 |
| `calendar-scheduling` | Calendars, booking links and scheduling of meetings or appointments. | 4 |
| `email-calendar-sync` | Two-way sync with outside email and calendar providers (e.g. Gmail, Outlook). | 3 |
| `comments-mentions` | Comments and @mentions on records for internal collaboration. | 5 |
| `docs-wiki` | Collaborative documents, canvases or wiki pages inside the product. | 2 |
| `data-quality-dedup` | Duplicate detection, merging and data validation rules. | 2 |
| `admin-console` | Central administration settings, usage and billing management for the account. | 6 |
| `archiving` | Archiving inactive projects, spaces or records so they leave active views and limits but can be restored. | 1 |
| `custom-branding` | Account logo, colours and sender domain applied to customer-facing pages and messages. | 1 |
| `security-activity-monitoring` | Near real-time monitoring of account activity with security alerts and SIEM export. | 1 |

## CRM

| Id | Definition | Scans using it |
|---|---|---|
| `contacts` | People records with their details, history and relationships. | 3 |
| `organizations` | Company or account records that group contacts and activity. | 4 |
| `leads` | Prospects not yet qualified, with capture, qualification and conversion. | 4 |
| `activities` | Logged calls, emails, meetings and notes on a record's timeline. | 3 |
| `pipelines-deals` | Opportunities or deals moving through configurable sales stages. | 4 |
| `quotes-cpq` | Building quotes from products and prices, including configure-price-quote rules. | 3 |
| `products-price-books` | A catalogue of sellable products with prices and price lists. | 2 |
| `forecasting` | Projected revenue by period, owner or team, with adjustments. | 3 |
| `territory-management` | Dividing accounts and leads among sales territories and teams. | 1 |
| `lead-scoring` | Ranking leads or contacts by fit and engagement, by rules or models. | 2 |
| `sales-sequences` | Multi-step outreach cadences of emails, calls and tasks. | 2 |
| `sales-engagement-tools` | Seller productivity tools such as email tracking, templates, meeting links and call coaching. | 2 |
| `partner-management` | Managing channel partners, partner portals and shared deals. | 2 |
| `contracts-renewals` | Tracking customer contracts, subscriptions and renewals on the CRM record. | 2 |
| `customer-portal` | A logged-in site where customers or partners view and act on their own records. | 2 |
| `conversation-intelligence` | Recording, transcribing and analysing sales calls for insights, coaching and deal risk. | 1 |
| `sales-performance-management` | Sales quotas, commission and incentive compensation plans, and payout calculation. *Note:* Salesforce sells quota planning plus incentive compensation; NetSuite (Sales Commissions) scopes it to commission plans and payout calculation. | 2 |
| `sales-enablement` | Seller training, onboarding programs and content tied to sales outcomes. | 1 |
| `maps-route-planning` | Map views of accounts and route planning for field sellers. | 1 |
| `data-enrichment` | Filling in company and contact attributes automatically from a vendor-provided data source. | 1 |

## Marketing

| Id | Definition | Scans using it |
|---|---|---|
| `email-marketing` | Designing and sending bulk marketing emails and newsletters to lists. | 4 |
| `email-sending` | Sending one-to-one or transactional email from the product. | 1 |
| `marketing-automation` | Multi-step nurture journeys that react to contact behaviour. | 2 |
| `segmentation-lists` | Static and dynamic lists or segments of contacts. | 2 |
| `landing-pages` | Building and publishing campaign landing pages. | 0 |
| `website-cms` | Hosting and managing a full website: pages, themes, blog, domains. | 1 |
| `social-media` | Publishing to and monitoring social networks. | 1 |
| `ads-management` | Creating, syncing audiences with and reporting on paid ad campaigns. | 2 |
| `campaigns-attribution` | Grouping marketing work into campaigns and attributing revenue to touchpoints. | 3 |
| `seo-tools` | Search engine optimisation recommendations and tracking. | 2 |
| `sms-messaging` | Sending and receiving SMS or WhatsApp messages with contacts. | 5 |
| `customer-data-platform` | Unifying customer data from many sources into profiles for activation. | 2 |
| `video-hosting` | Hosting and sharing recorded video content. | 2 |
| `affiliate-influencer` | Recruiting and paying creators, influencers and affiliates to promote products. | 1 |

## Collaboration

| Id | Definition | Scans using it |
|---|---|---|
| `channels` | Persistent group conversations organised by topic, team or project. | 2 |
| `direct-messages` | Private one-to-one and small-group conversations. | 2 |
| `threads-reactions` | Replying in threads and reacting to messages with emoji. | 2 |
| `presence-status` | Showing whether people are available, away or in a meeting, with custom status. | 2 |
| `external-collaboration` | Working with people outside the organisation in shared spaces or as guests. | 3 |
| `audio-huddles` | Quick drop-in audio or video conversations inside a chat tool. | 2 |
| `async-video-clips` | Recording and sharing short audio, video or screen clips instead of meeting. | 2 |
| `bots-slash-commands` | Bots and command shortcuts that let users act on apps from a conversation. | 2 |
| `whiteboard` | A shared digital canvas for drawing and visual collaboration. | 1 |
| `lists-databases` | Structured lists or tables for tracking items inside a collaboration tool. | 2 |
| `hosted-email` | A vendor-hosted mailbox and calendar service with custom domains, as opposed to a client that syncs an outside provider. | 1 |
| `workplace-facilities` | Physical-office tools: desk and room reservation, visitor check-in and digital signage. | 1 |
| `employee-engagement` | An employee communications and engagement hub (intranet-style feed, company updates, recognition). | 1 |

## Meetings

| Id | Definition | Scans using it |
|---|---|---|
| `video-meetings` | Scheduled and instant video and audio meetings. | 1 |
| `screen-sharing` | Sharing a screen or window with others during a call. | 2 |
| `meeting-recording` | Recording meetings locally or to the cloud and playing them back. | 2 |
| `transcription-captions` | Live captions, translated captions and transcripts of spoken audio. | 3 |
| `meeting-controls` | Host controls, waiting rooms, breakout rooms, polls and in-meeting chat. | 1 |
| `webinars-events` | Registration-based webinars and virtual or hybrid events for large audiences. | 1 |
| `phone-calling` | Cloud phone system or calling: numbers, dialing, call routing and voicemail. | 3 |
| `room-systems` | Software and certified hardware for conference rooms and shared spaces. | 1 |
| `contact-center` | A multichannel contact centre with queues, agents and supervisors. | 1 |

## Commerce

| Id | Definition | Scans using it |
|---|---|---|
| `online-storefront` | An online store with themes, pages and a domain. | 2 |
| `product-catalog` | Products, variants, collections and media for sale. | 2 |
| `inventory-management` | Tracking stock levels across locations and adjusting inventory. | 3 |
| `checkout-payments` | Cart, checkout and accepting card and wallet payments. | 1 |
| `order-management` | Viewing, editing, fulfilling, refunding and returning orders. | 2 |
| `shipping-fulfillment` | Shipping rates, labels, carrier connections and fulfilment services. | 2 |
| `point-of-sale` | In-person selling with POS hardware and software tied to the same catalogue. | 2 |
| `discounts-promotions` | Discount codes, automatic discounts and gift cards. | 1 |
| `customer-accounts` | Buyer accounts, order history and customer records for a store. | 1 |
| `multichannel-selling` | Selling through marketplaces and social channels from one catalogue. | 1 |
| `b2b-wholesale` | Company buyers, price lists, payment terms and wholesale ordering. | 1 |
| `subscriptions-recurring-billing` | Recurring charges, subscription plans and billing schedules. | 4 |
| `international-selling` | Selling in multiple markets with local currency, language, duties and domains. | 1 |
| `headless-commerce` | APIs and frameworks for building custom storefronts decoupled from the platform's own themes. | 1 |
| `agentic-commerce` | Making products discoverable and purchasable through third-party AI assistants and agents. | 1 |

## Finance

| Id | Definition | Scans using it |
|---|---|---|
| `general-ledger` | The chart of accounts, journal entries and the books of record. | 2 |
| `bank-feeds-reconciliation` | Connecting bank and card accounts, categorising transactions and reconciling. | 2 |
| `invoicing` | Creating and sending invoices and estimates to customers. | 4 |
| `accounts-receivable` | Tracking what customers owe, payments received, collections and dunning. | 2 |
| `accounts-payable` | Recording and paying bills from vendors. | 3 |
| `expense-management` | Capturing receipts and tracking business expenses and reimbursements. | 2 |
| `payments-acceptance` | Accepting customer payments online or by card through the product. | 4 |
| `payroll` | Paying employees, withholding and filing payroll taxes. | 2 |
| `time-tracking` | Recording time worked against people, projects or customers. | 3 |
| `sales-tax` | Calculating, tracking and filing sales tax or VAT. | 3 |
| `financial-reports` | Financial statements such as profit and loss, balance sheet and cash flow. | 3 |
| `budgeting-planning` | Budgets, forecasts and financial planning. | 2 |
| `project-accounting` | Tracking profitability, costs and billing per project or job. | 2 |
| `fixed-assets` | Recording, depreciating and disposing of fixed assets. | 2 |
| `multi-entity-consolidation` | Managing multiple companies or subsidiaries and consolidating their books. | 1 |
| `revenue-recognition` | Recognising revenue over time according to accounting standards. | 2 |
| `purchasing-procurement` | Purchase requisitions, purchase orders, vendors and receiving. | 3 |
| `tax-1099-compliance` | Contractor and tax-form filing such as US 1099s. | 1 |
| `accountant-collaboration` | Tools for outside accountants and bookkeepers to access and work on client books. | 1 |
| `business-banking-financing` | Merchant money accounts, business cards and lending offered inside the platform. | 1 |
| `mileage-tracking` | Logging business trips (manually or by GPS) to claim vehicle expenses or reimburse mileage. | 1 |
| `tracking-dimensions` | Tagging transactions with classes, locations, departments or other segments to report by dimension. | 1 |
| `financial-close` | Period-close management: close checklists, task tracking and close status across accounting periods. | 1 |

## Operations

| Id | Definition | Scans using it |
|---|---|---|
| `warehouse-management` | Bins, picking, packing and warehouse operations. | 1 |
| `manufacturing` | Bills of materials, work orders and production management. | 1 |
| `supply-chain-planning` | Demand planning, supply planning and replenishment. | 1 |
| `hr-people` | Employee records, org structure and HR processes. | 3 |
| `professional-services-automation` | Resource planning, project delivery and billing for services businesses. | 1 |

## Work management

| Id | Definition | Scans using it |
|---|---|---|
| `issues-work-items` | Issues, tasks or work items with types, fields, assignees and statuses. | 1 |
| `boards-kanban` | Visual boards of cards moving across columns. | 1 |
| `sprints-agile` | Scrum sprints, backlogs, estimation and velocity. | 1 |
| `roadmaps-timelines` | Timeline or Gantt views planning work over time across teams. | 1 |
| `issue-workflows` | Configurable status workflows, transitions and rules for work items. | 1 |
| `releases-versions` | Grouping work into versions or releases and tracking what shipped. | 1 |
| `dependencies` | Linking work items that block or depend on each other. | 1 |
| `dev-tool-integration` | Connecting code repositories, builds and deployments to work items. | 1 |
| `goals-okrs` | Tracking goals or objectives and linking work to them. | 1 |
| `capacity-resource-planning` | Planning team capacity and allocating people to work. | 2 |

## Service

| Id | Definition | Scans using it |
|---|---|---|
| `ticketing` | Receiving, tracking and resolving customer requests as tickets or cases. | 4 |
| `omnichannel-routing` | Routing conversations and tickets across email, chat, phone and social to the right agent. | 2 |
| `live-chat-messaging` | Web, in-app and social messaging with customers in real time. | 3 |
| `knowledge-base` | Help-centre articles for customers and internal agents. | 4 |
| `community-forums` | Customer community forums for peer help. | 1 |
| `sla-management` | Service-level targets and breach tracking on tickets. | 2 |
| `csat-surveys` | Customer satisfaction and feedback surveys. | 2 |
| `workforce-management` | Forecasting, scheduling and tracking agent workforce. | 1 |
| `quality-assurance` | Reviewing and scoring agent conversations for quality. | 1 |
| `macros-canned-responses` | Saved replies and actions agents apply to tickets in one step. | 2 |
| `field-service` | Scheduling and dispatching mobile technicians for on-site work. | 0 |
| `it-service-management` | IT help desk: incidents, problems, changes, and service catalogue. | 0 |
| `asset-management` | Tracking IT or physical assets and configuration items. | 1 |
| `customer-health-scores` | Scoring customer accounts' health from behaviour and profile data to drive retention work. | 1 |
| `multi-brand` | Running several customer-facing brands, each with its own help centre, channels and addresses, from one account. | 1 |
| `side-conversations` | Separate threads started from a ticket to work with other teams, vendors or tools without exposing them to the customer. | 1 |

## Agreements

| Id | Definition | Scans using it |
|---|---|---|
| `e-signature` | Sending documents for legally binding electronic signature and signing them. | 1 |
| `signer-identity-verification` | Verifying signer identity (SMS, knowledge-based, ID document, qualified signatures). | 1 |
| `bulk-send` | Sending one document to many recipients individually at once. | 1 |
| `document-generation` | Generating agreements or documents from templates and record data. | 1 |
| `contract-lifecycle-management` | Authoring, negotiating, storing and tracking contracts through their lifecycle. | 1 |
| `agreement-repository` | A searchable store of completed agreements with extracted terms. | 1 |
| `notary` | Remote online notarisation of documents. | 1 |
| `payment-collection-in-documents` | Collecting payment as part of signing a document. | 1 |
| `signing-order-routing` | Recipient order and routing rules for a signing request: serial, parallel, conditional, delegated and signing groups. | 1 |
| `document-fields-logic` | Fillable fields placed in a document for signers, with validation, conditional display and calculated values. | 1 |
| `embedded-signing` | Signing or sending experience embedded inside a third-party website or app through the API. | 1 |
