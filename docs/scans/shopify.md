# Shopify (TGT-05): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

53 capability areas (53 confirmed from sources, 0 unconfirmed). Generated from `shopify.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

The Shopify commerce platform: admin, online store, checkout and Shopify Payments, POS, Markets, B2B, and Shopify-made apps that ship with it (Inbox, Messaging/Email, Flow, Forms, Subscriptions, Search & Discovery etc.), plus Shopify Plus features. Plans as shown on shopify.com/pricing: Basic, Grow, Advanced, Plus; Starter documented on a separate help page.

Left out of this scan:

- Shop consumer app as a buyer product (only covered as a sales channel)
- Shopify for enterprise / Commerce Components and the Agentic, Lite and Retail plans (listed in help but not on the pricing compare table)
- Shopify Partner Program and Partner Dashboard tooling beyond Plus sandbox stores
- Shopify Academy, Shopify Community and support offerings
- Hardware catalogue for POS (only mentioned)
- Third-party App Store apps

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | Shopify admin | Web browser | [1](https://help.shopify.com/en/manual) |
| ios | Shopify: Ecommerce business | iPhone, iPad, Apple Watch | [1](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) |
| ios | Shopify Point of Sale (POS) | iPhone, iPad, iPod touch | [1](https://apps.apple.com/us/app/shopify-point-of-sale-pos/id686830644) |
| android | Shopify POS | Android (Shopify states POS runs on iOS or Android) | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) |

## Public API

**Style:** GraphQL (Admin, Storefront, Customer Account) plus REST Admin API; webhooks/events; Shopify Functions; Liquid and Ajax for themes

All APIs require tokens and scopes. GraphQL Admin uses calculated query cost and REST uses request-based leaky buckets, both sized by plan (pricing page: Standard, up to 2x on Advanced, up to 10x on Plus). Also Payments Apps, Partner, Multipass, ShopifyQL and Web Pixel APIs.

Sources: [1](https://shopify.dev/docs/api) [2](https://shopify.dev/docs/api/usage/limits) [3](https://www.shopify.com/pricing)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `online-storefront` | Commerce | Online store | Hosted online store with themes, pages, blog, unlimited hosting, custom domain and free SSL; Starter gets only the Spotlight theme and default pages. | web | Basic (Starter plan has a reduced store (Spotlight theme, product links, no collections)) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-starter-plan) [3](https://help.shopify.com/en/manual) |
| `product-catalog` | Commerce | Products | Products with variants, collections, digital products, gift card products and bundles (Shopify Bundles app); unlimited products. | web, ios, api | Basic (Starter cannot group products into collections) | [1](https://help.shopify.com/en/manual/products) [2](https://www.shopify.com/pricing) [3](https://shopify.dev/docs/api) |
| `inventory-management` | Commerce | Inventory management | Stock tracking across locations (10 on Basic–Advanced, 200 on Plus), barcode scanning in the mobile app and POS inventory counts; Stocky adds forecasting, stocktakes and transfers. | web, ios, api | Basic (location count varies by plan) | [1](https://www.shopify.com/pricing) [2](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `checkout-payments` | Commerce | Shopify checkout | Hosted cart and checkout with Shop Pay, abandoned-checkout recovery and checkout customization via Checkout Blocks and extensions; full customization and high-volume checkout are Plus only. | web, api | Basic (checkout customization Limited below Plus) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) [3](https://help.shopify.com/en/manual) |
| `payments-acceptance` | Finance | Shopify Payments | Built-in card, wallet, local-method and USDC acceptance online and in person with per-plan card rates; third-party gateways incur a transaction fee (2% Basic down to 0.2% Plus). Payments Apps API for payment partners. | web, ios, api | Basic (rates fall on higher plans; some features require Shopify Payments) | [1](https://www.shopify.com/pricing) [2](https://apps.apple.com/us/app/shopify-point-of-sale-pos/id686830644) [3](https://shopify.dev/docs/api) |
| `order-management` | Commerce | Orders | View, edit, refund and return orders, including self-serve returns from the order status page, draft orders and printing with Order Printer; mobile app processes fulfilments and refunds. | web, ios, api | not stated | [1](https://help.shopify.com/en/manual/fulfillment) [2](https://help.shopify.com/en/manual/fulfillment/managing-orders) [3](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) |
| `shipping-fulfillment` | Commerce | Shipping and fulfillment | Shipping rates, discounted label purchase and printing, shipping insurance, local delivery and pickup, Shopify Fulfillment Network 3PL connections; third-party calculated rates are an add-on on Grow and included from Advanced. | web, ios | Basic (3rd-party calculated rates: Grow add-on, Advanced included; unavailable on Starter) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/fulfillment/setup/delivery-methods/local-delivery) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `point-of-sale` | Commerce | Shopify POS | In-person selling on iOS and Android with shared catalogue, customer profiles, returns/exchanges across channels, staff PINs and roles, local delivery orders and hardware; POS Pro is $89/mo per location, Plus includes 20 locations. | ios, android | Basic (casual in-person sales on all plans; POS Pro paid per location; not on Starter) | [1](https://www.shopify.com/pricing) [2](https://apps.apple.com/us/app/shopify-point-of-sale-pos/id686830644) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `discounts-promotions` | Commerce | Discounts and gift cards | Discount codes, automatic discounts, bundles and selling gift cards; custom discount logic via Shopify Functions. | web, api | Basic | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) [3](https://shopify.dev/docs/api) |
| `customer-accounts` | Commerce | Customers and customer accounts | Customer records with search, buyer accounts with order history, store credit, and the Customer Account API. | web, ios, api | Basic (pricing page lists unlimited contacts on all compared plans) | [1](https://help.shopify.com/en/manual/customers) [2](https://shopify.dev/docs/api) |
| `multichannel-selling` | Commerce | Sales channels | Selling on Facebook, Instagram, TikTok, Google/YouTube, the Shop app, Amazon/other marketplaces via Marketplace Connect, Temu, Buy Button and WordPress; Shopify Collective for supplier/retailer dropshipping. | web, ios | Basic (marketplace sync free to 50 orders/month then 1% up to $99/mo) | [1](https://help.shopify.com/en/manual/online-sales-channels) [2](https://www.shopify.com/pricing) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `b2b-wholesale` | Commerce | Shopify B2B | Companies as buyers, catalogs with custom pricing, payment terms, quantity rules, B2B draft orders and B2B checkout, in a blended or B2B-only store. | web | Basic (up to 3 B2B catalogs below Plus; unlimited on Plus) | [1](https://help.shopify.com/en/manual/b2b) [2](https://www.shopify.com/pricing) |
| `subscriptions-recurring-billing` | Commerce | Shopify Subscriptions | Free Shopify app for recurring purchase plans with discounts, subscription analytics and customer self-serve skip/cancel, online and on POS. | web | not stated | [1](https://help.shopify.com/en/manual/products/purchase-options/shopify-subscriptions) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `international-selling` | Commerce | Shopify Markets | Markets per country/region with local domains, local currency pricing, local payment methods and estimated/collected duties; Managed Markets on the Plus page. | web | Basic (local currencies and payment methods require Shopify Payments) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/international) [3](https://www.shopify.com/plus/pricing) |
| `multi-currency-localization` | Platform | Translate storefront and local currencies | Storefront translation (Translate & Adapt app) and prices shown in local currencies. | web | Basic (local currencies require Shopify Payments) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `sales-tax` | Finance | Shopify Tax | Automated sales tax calculation, tax liability tracking, VAT validation and automated filing in eligible regions (US, EU, UK, Canada); Basic tax elsewhere; advanced tax platform is an add-on. | web | Basic (advanced tax platform is an add-on) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/taxes) |
| `users-teams` | Platform | Staff and collaborators | Staff accounts (none extra on Basic, up to 5 on Grow, 15 on Advanced, unlimited on Plus), invitations, bulk user import and third-party collaborator accounts. | web | Grow (additional staff accounts; Starter and Basic have none) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/your-account/users) |
| `roles-permissions` | Platform | Roles and permissions | Roles assigned to users with granular permissions, collaborator permission scopes and POS staff roles; custom user groups on Plus. | web, ios | not stated (custom user groups Plus only) | [1](https://help.shopify.com/en/manual/your-account/users) [2](https://www.shopify.com/pricing) [3](https://apps.apple.com/us/app/shopify-point-of-sale-pos/id686830644) |
| `sso-identity` | Platform | Advanced security (SAML, SCIM) | Two-step authentication for all users; on Plus organizations SAML SSO with an identity provider, SCIM provisioning and enforced two-step authentication after domain verification. | web | Plus (SAML/SCIM Plus only; two-step auth on all plans) | [1](https://help.shopify.com/en/manual/your-account/users/security/advanced-security-features) [2](https://help.shopify.com/en/manual/your-account/users/security) |
| `audit-log` | Platform | Activity logs | User-management activity log, recent login history per user and a store activity log of admin changes. | web | not stated (access limited to eligible users per plan requirements page (not fetched)) | [1](https://help.shopify.com/en/manual/your-account/users/security/user-management-activity-log) |
| `data-import-export` | Platform | CSV import/export and Store Migration | CSV import/export of products, customers and users, Store Migration app from other platforms, and Data Exporter for tax compliance. | web | not stated | [1](https://help.shopify.com/en/manual/products) [2](https://help.shopify.com/en/manual/customers) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `custom-fields-objects` | Platform | Metafields and metaobjects | Custom fields on products, customers, orders and more, plus multi-field custom objects. | web, api | not stated | [1](https://help.shopify.com/en/manual/custom-data) |
| `developer-platform` | Platform | Shopify apps, Functions and Liquid | Custom apps on the APIs, Liquid theme language, Shopify Functions for backend logic, web pixel and UI extensions; custom functions are Plus only. | api | Basic (custom apps have limited data on Basic; custom functions Plus only) | [1](https://shopify.dev/docs/api) [2](https://www.shopify.com/pricing) |
| `headless-commerce` | Commerce | Headless / Hydrogen | Storefront API, Hydrogen framework and the Headless channel for custom storefronts; 1 headless storefront below Plus, 25 on Plus. | api | Basic (1 headless storefront below Plus, 25 on Plus) | [1](https://shopify.dev/docs/api) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) [3](https://www.shopify.com/pricing) |
| `api-webhooks` | Platform | Admin GraphQL API and webhooks | GraphQL Admin API (plus REST Admin API), Storefront, Customer Account, Payments Apps and Partner APIs, and events/webhooks; cost-based leaky-bucket limits that scale by plan. | api | Basic (API limits Standard; up to 2x Advanced; up to 10x Plus) | [1](https://shopify.dev/docs/api) [2](https://shopify.dev/docs/api/usage/limits) [3](https://www.shopify.com/pricing) |
| `app-marketplace` | Platform | Shopify App Store | Directory of third-party and Shopify-made apps; Plus Certified apps on Plus. Starter restricts many apps. | web | Basic (Plus Certified apps Plus only) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) [3](https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-starter-plan) |
| `workflow-automation` | Platform | Shopify Flow | Free automation app with triggers, conditions and actions across store and apps; Send HTTP Request on Grow and above. Launchpad (Plus only) schedules sales, drops and restocks. | web | Basic (HTTP request action from Grow; Launchpad Plus only) | [1](https://help.shopify.com/en/manual/shopify-flow) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `reporting-dashboards` | Platform | Analytics and reports | Analytics dashboard, 200+ real-time reports, custom analytics and ShopifyQL querying (ShopifyQL Notebooks on the Plus page); Google Analytics integration. | web, ios, api | Starter (report types vary by plan) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-starter-plan) [3](https://help.shopify.com/en/manual/reports-and-analytics) |
| `financial-reports` | Finance | Finance and profit reports | Finances and profit reports among the built-in reports. | web | Starter | [1](https://help.shopify.com/en/manual/intro-to-shopify/pricing-plans/plans-features/shopify-starter-plan) |
| `ai-assistant` | Platform | Sidekick | AI assistant in desktop and mobile admin (chat, voice, screen share) that analyses data, edits products, manages orders, drafts content and builds custom apps, with review before changes apply. | web, ios | Basic | [1](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) [2](https://www.shopify.com/pricing) [3](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) |
| `ai-agents` | Platform | Inbox agent and Knowledge Base | Inbox agent answers shopper chat questions automatically from catalogue, policies and Knowledge Base; the Knowledge Base app controls FAQs AI shopping agents use. | web | not stated | [1](https://help.shopify.com/en/manual/inbox) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `agentic-commerce` | Commerce | Agentic storefronts / Sell in AI chats | Products discoverable and purchasable in ChatGPT, Google AI Mode/Gemini, Microsoft Copilot and Meta surfaces, with order attribution by AI channel. | web | Basic (on by default for eligible stores) | [1](https://help.shopify.com/en/manual/online-sales-channels/agentic-storefronts) [2](https://www.shopify.com/pricing) |
| `email-marketing` | Marketing | Shopify Messaging (email campaigns) | Email campaigns to unlimited contacts from the Growth page. | web | Basic | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/promoting-marketing/shopify-messaging) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `sms-messaging` | Marketing | Shopify Messaging (SMS) | Pay-per-send SMS marketing campaigns. | web | Basic (pay per send) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `marketing-automation` | Marketing | Marketing automations | Marketing automations including abandoned checkout recovery. | web | Basic | [1](https://www.shopify.com/pricing) |
| `segmentation-lists` | Marketing | Customer segmentation | Customer segments of customers sharing characteristics, used for marketing. | web, ios | Basic | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/customers) [3](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) |
| `forms` | Platform | Shopify Forms | Sign-up and lead capture forms on the online store that grow the email list. | web | Basic (pricing page row: Capture customer leads) | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) [2](https://www.shopify.com/pricing) |
| `live-chat-messaging` | Service | Shopify Inbox | Online store chat with customers, instant answers, availability hours and automatic first replies, conversation analytics. | web | Basic (pricing page row: Chat with customers) | [1](https://help.shopify.com/en/manual/inbox) [2](https://help.shopify.com/en/manual/inbox/chat-settings-and-appearance/availability-and-first-reply) [3](https://www.shopify.com/pricing) |
| `macros-canned-responses` | Service | Inbox quick replies | Saved quick replies staff use when composing chat messages. | web | not stated | [1](https://help.shopify.com/en/manual/inbox/configure-inbox/quick-replies) |
| `seo-tools` | Marketing | SEO | SEO guidance and settings for the online store. | web | not stated | [1](https://help.shopify.com/en/manual) |
| `search` | Platform | Search & Discovery; admin search | Search & Discovery app customises storefront search, filters and recommendations; admin customer search. | web | not stated | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) [2](https://help.shopify.com/en/manual/customers) |
| `ads-management` | Marketing | Shopify Audiences and Shop Campaigns | Shopify Audiences boosts ad performance across Meta, Google, TikTok, Pinterest, Snapchat and Criteo (optimization Plus only); Shop Campaigns for paid acquisition; Google and social campaigns from the mobile app. | web, ios | Basic (Shop Campaigns all plans; Audiences optimization Plus only) | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) [2](https://www.shopify.com/pricing) [3](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) |
| `affiliate-influencer` | Marketing | Shopify Collabs | Finding and working with creators, influencers and affiliates. | web | not stated | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `invoicing` | Finance | Draft order invoices and VAT invoicing | Send invoices for draft orders with a checkout link; VAT invoicing; custom invoices with Order Printer. | web | Basic (pricing row: VAT validation & invoicing) | [1](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/send-draft) [2](https://www.shopify.com/pricing) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `accounts-payable` | Finance | Shopify Bill Pay | Pay business bills from Shopify Balance, debit/credit card or ACH. | web | Basic | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) [2](https://www.shopify.com/pricing) |
| `business-banking-financing` | Finance | Shopify Balance, Capital, Credit | Merchant money account with earnings rate (2.52%, 3.54% on Plus), Shopify Capital funding and Shopify Credit Visa card; up to 6 Balance accounts in the mobile app. | web, ios | Basic | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual) [3](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) |
| `purchasing-procurement` | Finance | Stocky purchase orders | Stocky app: demand forecasting, purchase orders, stocktakes and stock transfers. | web | not stated | [1](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `mobile-app` | Platform | Shopify app and Shopify POS app | Shopify admin app for iPhone, iPad and Apple Watch (products, orders, labels, Balance, campaigns) and Shopify Point of Sale app; Android listings exist but could not be read. | ios, android | not stated | [1](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) [2](https://apps.apple.com/us/app/shopify-point-of-sale-pos/id686830644) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |
| `notifications` | Platform | Order notifications | Real-time sales and order notifications in the mobile app; Sidekick notifies on background task completion. | ios, web | not stated | [1](https://apps.apple.com/us/app/shopify-ecommerce-business/id371294472) [2](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) |
| `admin-console` | Platform | Organization settings | Organization admin to manage multiple stores, store switcher, organization permissions, users and billing; default for Plus, available when you create an organization; Plus includes up to 9 free expansion stores. | web | not stated (organization features by default on Plus; expansion stores Plus) | [1](https://help.shopify.com/en/manual/organization-settings) [2](https://help.shopify.com/en/manual/your-account/manage-orgs-and-stores) [3](https://www.shopify.com/pricing) |
| `sandbox-environments` | Platform | Plus sandbox stores | Plus sandbox organizations/stores for Plus Partners to build and demo; Plus also lists testing new features before launch. | web | Plus | [1](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-organizations) [2](https://www.shopify.com/pricing) |
| `compliance-security` | Platform | Security and fraud | Free SSL, built-in fraud analysis and Fraud Control app, bot protection (Plus), Customer Privacy API for consent, and compliance guidance (GPSR, price indication directive). | web, api | Basic (fraud analysis requires Shopify Payments; bot protection Plus only) | [1](https://www.shopify.com/pricing) [2](https://help.shopify.com/en/manual/apps/apps-by-shopify) [3](https://shopify.dev/docs/api) |
| `native-integrations` | Platform | Google Analytics, Mailchimp and WordPress | Vendor-documented integrations with Google Analytics, Mailchimp and WordPress (Sell on WordPress). | web | not stated | [1](https://help.shopify.com/en/manual/reports-and-analytics) [2](https://help.shopify.com/en/manual/customers) [3](https://help.shopify.com/en/manual/apps/apps-by-shopify) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | yes | yes |

Admin CSV exports cover products, customers, orders, transactions and inventory but omit product images and some store data; the GraphQL Admin API with async bulk query operations (JSONL) reaches core objects, subject to scopes (orders older than 60 days need read_all_orders, which Shopify must approve). Products, orders and customers queries accept updated_at range filters, and webhooks exist but Shopify says delivery is not guaranteed and tells apps to run reconciliation jobs.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Export products (CSV) | Product and variant data, customised SEO title/description, fulfillment service and inventory tracker. Product images are not included in the CSV. | CSV | Browser download when every product has fewer than 100 variants; emailed if any product exceeds 100 variants or for full catalogue exports. Exporting thousands of variants can time out, so the docs say to split the export with filters. No row limit stated. | not stated | [1](https://help.shopify.com/en/manual/products/import-export/export-products) |
| Export customers (CSV) | Standard customer fields (name, email, phone, address, marketing preferences), with optional customer tags and supported metafields. Order information is not in the customer CSV. | CSV | Up to 50 customers download in the browser; more than 50 are emailed. Exported CSV files are limited to 15 MB. | not stated | [1](https://help.shopify.com/en/manual/customers/import-export-customers) |
| Export orders / Export transaction histories (CSV) | Full order data (extra line items on separate rows, historical prices as of order creation), or transactions only. The transaction history covers captured payments only, not authorizations. | CSV | Up to 50 orders or the current page download; more than 50, or export by date, is emailed to the user and the store owner. The docs say fewer than 100,000 items may finish in under an hour and 400,000 items around 4 hours. | not stated | [1](https://help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders) |
| Inventory CSV export | Current inventory quantities per variant for one location or all locations, as 'All states' (a row per location with every inventory state) or 'Available' (locations as columns). | CSV | The inventory CSV can't exceed 15 MB. | not stated | [1](https://help.shopify.com/en/manual/products/inventory/getting-started-with-inventory/inventory-csv) |
| Download theme | Theme code download. It does not include products, collections, menus, pages, blog posts, images or other files in Content > Files. | unknown | Purchased Theme Store themes are licensed only to the store that bought them. The page does not say how the download is delivered. | not stated | [1](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| GraphQL Admin API bulk query operations (bulkOperationRunQuery) | bulk-export | An async job runs any supported query and returns a signed JSONL download URL that expires after one week. From API version 2026-01, up to five bulk queries per app per shop can run at once (one per type before that). Each query allows at most five connections, nested at most two levels deep; the connections must implement Node, and the top-level node/nodes fields can't be used. A job must finish within 10 days or it is marked failed. Bulk operations don't have the single-query max cost or the rate limits. | [1](https://shopify.dev/docs/api/usage/bulk-operations/queries) [2](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits.md) |
| GraphQL Admin API connection queries with search syntax (updated_at filter) | incremental | The products, orders and customers queries accept updated_at range filters in the query argument (for example updated_at:>'2020-10-21T23:39:20Z'). The search syntax docs warn that range queries on large collections may be slow or time out when the search field differs from the sort key. Pagination caps at 25,000 objects, including for count queries. | [1](https://shopify.dev/docs/api/usage/search-syntax.md) [2](https://shopify.dev/docs/api/admin-graphql/latest/queries/products.md) [3](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders.md) [4](https://shopify.dev/docs/api/admin-graphql/latest/queries/customers.md) [5](https://shopify.dev/docs/api/usage/limits) |
| Webhooks | webhooks-events | Topic subscriptions (for example orders/create, products/update) delivered to an HTTPS URL, Google Pub/Sub or Amazon EventBridge; they are HMAC-signed and deduplicated with X-Shopify-Webhook-Id. Ordering is not guaranteed within or across topics, and neither is delivery, so Shopify tells apps to run periodic reconciliation jobs. | [1](https://shopify.dev/docs/apps/build/webhooks.md) |
| GraphQL Admin API | read-api | The main read API for all store objects. Every request carries an access token in the X-Shopify-Access-Token header. Queries that cost too much return an error pointing to bulk operations. | [1](https://shopify.dev/docs/api/admin-graphql/latest.md) |

### Auth for a third-party importer

**Models:** oauth-app, personal-token, admin-consent

Apps use access tokens with declared access scopes. read_orders/write_orders cover only orders from the last 60 days; older orders need read_all_orders, which Shopify must approve, and several other scopes also need approval. Protected customer data: a public app must request level 1 (customer data without name, address, phone, email) and level 2 (with those fields) in the Partner Dashboard, pass review, and take part in data protection reviews for level 2. Custom apps always get both levels; admin-created custom apps get level 2 depending on plan, and the help centre says Custom Level 2 PII apps need the Grow plan or higher and are unavailable on Basic. Custom apps are now created in the Dev Dashboard by the store owner or staff with the App development > Develop permission (collaborators can't); legacy custom apps created before 2026-01-01 remain.

Sources: [1](https://shopify.dev/docs/api/usage/access-scopes.md) [2](https://shopify.dev/docs/apps/launch/protected-customer-data.md) [3](https://help.shopify.com/en/manual/apps/app-types/custom-apps) [4](https://shopify.dev/docs/api/admin-graphql/latest.md)

### Rate limits and quotas

GraphQL Admin API: calculated query cost in a leaky bucket per app and store. Restore rates are Standard 100 points/second, Advanced Shopify 200, Shopify Plus 1000, Shopify for enterprise (Commerce Components) 2000. A single query may not exceed 1,000 points. The example response shows maximumAvailable 1000 and restoreRate 50. Bulk operations are exempt from the max cost and rate limits. Array inputs max 250 items; pagination caps at 25,000 objects. Once a store has 500,000 variants, at most 10,000 new variants per day (not on Plus). REST per-plan numbers were not captured.

Sources: [1](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits.md) [2](https://shopify.dev/docs/api/usage/limits) [3](https://shopify.dev/docs/api/admin-graphql/latest.md)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| attachments-files | The product CSV does not include product images. Theme downloads exclude images and other files in Content > Files, so media has to come through the API or a separate download. | [1](https://help.shopify.com/en/manual/products/import-export/export-products) [2](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes) |
| history-audit | Order history older than 60 days needs the read_all_orders scope, which Shopify must approve. Exported transaction history includes captured payments only, not authorizations. | [1](https://shopify.dev/docs/api/usage/access-scopes.md) [2](https://help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders) |
| permissions | Customer name, address, email and phone are protected fields. A public importer app needs a level 2 request, review and data protection reviews. Custom apps have access, but admin-created custom apps need the Grow plan or higher. | [1](https://shopify.dev/docs/apps/launch/protected-customer-data.md) [2](https://help.shopify.com/en/manual/apps/app-types/custom-apps) |
| metadata-config | The theme download excludes products, collections, menus, pages and blog posts, so online-store content has to be exported separately. The customer CSV has no order data, and its Total Spent/Total Orders columns are read-only store data. | [1](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes) [2](https://help.shopify.com/en/manual/customers/import-export-customers) |
| other | Large admin CSV exports arrive by email rather than direct download, and 15 MB caps apply to customer and inventory CSVs, so a full UI export of a big store is manual and multi-file. | [1](https://help.shopify.com/en/manual/customers/import-export-customers) [2](https://help.shopify.com/en/manual/products/inventory/getting-started-with-inventory/inventory-csv) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Store Migration app (and the migrating-to-Shopify guides) | into-vendor | An App Store app plus guides for moving products, customers, historical orders, gift cards/store credits, blogs and pages from Amazon, Clover, Etsy, eBay, GoDaddy, Lightspeed, Square, Squarespace, Wix and WooCommerce. The page documents no route out of Shopify. | [1](https://help.shopify.com/en/manual/migrating-to-shopify/store-importer) |

### Limits of the data-out scan

- SCAN — unreviewed, 2026-09-30. Several help.shopify.com facts come from WebFetch summaries, not raw text; shopify.dev facts were read from the raw .md pages with curl.
- The per-plan REST Admin API bucket numbers and the Storefront limits were not captured.
- Not checked: extraction of Shopify Flow automations, analytics/report data, payouts, gift cards, discounts, metaobjects or the Theme (asset) API; no claim is made about these.
- The store-importer URL was summarised as a general 'migrating to Shopify' page naming a 'Store Migration' app; the app's exact capabilities were not detailed there.
- No official out-of-Shopify migration tooling seen; the one page checked documents none.
- No injected instructions noticed in fetched pages.

| Kind | What | Result |
|---|---|---|
| fetch | https://shopify.dev/docs/api/admin-graphql (HTML via curl) | JS-rendered; rate-limit section not in the HTML, used the .md variant instead |
| fetch | https://shopify.dev/docs/api/admin-graphql/rate-limits | no rate-limit text; the real page is /docs/apps/build/apis/graphql-admin/rate-limits |

## Limits of this scan

- Pricing page compare table covers Basic, Grow, Advanced and Plus only; Starter comes from a separate help page, and the help plan list also names Lite, Retail, Shopify for enterprise and Agentic plans that were not scanned.
- Google Play listings for the Shopify and Shopify POS apps returned no readable content, so Android surfaces are asserted only where Shopify's own help says Android.
- Several help pages (Inbox root, Online store Forms, POS Pro, Messaging) returned only navigation; details came from search snippets or the pricing page.
- Plan requirements pages for users/activity log and Subscriptions eligibility were not fetched; those lowestTier values are null.
- About 33 WebFetch calls used, above the ~25 guide; 4 WebSearch calls.
- No injected instructions seen in fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://play.google.com/store/apps/details?id=com.shopify.mobile | empty/truncated |
| fetch | https://play.google.com/store/apps/details?id=com.shopify.pos&hl=en_US | empty/truncated |
| fetch | https://help.shopify.com/en/manual/shopify-inbox | navigation only |
| fetch | https://help.shopify.com/en/manual/online-store/forms | not the Forms page |
| fetch | https://help.shopify.com/en/manual/sell-in-person/pos-pro | navigation hub only, no Pro vs Lite detail |
