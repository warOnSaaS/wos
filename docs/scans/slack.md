# Slack (TGT-03): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

40 capability areas (40 confirmed from sources, 0 unconfirmed). Generated from `slack.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

Slack on all plans the pricing page shows: Free, Pro, Business+ and Enterprise+ (the page no longer shows an 'Enterprise Grid' plan; help articles call multi-workspace deployments an 'Enterprise organization'). Covers the web/desktop/mobile clients, AI features, Slack Connect, Workflow Builder and the public developer platform.

Left out of this scan:

- GovSlack (a separate public-sector offering built on Enterprise+)
- Salesforce products beyond their Slack surface (Agentforce, Sales Elevate, Tableau)
- Third-party Marketplace apps (translation bots, etc.)
- Slack Atlas pricing detail (contact sales)

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| desktop | Slack desktop app | macOS, Windows, Linux | [1](https://slack.com/downloads) |
| ios | Slack | iPhone, iPad, Apple Vision | [1](https://apps.apple.com/us/app/slack/id618783545) |
| android | Slack | Android | [1](https://play.google.com/store/apps/details?id=com.Slack) [2](https://slack.com/downloads) |
| web | Slack in a browser (admin dashboard opens in the browser) | not stated | [1](https://slack.com/help/articles/115005594006-Guide-to-the-Slack-admin-dashboard) |

## Public API

**Style:** REST-style Web API (JSON, 100+ methods); Events API over HTTP or Socket Mode (WebSocket); incoming webhooks; MCP server

OAuth apps with bot and user tokens; rate limits are tiered per method and enforced per app per workspace (HTTP 429 with Retry-After), and apps may post about one message per second per channel. Admin, SCIM, Audit Logs, Discovery, Real-time Search and Status APIs sit alongside; the legacy RTM API is deprecated.

Sources: [1](https://docs.slack.dev/apis/) [2](https://docs.slack.dev/apis/web-api/rate-limits/) [3](https://docs.slack.dev/changelog/2026/02/17/slack-mcp/)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `channels` | Collaboration | Channels | Persistent public and private conversation spaces organised by team, project or topic; the core unit of work in Slack. | desktop, ios, android, api | Free | [1](https://slack.com/pricing) [2](https://slack.com/features) [3](https://apps.apple.com/us/app/slack/id618783545) |
| `direct-messages` | Collaboration | Direct messages (DMs) | One-to-one and small-group private conversations, with per-conversation notification settings. | ios | not stated | [1](https://slack.com/help/articles/360056534254-Manage-notifications-for-specific-channels-and-direct-messages) [2](https://apps.apple.com/us/app/slack/id618783545) |
| `threads-reactions` | Collaboration | Threads and emoji reactions | Reply to a message in a thread to keep discussion out of the main channel; react with emoji and see who reacted. Reactions are exposed through the Web API (reactions.add). | api | not stated | [1](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions) [2](https://slack.com/help/articles/202931348-Use-emoji-and-reactions) [3](https://api.slack.com/methods/reactions.add) |
| `presence-status` | Collaboration | Status and availability | Custom status messages, an availability (active/away) indicator, pausing notifications, and status that can sync from a connected calendar. | not shown | not stated | [1](https://slack.com/help/articles/201864558-Set-your-Slack-status-and-availability) [2](https://slack.com/help/articles/4412365549075-Automations--Sync-your-status-with-your-calendar) |
| `notifications` | Platform | Notifications | Desktop and mobile notification preferences: everything vs mentions and DMs, per-channel exceptions, and work-hours scheduling. | not shown | not stated | [1](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications) [2](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications) |
| `comments-mentions` | Platform | Mentions and canvas comments | @mentions drive notifications; canvases support co-editing with comments and threads. | not shown | not stated | [1](https://slack.com/features/canvas) [2](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications) |
| `search` | Platform | Search / AI search / Enterprise search | Search across people, channels, messages and files on every plan; AI search answers on Business+; enterprise search across connected third-party apps and custom sources on Enterprise+. The Real-time Search API exposes permission-aware search to apps. | ios, android, api | Free (AI search Business+; enterprise search Enterprise+) | [1](https://slack.com/pricing) [2](https://slack.com/features/enterprise-search) [3](https://docs.slack.dev/changelog/2026/02/17/slack-mcp/) |
| `external-collaboration` | Collaboration | Slack Connect and guests | Slack Connect channels and DMs with other organisations (up to 250 organisations per channel), plus multi-channel and single-channel guest accounts. | api | Free (Slack Connect is 1:1 only on Free; guest accounts are paid plans only) | [1](https://slack.com/pricing) [2](https://slack.com/help/articles/360035092414-Use-Slack-Connect-to-work-with-other-companies-in-channels) [3](https://slack.com/help/articles/202518103-Understand-guest-roles-in-Slack) |
| `audio-huddles` | Collaboration | Huddles | Drop-in audio calls that start in a channel or DM, with optional video, huddle thread messages, reactions and effects; shared links and files are saved after the huddle. | desktop, ios, android | Free (Free: two people, 30-minute limit; group huddles on paid plans) | [1](https://slack.com/pricing) [2](https://slack.com/features/huddles) |
| `screen-sharing` | Meetings | Screen sharing in huddles and clips | Share a screen during a huddle or record the screen in a clip. | desktop, ios, android | Free (huddles 1:1 only on Free) | [1](https://slack.com/pricing) [2](https://slack.com/features/huddles) [3](https://slack.com/features/clips) |
| `async-video-clips` | Collaboration | Clips | Record audio, video or screen clips up to five minutes, with captions, transcripts and playback speed control; unlimited on all plans. | ios, android | Free | [1](https://slack.com/features/clips) [2](https://slack.com/pricing) [3](https://play.google.com/store/apps/details?id=com.Slack) |
| `transcription-captions` | Meetings | Huddle notes and clip transcripts | AI huddle notes capture transcripts, key takeaways and action items into a canvas; clips have captions and transcripts. | ios, android | Free (clip captions on all plans; AI huddle notes from Pro) | [1](https://slack.com/pricing) [2](https://slack.com/features/huddles) [3](https://slack.com/features/clips) |
| `docs-wiki` | Platform | Canvases | Rich documents inside Slack, attached to channels and DMs or standalone, embedding files, lists, workflows and app unfurls, with AI writing assistance. | desktop, ios | Free (Free teams: canvases in channels only; pricing table marks canvases from Pro; AI writing in canvas Business+) | [1](https://slack.com/pricing) [2](https://slack.com/features/canvas) [3](https://apps.apple.com/us/app/slack/id618783545) |
| `lists-databases` | Collaboration | Lists | Structured lists for tracking projects, requests and tasks, with assignees, due dates, workflow triggers, canvas embedding and sharing over Slack Connect. | ios | Pro (included in all paid plans) | [1](https://slack.com/pricing) [2](https://slack.com/features/task-list) [3](https://apps.apple.com/us/app/slack/id618783545) |
| `tasks` | Platform | Reminders, Later and list tasks | Personal reminders and saved items in the Later tab, plus assignable tasks with due dates in lists. | android | not stated | [1](https://slack.com/help/articles/208423427-Set-a-reminder) [2](https://slack.com/features/task-list) [3](https://play.google.com/store/apps/details?id=com.Slack) |
| `file-storage` | Platform | File sharing | Share files up to 1GB from devices or cloud storage apps (Google Drive, OneDrive/SharePoint, Box, Dropbox); pin files; files are searchable and follow channel permissions. AI file summaries on Business+. | android | Free (Free keeps 90 days of message and file history) | [1](https://slack.com/features/document-sharing) [2](https://slack.com/pricing) [3](https://play.google.com/store/apps/details?id=com.Slack) |
| `templates` | Platform | Templates | Pre-made and customizable templates for channels, canvases, lists and workflows. | android | Pro (user-created on Pro and Business+; admin-created on Enterprise+) | [1](https://slack.com/pricing) [2](https://play.google.com/store/apps/details?id=com.Slack) |
| `workflow-automation` | Platform | Workflow Builder | No-code workflows with AI generation, a Generate AI response step, conditional branching (up to 15 conditions) and 70+ app connectors; workflows run from messages, canvases, bookmarks and lists. | api | Pro (conditional branching, AI workflow generation and AI steps from Business+) | [1](https://slack.com/pricing) [2](https://slack.com/features/workflow-automation) |
| `approvals` | Platform | Approvals in workflows | Workflows route requests and approvals; apps let users approve requests without leaving Slack. | android | not stated | [1](https://slack.com/features/workflow-automation) [2](https://play.google.com/store/apps/details?id=com.Slack) |
| `bots-slash-commands` | Collaboration | Shortcuts and slash commands | Built-in and app slash commands and a shortcuts menu that runs apps and workflows from the message field; developers can implement custom slash commands. | api | not stated | [1](https://slack.com/help/articles/360057554553-Use-shortcuts-to-take-actions-in-Slack) [2](https://api.slack.com/interactivity/slash-commands) |
| `app-marketplace` | Platform | Slack Marketplace | A directory of 2,600+ reviewed third-party and Slack apps and agents that install into a workspace. | ios, android | Free (Free limited to 10 apps; unlimited on paid plans) | [1](https://slack.com/pricing) [2](https://slack.com/marketplace) [3](https://slack.com/help/articles/202035138-Add-apps-to-your-Slack-workspace) |
| `native-integrations` | Platform | Salesforce in Slack and first-party connectors | Salesforce records and data in channels, Salesforce/Sales Elevate integrations, Google Drive, OneDrive/SharePoint and Workflow Builder connectors. | not shown | Free (Salesforce data in channels on all plans) | [1](https://slack.com/pricing) [2](https://slack.com/features) [3](https://slack.com/features/document-sharing) |
| `calendar-scheduling` | Platform | Google Calendar and Outlook Calendar apps | Calendar apps show events and notifications, join video calls, find common availability and schedule meetings from a channel or DM, and update status during meetings. | not shown | not stated | [1](https://slack.com/help/articles/13368080520211-Calendar-apps-for-Slack) [2](https://slack.com/help/articles/360020134853-Microsoft-Outlook-Calendar-for-Slack) [3](https://slack.com/help/articles/4412450133139-Automations--Schedule-a-meeting-in-Slack) |
| `api-webhooks` | Platform | Web API, Events API, incoming webhooks | Web API (100+ methods), Events API and Socket Mode for event delivery, incoming webhooks, plus Admin, SCIM, Audit Logs, Discovery, Real-time Search and Status APIs. | api | not stated | [1](https://docs.slack.dev/apis/) [2](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) [3](https://docs.slack.dev/apis/web-api/rate-limits/) |
| `developer-platform` | Platform | Slack platform: CLI, Bolt, SDKs | Slack CLI, Bolt and SDKs for Java, JavaScript and Python, Block Kit and work objects, custom workflow steps, and custom functions deployed on Slack infrastructure. | api | Pro (deploying apps to Slack infrastructure and custom workflow steps from Pro) | [1](https://docs.slack.dev/) [2](https://slack.com/features/agentic-platform) [3](https://slack.com/pricing) |
| `ai-assistant` | Platform | AI in Slack | Channel and thread summaries, huddle notes, daily recaps, file summaries, message explanations, translations and writing help in canvases. | ios, android | Pro (summaries and huddle notes from Pro; recaps, file summaries, translations and writing from Business+) | [1](https://slack.com/pricing) [2](https://slack.com/features/ai) [3](https://apps.apple.com/us/app/slack/id618783545) |
| `ai-agents` | Platform | Slackbot, Agentforce, AI apps and the MCP server | Slackbot as a personal AI agent that researches, builds dashboards and acts across connected apps; Agentforce agents; third-party AI assistant apps; Slack Code channels where teams guide coding agents; a Slack MCP server and MCP client for outside agents. | ios, api | Pro (AI assistant apps from Pro; Slackbot agent from Business+ with plan limits) | [1](https://slack.com/pricing) [2](https://slack.com/features/slackbot) [3](https://slack.com/features/code-channels) |
| `sso-identity` | Platform | SSO, 2FA and SCIM | Two-factor authentication on all plans; Google OAuth sign-in on Pro; SAML SSO on Business+ and multiple SAML configurations on Enterprise+; SCIM provisioning (including guests on Enterprise+). | api | Free (2FA on Free; SAML and SCIM from Business+) | [1](https://slack.com/pricing) [2](https://slack.com/help/articles/212572638-Manage-members-with-SCIM-provisioning) |
| `roles-permissions` | Platform | Roles and posting permissions | Owner, admin, member and guest roles; channel posting permissions; granular admin roles on Enterprise+. | not shown | Free (posting permissions limited to #general below Business+; granular roles Enterprise+) | [1](https://slack.com/pricing) [2](https://slack.com/help/articles/360018112273-Types-of-roles-in-Slack) |
| `users-teams` | Platform | Members, user groups and workspaces | Invite members and guests, create custom user groups, and on Enterprise+ run unlimited workspaces in one organisation. | not shown | Free (custom user groups from Pro; multiple workspaces Enterprise+) | [1](https://slack.com/pricing) [2](https://slack.com/help/articles/115004952926-Manage-user-groups-from-the-admin-dashboard) |
| `audit-log` | Platform | Audit logs and access logs | Access logs on paid plans; audit logs of changes and usage viewable in Slack, exportable to CSV or via the Audit Logs API on Enterprise+. | api | Pro (access logs from Pro; audit logs Enterprise+) | [1](https://slack.com/pricing) [2](https://docs.slack.dev/apis/) |
| `compliance-security` | Platform | Security and compliance controls | Encryption at rest and in transit, retention policies, session and device management, data residency, native DLP, information barriers, legal holds, HIPAA support, anomaly event response and Enterprise Key Management; SOC 2, ISO 27001 and FedRAMP Moderate are stated. | not shown | Free (retention up to 1 year on Free; data residency Business+; DLP, legal holds, HIPAA, information barriers Enterprise+; EKM Enterprise+ add-on) | [1](https://slack.com/pricing) [2](https://slack.com/features) |
| `data-import-export` | Platform | Import and export tools | Owners and admins export public channel data; full exports on Business+; single-user exports and the Discovery API on Enterprise+; an import tool moves data between workspaces. | api | Free (all-message exports Business+; single-user exports and Discovery API Enterprise+) | [1](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) [2](https://slack.com/help/articles/201658943-Export-your-workspace-data#request-to-export-data) [3](https://slack.com/pricing) |
| `admin-console` | Platform | Admin dashboard and workspace settings | Workspace settings and an organisation admin dashboard in the browser that applies settings, members, channels and apps across all workspaces in an Enterprise organisation; flagged-content management, domain claiming and custom terms of service on Enterprise+. | web, api | not stated | [1](https://slack.com/help/articles/115005594006-Guide-to-the-Slack-admin-dashboard) [2](https://slack.com/help/articles/360000281563-Manage-apps-in-an-Enterprise-organization) [3](https://slack.com/pricing) |
| `reporting-dashboards` | Platform | Admin analytics | Analytics dashboards on members, channels and messages; message activity analytics and an Admin analytics API; Slackbot can also build charts and dashboards in a conversation. | api | Pro (admin analytics API and message activity analytics from Business+) | [1](https://slack.com/pricing) [2](https://slack.com/features/slackbot) |
| `pipelines-deals` | CRM | Slack CRM / Track leads & deals | A native CRM driven by Slackbot to create accounts, update records, log calls and notes and track leads and deals; related rows cover support emails and meeting prep. | not shown | Business+ (upon request on Enterprise+) | [1](https://slack.com/pricing) [2](https://slack.com/features/slackbot) |
| `hr-people` | Operations | Slack Atlas | Rich employee profiles and a dynamic org chart populated from HR systems via SCIM, including view-only profiles for people not on Slack. | not shown | Business+ (paid add-on on Business+; included in Enterprise+) | [1](https://slack.com/features/atlas) |
| `multi-currency-localization` | Platform | Language and region, AI translations | Per-user and admin default language settings, and AI translation of messages into a chosen language. | not shown | not stated (AI language translations from Business+) | [1](https://slack.com/blog/collaboration/bienvenue-willkommen-bienvenidos-to-a-more-globally-accessible-slack) [2](https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack) [3](https://slack.com/pricing) |
| `mobile-app` | Platform | Slack for iOS and Android | Native apps for iPhone, iPad, Apple Vision and Android with channels, huddles with screen sharing, clips, AI search and AI huddle notes; voice input to Slackbot. | ios, android | not stated | [1](https://apps.apple.com/us/app/slack/id618783545) [2](https://play.google.com/store/apps/details?id=com.Slack) [3](https://slack.com/features/huddles) |
| `desktop-app` | Platform | Slack desktop app | Desktop apps for Mac, Windows and Linux. | desktop | not stated | [1](https://slack.com/downloads) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | partial | partial |

Every plan can export public channels (JSON ZIP), but private channels and DMs need an application approved by Slack (Free/Pro: only with legal process, member consent or a legal right; Business+/Enterprise: a self-serve tool that must be requested), and exports carry file links, not files. The Web API can read history with oldest/latest timestamp filters and the Events API pushes changes, but new commercially distributed non-Marketplace apps get 1 request per minute and 15 objects per call on conversations.history/replies; the full-fidelity Discovery API is Enterprise-only and limited to eDiscovery, archiving and DLP.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Export (public channels) | Messages and file links from public channels (plus public Salesforce channels); ZIP containing channels.json, users.json, integration_logs.json, canvases.json (a URL per canvas) and one folder per channel with one JSON file per day. | JSON, ZIP | Workspace Owners and Admins. File links only, not the files. Free: data more than a year old is not included and file links cover only the last 90 days. On Pro, with Slack Connect channels, only links to files shared by your own members are included. | Free | [1](https://slack.com/help/articles/201658943-Export-your-workspace-data) [2](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) [3](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports) |
| Export all channels and conversations (application or self-serve tool) | Messages and file links from public channels, private channels and DMs, including Slackbot conversations; adds dms.json, groups.json, mpims.json and a folder per private channel and DM. | JSON, ZIP | Free and Pro: Workspace Owners must apply, and Slack rejects applications without valid legal process, member consent, or a legal requirement or right. Business+: Workspace Owners apply for a self-serve tool; approval from the Workspace Primary Owner is required. Enterprise: Org Owners contact Support to request access. Edited and deleted messages appear only if retention settings keep them. | Business+ (self-serve after approval); Free/Pro only by approved application | [1](https://slack.com/help/articles/201658943-Export-your-workspace-data) [2](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) [3](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports) |
| Schedule recurring exports | Weekly or monthly scheduled export of all channels and conversations. Each export contains only that period's data. | JSON, ZIP | Business+ only, after approval for the all-conversations export. Shown as not available on Enterprise. | Business+ | [1](https://slack.com/help/articles/201658943-Export-your-workspace-data) |
| Channel audit report | A CSV list of channels and their details for migration planning. | CSV | Business+ Workspace Owners must request it; Enterprise Org Owners get it after Support enables export tools. | Business+ | [1](https://slack.com/help/articles/201658943-Export-your-workspace-data) |
| Custom data export / single-user export (Enterprise) | Export by conversation type, member or workspace, or all conversations for a single user. Single-user exports in TXT format include the files themselves (folders: channels, dms, files). | JSON, TXT, ZIP | Enterprise Org Owners, after requesting access from Support. Enterprise exports cannot be imported into other workspaces. Workspace-specific exports exclude multi-workspace channels. | Enterprise | [1](https://slack.com/help/articles/201658943-Export-your-workspace-data) [2](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) [3](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| Discovery API | bulk-export | Enterprise only. Org Owners use approved third-party eDiscovery or DLP apps to pull the org's full history from the start, including edits and deletions if retention or legal hold keeps them: messages, files (as direct download links), canvases, lists, emoji reactions and Slackbot conversations, as JSON. It may only be used for security and compliance cases (eDiscovery, archiving, DLP). The Primary Org Owner or an Org Owner must request that it be enabled. No public reference docs were found on docs.slack.dev. | [1](https://slack.com/help/articles/360002079527-A-guide-to-Slacks-Discovery-APIs) [2](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) |
| conversations.history / conversations.replies (Web API) | read-api | Reads a conversation's messages with cursor pagination and oldest/latest Unix-timestamp filters; call it with no oldest or latest to read the whole history. Default limit 100, maximum 999, except 15 for restricted apps. It reaches conversations the token's user or bot is a member of: a user token sees all public conversations plus that user's private ones. Tier 3 for Marketplace and internal apps. | [1](https://docs.slack.dev/reference/methods/conversations.history/) [2](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps.md) |
| Events API | webhooks-events | Pushes subscribed events (for example message.channels, message_changed, message_deleted, file_created, file_deleted) over an HTTP request URL or Socket Mode, limited to what the authorising users or bot can see. Needs a 2xx response within three seconds; failed deliveries are retried 3 times (almost immediately, then after 1 minute, then after 5 minutes). | [1](https://docs.slack.dev/apis/events-api.md) [2](https://docs.slack.dev/reference/events/message/message_changed) |
| files.info / files.list | read-api | File metadata, including url_private and url_private_download links and share locations (channels, groups, ims). files.info is Tier 4. | [1](https://docs.slack.dev/reference/methods/files.info) [2](https://docs.slack.dev/messaging/working-with-files.md) |
| Audit Logs API | other | Listed in the docs sitemap as an admin API. Not read in detail for this scan. | [1](https://docs.slack.dev/admins/audit-logs-api) |

### Auth for a third-party importer

**Models:** oauth-app, admin-consent

Apps install through OAuth and receive bot and/or user tokens; which conversations they can read depends on *:history scopes and channel membership. On Enterprise, when 'Approve apps' is on, a member must request the app and an admin must approve it before install. admin.* scopes need an OAuth install on the Enterprise org, started by an org admin or owner. Under the API Terms updated in May 2025, the Slack Marketplace is the only allowed channel for commercially distributing apps (listed or unlisted), and non-Marketplace distributed apps get reduced history limits. A customer's own internal app keeps the higher limits. The Discovery API is available only through approved partner apps on Enterprise.

Sources: [1](https://docs.slack.dev/reference/methods/conversations.history/) [2](https://docs.slack.dev/admins/managing-app-approvals.md) [3](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps.md) [4](https://slack.com/help/articles/360002079527-A-guide-to-Slacks-Discovery-APIs)

### Rate limits and quotas

Web API limits apply per method, per workspace, per app, in one-minute windows. Tier 1: 1+ per minute. Tier 2: 20+. Tier 3: 50+. Tier 4: 100+. There is also a Special tier. Every plan gets the same tier. Over the limit returns HTTP 429 with Retry-After. Methods that support cursor pagination get stricter limits when called without it. Since May 29, 2025, new commercially distributed non-Marketplace apps, and new installs of existing ones, get conversations.history and conversations.replies at 1 request per minute, with the limit parameter's maximum and default cut to 15. Existing installs of those apps are unaffected. Internal customer-built apps keep 50+ per minute and up to 1,000 objects. Events API: at most 30,000 deliveries per workspace per app per 60 minutes, after which app_rate_limited events are sent. Posting: about 1 message per second per channel.

Sources: [1](https://docs.slack.dev/apis/web-api/rate-limits/) [2](https://docs.slack.dev/reference/methods/conversations.history/) [3](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps.md) [4](https://docs.slack.dev/apis/events-api.md)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| permissions | Private channels and DMs are not in the standard export on any plan. Getting them needs an application that Slack approves (on Free/Pro only with legal process, member consent, or a legal right), or Enterprise Discovery API partner apps. Through the Web API, a token reads only conversations its user or bot belongs to. | [1](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) [2](https://docs.slack.dev/reference/methods/conversations.history/) |
| attachments-files | Workspace exports hold file links, not the files. Free workspaces get links only for the last 90 days. With Slack Connect, only links to files your own members shared are included. Files come as files only in Enterprise single-user TXT exports and through the Discovery API (as download links). | [1](https://slack.com/help/articles/201658943-Export-your-workspace-data) [2](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) |
| history-audit | Edited and deleted messages appear in exports only if retention keeps them. Free exports leave out data more than a year old. Retention policies can empty whole date ranges. Full edit and delete history is promised only by the Enterprise Discovery API. | [1](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports) [2](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) [3](https://slack.com/help/articles/360002079527-A-guide-to-Slacks-Discovery-APIs) |
| other | Canvases appear in exports only as a URL per canvas in canvases.json, and public-channel exports list only canvases shared in public channels. Canvas and list content is named only for the Discovery API. | [1](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports) [2](https://slack.com/help/articles/360002079527-A-guide-to-Slacks-Discovery-APIs) |
| automations-workflows | The export contents table lists no Workflow Builder workflows, app configurations or user groups; only app activity logs (integration_logs.json). No workflow export was found in the export docs checked. | [1](https://slack.com/help/articles/220556107-How-to-read-Slack-data-exports) |
| other | Rate limits make bulk history reading impractical for a third-party importer that is neither in the Marketplace nor built internally by the customer (1 request per minute, 15 messages per call on conversations.history and replies). Slack states the limits are there to stop bulk data exfiltration by unvetted apps. | [1](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps.md) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Slack import tool | into-vendor | Imports member, message and channel data from one Slack workspace to another on Free, Pro and Business+. It does not support Enterprise orgs, which import into a separate workspace and then migrate it. | [1](https://slack.com/help/articles/204897248-Guide-to-Slack-import-and-export-tools) |
| Discovery API eDiscovery/DLP partners (e.g. Global Relay, Smarsh, Hanzo, Relativity, Onna) | out-of-vendor | Approved third-party apps that archive Enterprise Slack data into their own data stores. They serve compliance use only, and coverage varies by partner. | [1](https://slack.com/help/articles/360002079527-A-guide-to-Slacks-Discovery-APIs) |

### Limits of the data-out scan

- No public Discovery API reference was found: docs.slack.dev/enterprise/discovery-api/ redirected to the docs home page and the docs sitemap has no Discovery pages. Its methods, rate limits and incremental options are therefore unconfirmed.
- Not confirmed whether conversations.history's oldest filter catches edits or deletions of older messages. Only new-message filtering is documented; edits arrive as message_changed events.
- Not checked: whether url_private file downloads need a bearer token, or which scopes the file download needs.
- Did not check a workflow-definition export (for example Workflow Builder download) outside the export articles.
- Did not read the Audit Logs API or Real-time Search API docs in detail.
- Pages were read as raw HTML stripped to text, or as the .md versions on docs.slack.dev, not through WebFetch summaries. No injected instructions were seen.

| Kind | What | Result |
|---|---|---|
| fetch | https://docs.slack.dev/enterprise/discovery-api/ | redirected to docs home page; no Discovery API content |
| fetch | https://docs.slack.dev/apis/events-api/.md | Not found (the .md form without trailing slash worked) |

## Limits of this scan

- Slack plan tiers came from the server-rendered comparison table on slack.com/pricing, parsed cell by cell with curl. Two WebFetch summaries of the same page put features in the wrong plan columns (for example SCIM, audit logs and data exports shown on Pro), so those summaries were thrown away.
- The pricing table marks Canvases as not on Free, but the canvas feature page says Free teams can use canvases in channels. Both are recorded in tierNote.
- The 'web' surface is listed only where a source shows a browser. slack.com/downloads names only desktop and mobile apps, so the web client is under-reported.
- The Google Play description was pulled from the listing's raw HTML because WebFetch returned a truncated page. The device list (tablet, Chromebook) was not confirmed.
- Many help-centre sources are search-result snippets rather than fetched pages.
- No injected instructions were seen in fetched content.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://play.google.com/store/apps/details?id=com.Slack | WebFetch returned truncated/empty content; used curl on the listing HTML instead |
| fetch | https://slack.com/pricing | WebFetch summaries gave plan-column mappings that contradicted each other; replaced with a direct HTML parse |
