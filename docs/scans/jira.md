# Jira (TGT-07): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

40 capability areas (40 confirmed from sources, 0 unconfirmed). Generated from `jira.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

Jira Cloud, the single 'Jira' product formed when Jira Software and Jira Work Management merged (announced May 2024), on the Free, Standard, Premium and Enterprise plans, including Rovo AI and agent features bundled into Jira plans.

Left out of this scan:

- Jira Service Management (separate ITSM/service desk product)
- Confluence (separate wiki product; only its Jira integrations noted)
- Jira Product Discovery (separate product)
- Loom (separate video product)
- Bitbucket (separate code hosting; appears only as a dev-tool integration)
- Rovo as a standalone product (only Rovo features included in Jira plans are scanned)
- Atlassian Guard as a product (noted only as the SSO add-on)
- Jira Data Center / Server (not cloud)
- Jira Align (separate enterprise agile product)

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | Jira (Cloud web app) | not stated | [1](https://www.atlassian.com/software/jira/pricing) |
| ios | Jira Cloud by Atlassian | iPhone and iPad (iOS/iPadOS 18.0 or later) | [1](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) |
| android | Jira Cloud by Atlassian | Android | [1](https://play.google.com/store/apps/details?id=com.atlassian.android.jira.core) |
| other | Atlassian Command-Line Interface (acli) | not stated | [1](https://www.atlassian.com/software/jira/pricing) |

## Public API

**Style:** REST (JSON) v3 plus Jira Software agile REST API; webhooks; Forge app platform

Auth via OAuth 2.0 (3LO) apps, Forge apps, or basic auth with API tokens; rate limiting is documented on a dedicated page. Separate agile API covers boards, sprints, backlog, epics, builds, deployments, feature flags and development information.

Sources: [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) [2](https://developer.atlassian.com/cloud/jira/software/rest/intro/)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `issues-work-items` | Work management | Work items (formerly issues) | Unlimited work items with types, fields, assignees and statuses, viewable as list, board, calendar, timeline and summary views inside spaces (formerly projects). | web, ios, android, api | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) [3](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) |
| `boards-kanban` | Work management | Board view | Kanban/Scrum boards showing work moving through the team's workflow columns; company-managed boards can be based on JQL filters. | web, api | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/software/rest/intro/) [3](https://support.atlassian.com/jira-software-cloud/docs/create-a-board/) |
| `sprints-agile` | Work management | Backlog view and sprints | Backlog view plus Scrum sprints planned from the Backlog tab, with sprint, burndown and velocity reports. | web, api | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/what-is-a-sprint/) [3](https://developer.atlassian.com/cloud/jira/software/rest/intro/) |
| `roadmaps-timelines` | Work management | Timeline view; Advanced planning (Plans) | Single-space timeline for planning and dependencies on all plans; cross-team, cross-space Plans with scenario modelling and expandable work type hierarchy on higher tiers. | web, ios, api | Free (Timeline view on Free; Advanced planning (Plans), Scenario Modeling and expandable hierarchy on Premium) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) [3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `issue-workflows` | Work management | Customizable workflows | Custom workflows with statuses, transitions and workflow rules for moving work from to do to done. | web, api | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `releases-versions` | Work management | Versions and releases | Group work into versions, track release progress on a release page and version report, and release a version; cross-project releases in Plans. | web, api | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/release-your-teams-work-in-versions/) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `dependencies` | Work management | Dependency management | Link work items that block or depend on each other and visualise them on the timeline; cross-space dependencies need Plans. | web, api | Free (single project on Free/Standard; cross-project on Premium) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `dev-tool-integration` | Work management | Development tools | Connect Bitbucket, GitHub and other SCM/CI tools to see branches, commits, PRs, builds and deployments on work items and auto-transition work on repo events. | web, api | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/configure-development-tools/) [2](https://developer.atlassian.com/cloud/jira/software/rest/intro/) |
| `goals-okrs` | Work management | Unlimited goals | Create goals, link work items to them and share status updates on goals and projects (via Atlassian Home). | web | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/link-issues-to-goals-in-the-issue-view/) |
| `capacity-resource-planning` | Work management | Capacity management | Allocate each person's time to epics, tasks or non-specific work in hours, days or percentages, and monitor capacity in Plans. | web | Premium | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/resources/) |
| `custom-fields-objects` | Platform | Custom fields and work types | Admin-defined custom fields (text, dropdowns, dates, labels, user pickers) and work types; Premium adds custom hierarchy levels above epic. | web, api | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `forms` | Platform | Unlimited forms | Drag-and-drop form builder with conditional fields that collect data and create work items. | web, ios | Free | [1](https://www.atlassian.com/software/jira/pricing) [2](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) [3](https://support.atlassian.com/jira-software-cloud/docs/create-a-form/) |
| `workflow-automation` | Platform | Automation | Rule-based automation flows within a space, across spaces or site-wide, including AI and coding-agent actions. | web | Free (150 steps per subscription per month on Free; 400/750/1,000 steps per user per month on Standard/Premium/Enterprise) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/set-up-ai-automations-using-recommended-templates/) |
| `templates` | Platform | Templates; Custom templates | Space templates by team function with preconfigured work types and workflows; custom space templates on Enterprise. | web, api | Free (Custom templates: Enterprise) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `reporting-dashboards` | Platform | Reports and insights; Dashboards; Atlassian Analytics | Custom reports and summary dashboards with charts (including AI-created charts), agile reports (burndown, velocity, cycle time, deployment frequency), shared dashboards; Atlassian Analytics, Data Lake and data connectors on Enterprise. | web, ios, api | Free (Atlassian Analytics, Data Lake, data connectors: Enterprise) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/create-and-edit-dashboards/) [3](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) |
| `search` | Platform | Search and JQL | Basic and advanced search with Jira Query Language, saved filters, and Rovo natural-language search for work items. | web, api | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/what-is-advanced-search-in-jira-cloud/) [2](https://support.atlassian.com/jira-software-cloud/docs/use-atlassian-intelligence-to-search-for-work-items/) [3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `data-import-export` | Platform | CSV importer and export | Import or bulk-update work items from CSV; export search results to CSV, Excel, Word, XML or Google Sheets; export Plans data as CSV. | web, api | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/) [2](https://support.atlassian.com/jira-software-cloud/docs/export-search-results/) |
| `notifications` | Platform | Notifications | Email notifications configurable per space (notification schemes), watching work items, and push notifications on mobile; Free is capped at 100 emails per day. | web, ios, api | Free (100 emails/day on Free; unlimited on paid) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/customize-notifications-in-team-managed-projects/) [3](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) |
| `comments-mentions` | Platform | Comments, watch and share | Comment on work items, @mention teammates, watch and share work items. | web, ios, api | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/watch-share-and-comment-on-a-work-item/) [2](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) [3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `file-storage` | Platform | Attachments and storage | Attach files to work items; storage of 2 GB on Free, 250 GB on Standard, unlimited on Premium/Enterprise. | web, ios, api | Free (2 GB Free / 250 GB Standard / unlimited Premium+) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/add-an-attachment-to-an-issue/) [3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `time-tracking` | Finance | Time tracking | Estimate and log time on work items with original/remaining estimates shown in reports. | web, api | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/log-time-on-an-issue/) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `approvals` | Platform | Approvals | Add approval steps to workflows so reviewers sign off before work advances; approvable on mobile. | web, ios | Premium | [1](https://www.atlassian.com/software/jira/pricing) [2](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) [3](https://support.atlassian.com/jira-software-cloud/docs/set-up-approvals-in-jira/) |
| `users-teams` | Platform | Users, teams and employee directory | Users per site (10 on Free, up to 100,000 on paid), groups, Atlassian teams and an employee directory of people and teams. | web, api | Free (10-user limit on Free) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `roles-permissions` | Platform | User roles and permissions | Roles, permission schemes and space-level permissions; on Free every user is an admin. | web, api | Standard | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `external-collaboration` | Collaboration | Free guest access; Anonymous access | Invite outside collaborators as guests without a paid seat, and let anonymous users view and create work items. | web | Standard | [1](https://www.atlassian.com/software/jira/pricing) |
| `sso-identity` | Platform | Atlassian Guard Standard (SSO, SCIM, Active Directory Sync) | SAML SSO, SCIM provisioning and AD sync via Atlassian Guard; multiple IdPs on Enterprise. | web | Free (Requires Atlassian Guard Standard subscription on Free/Standard/Premium; included in Enterprise) | [1](https://www.atlassian.com/software/jira/pricing) |
| `audit-log` | Platform | Audit logs | Audit log of site configuration changes on Standard+; comprehensive user-activity audit logging on Enterprise; audit records API. | web, api | Standard (user-activity audit logs: Enterprise) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `compliance-security` | Platform | Security and data residency | Encryption in transit and at rest, password policies, MDM for mobile, work item-level security (Standard+), data residency (Standard+), IP allowlisting (Premium+). | web, ios, android, api | Free (data residency and work item security from Standard; IP allowlisting from Premium) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) |
| `sandbox-environments` | Platform | Sandbox | Sandbox copy for testing products and apps before changing production; release tracks to control cloud change rollout. | web | Premium | [1](https://www.atlassian.com/software/jira/pricing) |
| `admin-console` | Platform | Atlassian Administration | Organisation admin: domain verification and account capture, session duration, admin insights (Premium), release tracks, site optimizer, product requests and centralized user subscriptions (Enterprise). | web | Free (admin insights Premium; user counts, product requests Enterprise) | [1](https://www.atlassian.com/software/jira/pricing) |
| `app-marketplace` | Platform | Apps and integrations | Thousands of third-party apps and integrations built for Jira, installed from the Atlassian Marketplace. | web | Free | [1](https://www.atlassian.com/software/jira/pricing) |
| `developer-platform` | Platform | Forge; Atlassian CLI; Teamwork Graph CLI | Forge app platform (custom fields, UI modifications, JQL functions), the Atlassian Command-Line Interface on all plans, and the Teamwork Graph CLI for coding agents on paid plans. | api | Free (Teamwork Graph CLI: Standard+) | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) [2](https://www.atlassian.com/software/jira/pricing) |
| `api-webhooks` | Platform | Jira Cloud REST API and webhooks | REST API v3 and the Jira Software (agile) REST API, with webhooks, OAuth 2.0 (3LO), basic auth with API tokens and documented rate limiting. | api | not stated | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) [2](https://developer.atlassian.com/cloud/jira/software/rest/intro/) |
| `native-integrations` | Platform | Slack, Microsoft Teams, Confluence integrations | Vendor-built apps to create, update and get notifications for Jira work from Slack and Microsoft Teams, plus Confluence embeds of boards, dashboards, releases and plans. | web | not stated | [1](https://support.atlassian.com/jira-software-cloud/docs/use-jira-cloud-with-slack/) [2](https://support.atlassian.com/jira-software-cloud/resources/) |
| `ai-assistant` | Platform | Atlassian Rovo (Search, Chat) in Jira | Rovo search, chat and AI features such as creating work items with Rovo and natural-language search; usage metered in pooled monthly credits. | web | Standard (25/70/150 Rovo credits per user per month on Standard/Premium/Enterprise; Free plan excludes Rovo) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/use-atlassian-intelligence-to-search-for-work-items/) |
| `ai-agents` | Platform | Agents in Jira; Jira Coding Agent; Third-party agents | Assign work items to Rovo and third-party agents (Claude, Cursor, GitHub Copilot), track them in Agent Sessions, use the Jira Coding Agent in a cloud sandbox, and govern with AI governance; Rovo Studio builds custom agents on Premium+. | web | Standard (Rovo Studio: Premium) | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-jira-coding-agent/) [3](https://support.atlassian.com/jira-software-cloud/docs/work-with-ai-agents-in-jira/) |
| `low-code-builder` | Platform | Rovo Studio | Build agents, automations and apps in plain language, no code required. | web | Premium | [1](https://www.atlassian.com/software/jira/pricing) |
| `mobile-app` | Platform | Jira Cloud by Atlassian | Native iPhone/iPad and Android apps to create and edit work, comment, attach files, view roadmaps and reports, approve work and get push notifications. | ios, android | not stated | [1](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087) [2](https://play.google.com/store/apps/details?id=com.atlassian.android.jira.core) |
| `asset-management` | Service | Assets objects | Assets object records available inside Jira. | web | Standard (Standard and Premium single-site customers; rollout to others in progress) | [1](https://www.atlassian.com/software/jira/pricing) |
| `archiving` | Platform | Space archiving; archive work items | Archive inactive spaces and their work items to keep the site focused on current work. | web, api | Premium | [1](https://www.atlassian.com/software/jira/pricing) [2](https://support.atlassian.com/jira-software-cloud/docs/archive-an-issue/) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | yes | partial |

The site backup (Backup manager) exports work items, fields, comments, boards/sprints, users, attachments and space configuration including workflows and schemes, but excludes automation flows, third-party app data, JSM Assets, Opsgenie-powered features and some Jira Product Discovery data. The REST API supports JQL search (updated-since via JQL), changelogs, attachments, workflows and webhooks for issue/comment/worklog/attachment events, but the site backup itself is documented only as a UI action in Backup manager.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Backup for cloud (Backup manager) | Site backup of work items and field content (system and custom), board and sprint data, users and group settings, comments, optional media (attachments, avatars, logos, custom template icons), space configuration (workflows, global permissions, schemes, screens, custom field configuration, work types, board configuration) and Advanced Roadmaps. Unzips to activeobjects.xml, entities.xml and data/attachments, data/avatars, logos directories. | ZIP, XML | Backups can be run at any time, but with attachments/avatars/logos included you must allow 48 hours between backups. Recommended limits: total data size 25 GB, attachment size 50-100 GB. Organization admins can block exports. Starting Jan 22, 2026, Backup Manager limits restores to backups 30 days old or less. 'Backup for server' was discontinued from June 30, 2025. | not stated | [1](https://support.atlassian.com/jira-cloud-administration/docs/export-issues/) |
| Export CSV from the Issue Navigator | Asynchronous export of the work items matching a JQL filter, with current fields or all fields. | CSV (current fields), CSV (all fields), Excel CSV (all fields) | Up to 10,000 work items per export; the pager/start URL workaround (1,000 per batch) is marked deprecated as of March 2026; recommended workaround is splitting by JQL into batches under 10,000. Google Sheets / Microsoft Excel apps are an alternative. | not stated | [1](https://support.atlassian.com/jira/kb/export-over-10-000-work-items-in-jira-cloud/) |
| Export flows (Jira automation) | Downloads all global and project-scoped automation flows in one file; requires a global administrator. | JSON | JSON file max 5MB (export in multiple segments if larger); import/export supported only for one-to-one migrations, not federation or consolidation. | not stated | [1](https://support.atlassian.com/cloud-automation/docs/import-and-export-jira-automation-rules/) |
| Atlassian Backup and Restore | Add-on for on-demand or scheduled (daily or weekly, via backup policies) backups and restores; needs organization admin and app admin permissions. Backups kept in Atlassian-owned storage. | not stated | Purchasable add-on only for Premium or Enterprise plans. Backups retained 30 days, expire on the 31st day. Jira/JSM (up to 300 GB, 7M attachments): 24-hour RPO, 12-hour RTO. Amazon S3 storage for backups no longer available except for customers who used it in the past. | Premium (paid add-on) | [1](https://support.atlassian.com/organization-administration/docs/overview-of-atlassian-backups/) [2](https://support.atlassian.com/organization-administration/docs/understand-billing-for-atlassian-backup-and-restore/) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| JQL enhanced search (GET/POST /rest/api/3/search/jql) | incremental | Searches issues by JQL (so an 'updated >=' clause gives an updated-since pull) with nextPageToken pagination, maxResults, fields, expand and includeArchivedProjects. Doc warns recent updates might not be immediately visible; reconcileIssues gives read-after-write consistency. POST /rest/api/3/search/approximate-count returns a count. The older /rest/api/3/search is marked deprecated / being removed. | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) |
| Issues API (bulk fetch, changelogs) | read-api | POST /rest/api/3/issue/bulkfetch, GET /rest/api/3/issue/{id}, GET /rest/api/3/issue/{id}/changelog, POST /rest/api/3/issue/{id}/changelog/list, and POST /rest/api/3/changelog/bulkfetch (paginated changelogs for multiple issues, filterable by field) give per-issue field history. | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/) |
| Issue attachments API | read-api | GET /rest/api/3/attachment/content/{id} returns attachment bytes (supports HTTP Range), plus attachment metadata and thumbnails; attachment metadata with content URLs appears on the issue. | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/) |
| Workflows API | read-api | GET /rest/api/3/workflow/search, workflow history, usages by project/issue type and workflow schemes; configuration can be read by API. | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflows/) |
| Audit records (GET /rest/api/3/auditing/record) | read-api | Admin audit records filterable by text and created-from/created-to dates; requires Administer Jira global permission. | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-audit-records/) |
| Webhooks | webhooks-events | Events include jira:issue_created/updated/deleted, comment_created/updated/deleted, worklog_created/updated/deleted, attachment_created/deleted, issuelink_created/deleted, issue_property_set/deleted, sprint events and more, with JQL filtering for issue-scoped events. Registered in Jira Administration (admin webhooks), in a Connect descriptor, or dynamically by REST for Connect and OAuth 2.0 apps (POST /rest/api/3/webhook). Dynamic webhooks expire 30 days after creation/refresh (extend via REST); limit of 5 webhooks per app per user on a tenant for OAuth apps; deliveries carry an identifier stable across retries and an X-Atlassian-Webhook-Retry header. | [1](https://developer.atlassian.com/cloud/jira/platform/webhooks/) |

### Auth for a third-party importer

**Models:** oauth-app, api-key, basic, other

OAuth 2.0 (3LO) apps are created in the developer console; offline_access scope yields refresh tokens; sharing a 3LO app with other users requires enabling Distribution, and users installing an unreviewed integration see a warning until Atlassian reviews it. Scripts can use basic auth with account email + API token (passwords deprecated); API tokens expire in 1 to 365 days, and scoped API tokens call api.atlassian.com/ex/jira/{cloudId}. Forge and Connect apps have built-in auth (Connect uses JWT). Audit records need manage:jira-configuration / Administer Jira.

Sources: [1](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) [2](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) [3](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)

### Rate limits and quotas

Points-based hourly quota for Forge, Connect and OAuth 2.0 (3LO) apps: Tier 1 Global Pool (default) 65,000 points/hour shared across all tenants; Tier 2 Per-Tenant Pool (assigned after review) Standard 100,000 + 10 x users, Premium 130,000 + 20 x users, Enterprise 150,000 + 30 x users points/hour, capped at 500,000. Each request has a base cost of 1 point plus points per object; writes cost only the base. Default per-endpoint burst limits of GET 100, POST 100, PUT 50, DELETE 50 requests per second (some endpoints have custom limits) and per-issue write limits of 20 writes per 2 seconds and 100 per 30 seconds. Exceeding returns 429 with Retry-After and RateLimit-Reason. API token traffic is not affected by the points model and stays under burst limits.

Sources: [1](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| automations-workflows | Automation flows are not included in the site backup; they must be exported separately as JSON by a global admin (5MB cap per file). No automation REST API is mentioned on that page. Workflows themselves are in the backup and readable via the workflows API. | [1](https://support.atlassian.com/jira-cloud-administration/docs/export-issues/) [2](https://support.atlassian.com/cloud-automation/docs/import-and-export-jira-automation-rules/) |
| other | Site backup cannot export third-party apps and app data, JSM features powered by Opsgenie (alerts, on-call schedules), Assets for JSM, app access settings, or Jira Product Discovery views configurations, insights and vote fields. Custom email passwords are not copied in a cloud-to-cloud restore. | [1](https://support.atlassian.com/jira-cloud-administration/docs/export-issues/) |
| attachments-files | Including attachments/avatars/logos in a backup forces a 48-hour gap between backups, and Atlassian recommends staying within 50-100 GB of attachments; by API, attachments are fetched one at a time per attachment id. | [1](https://support.atlassian.com/jira-cloud-administration/docs/export-issues/) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/) |
| history-audit | Field history is available per issue via changelog endpoints (and bulk changelog fetch), but CSV export does not carry it; audit records require Administer Jira global permission. | [1](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-audit-records/) |
| other | Deletions: JQL search only finds existing issues, so a delta sync needs the jira:issue_deleted / comment_deleted / worklog_deleted webhooks to see removals. Search is eventually consistent ('recent updates might not be immediately visible'). | [1](https://developer.atlassian.com/cloud/jira/platform/webhooks/) [2](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Backup restore (Import backup data into Jira Cloud / Data Center) | both | Restore a cloud backup (entities.xml + activeobjects.xml + media) into another Jira Cloud site or into Jira Data Center. | [1](https://support.atlassian.com/jira-cloud-administration/docs/export-issues/) |
| CSV / JSON / Trello / Bitbucket importers | into-vendor | Import work items from CSV (including the PVCS command), JSON, Trello and Bitbucket; a separate 'Migrate from other work trackers' path is documented. | [1](https://support.atlassian.com/jira-cloud-administration/docs/import-issues/) |

### Limits of the data-out scan

- No public REST endpoint to trigger or download the site backup was found; the backup page documents only the Backup manager UI (the 'download large backup files using cURL' KB title was seen in search but not fetched).
- Jira Cloud Migration Assistant and cloud-to-cloud 'Transfer data' were not fetched; not characterised.
- Whether the Backup manager is available on the Free plan is not stated on the fetched page; lowestTier left null.
- Audit log retention period was not found on the fetched API page.
- No injected instructions were noticed in fetched pages.

| Kind | What | Result |
|---|---|---|
| fetch | https://support.atlassian.com/jira-cloud-administration/docs/back-up-your-data/ | 404 |
| fetch | https://support.atlassian.com/cloud-automation/docs/export-and-import-automation-rules/ | empty (wrong URL); found the right one by search |

## Limits of this scan

- No official Atlassian desktop app: the Jira Cloud for Mac app (2019, Mac Catalyst) was sunset per https://www.atlassian.com/blog/jira/jira-cloud-app-for-mac, and https://jira.atlassian.com/browse/JRACLOUD-78044 is an open 'Gathering Interest' request. Third-party 'Desktop App for Jira' listings exist (Microsoft Store, Mac App Store, seen in search results) requiring a Marketplace add-on; not Atlassian's, so desktop-app is omitted.
- Pricing page is JS-rendered; WebFetch returned nothing useful, so the plan/feature matrix was read from the embedded structured data in the raw HTML (curl). Prices were not captured.
- Google Play listing could not be read by WebFetch; Android presence is from search results only.
- Rovo MCP Server (Standard+) and Teamwork Graph noted on pricing but folded into ai-agents/developer-platform rather than separate entries.
- Tiers for releases, search/JQL, time tracking, dev-tool integration, import/export, comments and native integrations are not stated on the pricing page, so lowestTier is null.
- Calendar view, list view and summary view are all on Free per pricing but have no dedicated vocabulary id; folded into issues-work-items.
- No injected instructions observed in fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://www.atlassian.com/software/jira/pricing | WebFetch returned truncated/empty content (JS-rendered); worked around with curl of raw HTML |
| fetch | https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/ | WebFetch returned truncated content; worked around with curl |
| fetch | https://play.google.com/store/apps/details?id=com.atlassian.android.jira.core | WebFetch returned truncated content; description not extracted |
| fetch | https://support.atlassian.com/jira-software-cloud/docs/what-is-the-development-panel/ and 5 other guessed doc URLs | 404 (guessed paths); replaced with paths from the docs index |
