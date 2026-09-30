# Zoom (TGT-04): scan

> **SCAN — unreviewed, 2026-09-30.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.

51 capability areas (50 confirmed from sources, 1 unconfirmed). Generated from `zoom.json` by `tools/scans/build.ts`; edit the JSON, not this file.

## Scope

Zoom Workplace (Meetings, Zoom Chat, Phone, Mail & Calendar, Scheduler, Whiteboard, Canvas/Docs, Clips, Tasks, Hub, Video Management, Rooms, Workspace Reservation, Visitor Management, Digital Signage, Workvivo, ZoomMate formerly AI Companion) plus Zoom Webinars/Events at catalog level, on the Basic / Pro / Business / Enterprise plans the pricing page shows.

Left out of this scan:

- Zoom Contact Center, Zoom Virtual Agent, Zoom Quality Management, Zoom Workforce Management (the 'Zoom CX' group in the API docs) — separate customer-service suite
- Zoom Revenue Accelerator and Zoom Auto Dialer — sales conversation-intelligence add-ons
- Video SDK, Cobrowse SDK and AI Services as sellable build products (named only under developer-platform)
- Healthcare, Commerce, Number Management, Customer Managed Keys Hybrid, Zoom Node / on-premise AI — specialist Business Services and deployment options
- Bonsai and BrightHire — acquired products linked from the product menu, outside Workplace

## The product's own client apps

| Surface | App | Platforms | Sources |
|---|---|---|---|
| web | Zoom Web App | Web browsers and Chromebook | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064261) [2](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059744) |
| desktop | Zoom Workplace App | macOS, Windows, Linux | [1](https://zoom.us/download) [2](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060928) |
| ios | Zoom Workplace | iPhone and iPad (iOS 15+), Apple Watch, Apple Vision | [1](https://apps.apple.com/us/app/zoom-workplace/id546505307) |
| android | Zoom Workplace | Android; separate 'Zoom Workplace for Intune' listing | [1](https://play.google.com/store/apps/details?id=us.zoom.videomeetings&hl=en_US) [2](https://play.google.com/store/apps/details?id=us.zoom.videomeetings4intune&hl=en) |
| other | Zoom Rooms Client | not stated | [1](https://zoom.us/download) |
| browser_extension | Browser Extension | Chrome (per download page summary) | [1](https://zoom.us/download) |
| email_addin | Outlook Plug-in; Zoom Plugin for HCL Notes | Microsoft Outlook; HCL Notes (Windows MSI) | [1](https://zoom.us/download) |

## Public API

**Style:** REST (JSON) at https://api.zoom.us/v2/; webhooks; WebSockets event delivery (public beta)

OAuth 2.0 and Server-to-Server OAuth, tokens valid one hour. Reference sections cover Meetings, Chat, Phone, Mail, Calendar, Scheduler, Rooms, Clips, Whiteboard, Chatbot, Canvas, Tasks, My Notes, Hub, Webinars Plus & Events, Users, Accounts, SCIM 2. Account-level rate limits (per-second and daily) return HTTP 429.

Sources: [1](https://developers.zoom.us/docs/api/)

## Capability areas

Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.

| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |
|---|---|---|---|---|---|---|
| `video-meetings` | Meetings | Zoom Meetings | Scheduled and instant HD video/audio meetings with backgrounds, noise suppression and continuous meeting chat; the core of Zoom Workplace. | web, ios, desktop, api | Basic (Basic: 40 minutes and 100 participants per meeting; Pro 30 hours; Business 300 participants; Enterprise 1,000+) | [1](https://www.zoom.com/en/products/virtual-meetings/) [2](https://zoom.us/pricing) [3](https://apps.apple.com/us/app/zoom-workplace/id546505307) |
| `screen-sharing` | Meetings | Screen sharing and annotation | Sharing screens in meetings with annotation, and sharing whiteboards, docs and third-party assets into the meeting. | web, desktop | not stated | [1](https://www.zoom.com/en/products/virtual-meetings/) |
| `meeting-recording` | Meetings | Cloud and local recording | Local recording on all plans and cloud recording on paid plans, with AI highlights, smart chapters and summaries of recordings. | web, api | Pro (Basic is local recording only; Pro/Business 10 GB cloud per license; Enterprise unlimited cloud) | [1](https://zoom.us/pricing) [2](https://www.zoom.com/en/products/collaboration-tools/features/) |
| `transcription-captions` | Meetings | Automated captions, translated captions, Voice Translator | Automated captions in meetings, translated captions (33 languages stated) and live audio translation (Voice Translator) in the ZoomMate plan. | web, desktop | Basic (Automated captions on all plans; translated captions listed for Enterprise; Voice Translator in paid ZoomMate plan) | [1](https://zoom.us/pricing) [2](https://www.zoom.com/en/products/collaboration-tools/features/) [3](https://www.zoom.com/en/products/ai-assistant/) |
| `meeting-controls` | Meetings | Breakout rooms, waiting room, polls and surveys | Host controls including waiting room, breakout rooms, polling and surveys, reactions and custom meeting themes. | web, desktop | Basic (Breakout rooms on all plans; polling from Pro) | [1](https://zoom.us/pricing) [2](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059359) [3](https://www.zoom.com/en/products/collaboration-tools/features/) |
| `webinars-events` | Meetings | Zoom Webinars and Zoom Events | Registration-based webinars, recurring series, multi-session virtual and hybrid events with lobbies, expo floors, Production Studio, on-demand libraries and certificates, up to 100,000 attendees stated. | web, api | Enterprise (Enterprise Workplace plan lists 500-attendee webinars; standalone webinar/event pricing not captured) | [1](https://www.zoom.com/en/products/webinars/) [2](https://zoom.us/pricing) [3](https://developers.zoom.us/docs/api/) |
| `phone-calling` | Meetings | Zoom Phone | Cloud PBX with numbers in 49+ countries or BYOC, call queues, shared lines, fax, push to talk, E911, local survivability and AI call summaries. | ios, api | Enterprise (Basic lists in-app VoIP calling; full-featured PBX listed on Enterprise; Zoom Phone also sold standalone (price JS-rendered)) | [1](https://www.zoom.com/en/products/voip-phone/) [2](https://zoom.us/pricing) [3](https://apps.apple.com/us/app/zoom-workplace/id546505307) |
| `sms-messaging` | Marketing | Team SMS (Zoom Phone) | SMS on Zoom Phone numbers, including shared Team SMS threads with AI summaries. | not shown | not stated (marked with an asterisk (conditions) on the product page) | [1](https://www.zoom.com/en/products/voip-phone/) |
| `room-systems` | Meetings | Zoom Rooms | Conference room software on Zoom Certified Hardware with smart name tags, Intelligent Director framing, Zoomie voice facilitator, Direct Guest Join to other platforms and remote room management. | api | Enterprise (Rooms listed on the Enterprise plan; also sold per room) | [1](https://www.zoom.com/en/products/meeting-rooms/) [2](https://zoom.us/pricing) [3](https://developers.zoom.us/docs/api/) |
| `channels` | Collaboration | Zoom Chat channels | Persistent chat channels, including automatic channels per meeting and Shared Spaces grouping several channels for large projects; included in Zoom Workplace. | web, ios, api | Basic (Zoom Chat listed on Basic) | [1](https://www.zoom.com/en/products/team-chat/) [2](https://www.zoom.com/en/products/collaboration-tools/) [3](https://apps.apple.com/us/app/zoom-workplace/id546505307) |
| `direct-messages` | Collaboration | Zoom Chat 1:1 and group chats | One-to-one and group conversations; one channel per person keeps chat, phone and meeting history together. | web, ios, api | Basic | [1](https://www.zoom.com/en/products/team-chat/) [2](https://www.zoom.com/en/products/collaboration-tools/) |
| `threads-reactions` | Collaboration | Threads and emoji reactions | Threaded replies, emoji reactions, mentions, scheduled messages, reminders and folders in Zoom Chat; AI thread summaries. | web | not stated | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918) [2](https://www.zoom.com/en/products/collaboration-tools/features/) |
| `presence-status` | Collaboration | Chat statuses | Statuses beyond available/away: in a meeting, heads down, out of office, presenting. | web | not stated | [1](https://www.zoom.com/en/products/team-chat/) |
| `external-collaboration` | Collaboration | External contacts and Shared Spaces | Bringing external partners into chats and Shared Spaces that combine internal and external teams. | web | not stated | [1](https://www.zoom.com/en/products/team-chat/) |
| `audio-huddles` | Collaboration | Zoom Huddles | **Unconfirmed** (Only the support article title was seen in search results; the article (ServiceNow, JS-rendered) was not fetched, so its behaviour is not confirmed). A support article titled 'Using Zoom Huddles' exists; what it does was not read. | not shown | not stated | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058357) |
| `async-video-clips` | Collaboration | Zoom Clips | Async screen and camera recordings plus AI avatar videos from scripts or slides, AI chapters/titles, translation into up to 2 of 16 languages, branding and view analytics. | web, ios, api | Basic (Basic: 5 two-minute clips; unlimited from Pro) | [1](https://www.zoom.com/en/products/screen-recorder/) [2](https://zoom.us/pricing) [3](https://apps.apple.com/us/app/zoom-workplace/id546505307) |
| `bots-slash-commands` | Collaboration | Chatbots and agents in Chat | Chatbot API for apps in Zoom Chat, and AI agents invoked in chats and channels with @ (public) or / (private). | web, api | not stated | [1](https://developers.zoom.us/docs/api/) [2](https://www.zoom.com/en/products/ai-assistant/) |
| `whiteboard` | Collaboration | Zoom Whiteboard | Infinite canvas with 250+ templates, mind maps, tables, code blocks, LaTeX, AI-generated boards and diagrams from prompts or meeting transcripts, and use on Zoom Rooms for Touch. | web, ios, api | Basic (Basic and Pro: 3 editable boards; unlimited from Business) | [1](https://www.zoom.com/en/products/online-whiteboard/) [2](https://zoom.us/pricing) [3](https://apps.apple.com/us/app/zoom-workplace/id546505307) |
| `docs-wiki` | Platform | Zoom Canvas (formerly Zoom Docs), Paper, Slides, Notes | Canvas: AI workspace of docs, tables and wikis with web publishing. The AI Productivity Suite adds Zoom Paper (Word-ready documents) and Zoom Slides (decks from meeting notes). The App Store listing still says 'Zoom Docs'. | web, ios, api | Basic (Basic: share up to 10 docs (Canvas Basic); unlimited from Pro; Slides/Paper in paid ZoomMate plan) | [1](https://www.zoom.com/en/products/collaborative-docs/) [2](https://www.zoom.com/en/products/collaboration-tools/) [3](https://www.zoom.com/en/products/ai-assistant/) |
| `lists-databases` | Collaboration | Canvas data tables and Zoom Sheets | Dynamic data tables inside Canvas, and Zoom Sheets, AI spreadsheets built from meetings and Zoom data. | web | not stated (Sheets listed in paid ZoomMate plan) | [1](https://www.zoom.com/en/products/collaborative-docs/) [2](https://www.zoom.com/en/products/ai-assistant/) |
| `tasks` | Platform | Zoom Tasks | Action-item tracking with AI that surfaces tasks from meetings, chats and voicemails. | api | not stated (Pro plan card lists 'AI-first task management'; tasks product page returned 404) | [1](https://www.zoom.com/en/products/collaboration-tools/) [2](https://developers.zoom.us/docs/api/) |
| `calendar-scheduling` | Platform | Zoom Scheduler and Zoom Calendar | Booking pages for 1:1, group, collective and round-robin meetings, time polls, embeddable branded pages and routing forms; plus the Zoom Calendar client/service. | web, ios, api | Basic (Basic: 1 personal booking page; unlimited booking pages from Business) | [1](https://www.zoom.com/en/products/appointment-scheduler/) [2](https://zoom.us/pricing) [3](https://www.zoom.com/en/products/collaboration-tools/) |
| `email-calendar-sync` | Platform | Zoom Mail & Calendar Clients | Connects Gmail or Microsoft 365 mail and calendar into the Zoom Workplace app; Scheduler syncs a primary calendar plus up to five others. | desktop, ios | Basic (Clients 'included with all Zoom plans') | [1](https://www.zoom.com/en/products/email-calendar/) [2](https://www.zoom.com/en/products/appointment-scheduler/) |
| `hosted-email` | Collaboration | Zoom Mail Service and Calendar Service | Zoom-hosted mailbox and calendar with custom domains, end-to-end encryption between Zoom Mail accounts, phishing/spam controls, filters, snooze, scheduled send and email translation. | desktop, ios, api | Pro (Pricing lists Zoom Mail and Calendar from Pro) | [1](https://www.zoom.com/en/products/email-calendar/) [2](https://zoom.us/pricing) [3](https://developers.zoom.us/docs/api/) |
| `ai-assistant` | Platform | ZoomMate (formerly AI Companion) and My Notes | AI built into Workplace: meeting summaries and in-meeting questions, My Notes note-taking for Zoom, in-person and third-party meetings, chat/email drafting, thread and voicemail summaries, memory layer and custom summary templates. | web, ios, desktop | Basic (Basic: limited (e.g. 3 meeting summaries, 20 AI queries per month); unlimited summaries from Pro; paid ZoomMate plan adds 2,200 AI credits/user/month) | [1](https://www.zoom.com/en/products/ai-assistant/) [2](https://zoom.us/pricing) [3](https://www.zoom.com/en/products/collaboration-tools/features/) |
| `ai-agents` | Platform | ZoomMate agents | Pre-built agents (Sales, IT, Marketing, Finance) and a custom agent builder with knowledge bank and third-party connectors, deployable to chats and channels; deep research. | web | ZoomMate (Paid ZoomMate plan (price JS-rendered)) | [1](https://www.zoom.com/en/products/ai-assistant/) |
| `workflow-automation` | Platform | ZoomMate Workflows | Workflow builder and templates with triggers from events, schedules or messages that update records, send emails or generate to-do lists. | web | ZoomMate Basic (ZoomMate Basic: 10 runs/month in Zoom apps only; third-party apps in paid ZoomMate) | [1](https://www.zoom.com/en/products/ai-assistant/) [2](https://www.zoom.com/en/products/team-chat/) |
| `approvals` | Platform | Approval routing workflow template | Approval routing offered as a pre-built workflow template. | web | not stated | [1](https://www.zoom.com/en/products/ai-assistant/) |
| `search` | Platform | Search and agentic search | Keyword/filter search across chats, people and files, plus agentic search over transcripts, docs, the web and connected third-party sources. | web | not stated (ZoomMate Basic caps agentic search at 10 files and 3 meetings) | [1](https://www.zoom.com/en/products/team-chat/) [2](https://www.zoom.com/en/products/ai-assistant/) |
| `file-storage` | Platform | Zoom Hub and chat file sharing | Hub centralises recordings, summaries, Canvas, whiteboards and clips in folders with AI file insights; files shared in chat and from Microsoft 365, Google Drive, Figma. | web, api | not stated (Pricing lists Hub on all plans (per WebFetch summary)) | [1](https://www.zoom.com/en/products/hub/) [2](https://www.zoom.com/en/products/team-chat/) [3](https://developers.zoom.us/docs/api/) |
| `video-hosting` | Marketing | Zoom Video Management | Video channels organising webinar, event, clip and meeting recordings with AI search and viewing analytics. | api | not stated | [1](https://www.zoom.com/en/products/video-management/) [2](https://developers.zoom.us/docs/api/) |
| `templates` | Platform | Templates across apps | 250+ Whiteboard templates, Canvas templates (project tracker, CRM, agenda), email templates, custom summary templates and workflow templates. | web | not stated | [1](https://www.zoom.com/en/products/online-whiteboard/) [2](https://www.zoom.com/en/products/collaborative-docs/) [3](https://www.zoom.com/en/products/email-calendar/) |
| `comments-mentions` | Platform | Comments and @mentions | Threaded comments on whiteboards, @mentions of stakeholders in docs and in chat. | web | not stated | [1](https://www.zoom.com/en/products/online-whiteboard/) [2](https://www.zoom.com/en/products/collaboration-tools/) |
| `forms` | Platform | Booking forms, routing forms, surveys | Custom booking form questions and routing forms in Scheduler; meeting surveys and polls. | web | not stated | [1](https://www.zoom.com/en/products/appointment-scheduler/) [2](https://www.zoom.com/en/products/collaboration-tools/features/) |
| `users-teams` | Platform | Users and accounts | Account users, invitations and provisioning, with Users, Accounts and SCIM 2 APIs. | web, api | Basic | [1](https://developers.zoom.us/docs/api/) [2](https://developers.zoom.us/docs/build/roles/) |
| `roles-permissions` | Platform | Role management | Role-based access control with custom roles and privileges; separate role management for Phone and Workspace Reservation. | web, api | not stated | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064983) [2](https://developers.zoom.us/docs/api/references/privileges/) |
| `sso-identity` | Platform | SSO and managed domains | SAML 2.0 or OIDC single sign-on with any identity provider, managed domains, SCIM provisioning. | web, api | Business (Pricing lists 'SSO, managed domains' from Business) | [1](https://zoom.us/pricing) [2](https://library.zoom.com/admin-corner/account-and-endpoint-management/sso-field-guide) [3](https://developers.zoom.us/docs/api/) |
| `audit-log` | Platform | Admin Activity Logs | Read-only log of admin changes with timestamp, user, action and details. | web | not stated | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067251) |
| `compliance-security` | Platform | Encryption, data residency, retention, Compliance Manager | End-to-end encryption, regional data centers, multi-region storage, information barriers, DLP and archiving APIs, chat legal hold, customer managed keys; Zoom Compliance Manager (archiving, eDiscovery, legal hold) as paid option. | web, api | not stated (E2EE on all plans; regional data centers from Pro; DLP/archiving APIs from Business; customer managed key and Compliance Manager as Enterprise options) | [1](https://zoom.us/pricing) [2](https://news.zoom.com/zoom-announces-zoom-compliance-manager/) [3](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0057908) |
| `admin-console` | Platform | Admin portal and web portal | Central account administration, device management and room management. | web | Business (Pricing lists 'Admin portal' from Business (per WebFetch summary)) | [1](https://zoom.us/pricing) [2](https://www.zoom.com/en/products/meeting-rooms/) |
| `reporting-dashboards` | Platform | Zoom Dashboard and reports | Usage dashboards for users, meetings, Rooms, Chat and Whiteboard, an AI dashboard, meeting/webinar history reports, space occupancy analytics. | web, api | Pro (Pricing lists reporting from Pro (per WebFetch summary)) | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061622) [2](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060623) [3](https://zoom.us/pricing) |
| `api-webhooks` | Platform | Zoom REST API, webhooks and WebSockets | REST API at api.zoom.us/v2 across Workplace products, webhook event subscriptions and WebSocket events (public beta). | api | not stated | [1](https://developers.zoom.us/docs/api/) |
| `developer-platform` | Platform | Zoom Developer Platform | Build platform with Video SDK, Cobrowse SDK, AI Services and Zoom Apps that embed in the client. | api | not stated | [1](https://developers.zoom.us/docs/api/) [2](https://developers.zoom.us/docs/platform/) |
| `app-marketplace` | Platform | Zoom App Marketplace | Directory of Zoom Apps and integrations for Meetings, Webinars, Rooms, Phone and Chat (search snippet states nearly 3,000 apps). | web | Basic | [1](https://marketplace.zoom.us/) [2](https://www.zoom.com/en/zoom-apps/) |
| `native-integrations` | Platform | Integrations and connectors | Microsoft 365, Google, Salesforce, Jira, ServiceNow, Workday, Asana, Figma connectors for Chat and ZoomMate; Outlook plug-in and browser extension; Direct Guest Join to other meeting platforms. | web, desktop | not stated | [1](https://www.zoom.com/en/products/team-chat/) [2](https://www.zoom.com/en/products/ai-assistant/) [3](https://zoom.us/download) |
| `data-import-export` | Platform | Mail bulk migration and compliance export | Bulk migration of users' mail from Gmail or Microsoft 365; export of held communications via Compliance Manager. | web | not stated | [1](https://www.zoom.com/en/products/email-calendar/) [2](https://news.zoom.com/zoom-announces-zoom-compliance-manager/) |
| `multi-currency-localization` | Platform | Languages and translation | Site and app in about 19 languages, email translation into 30+ languages, Clips translation, and a currency selector on pricing. | web | not stated | [1](https://zoom.us/pricing) [2](https://www.zoom.com/en/products/email-calendar/) [3](https://www.zoom.com/en/products/screen-recorder/) |
| `mobile-app` | Platform | Zoom Workplace (iOS, Android) | Mobile app with Meetings, Chat, Phone, Whiteboard, Docs, Mail/Calendar, Clips, My Notes, AI assistant and Scheduler; also Apple Watch and Vision Pro, plus an Intune variant on Android. | ios, android | Basic | [1](https://apps.apple.com/us/app/zoom-workplace/id546505307) [2](https://play.google.com/store/apps/details?id=us.zoom.videomeetings&hl=en_US) [3](https://play.google.com/store/apps/details?id=us.zoom.videomeetings4intune&hl=en) |
| `desktop-app` | Platform | Zoom Workplace desktop app | Desktop client for macOS, Windows and Linux, plus Zoom Rooms client and plug-ins. | desktop | Basic | [1](https://zoom.us/download) [2](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060928) |
| `workplace-facilities` | Collaboration | Workspace Reservation, Visitor Management, Digital Signage | Desk and room booking with AI recommendations, floor maps, QR/Wi-Fi check-in and occupancy sensors; guest check-in with badge printing; digital signage for employee comms. | web, desktop | Enterprise (Pricing lists workspace reservation and visitor management on Enterprise) | [1](https://www.zoom.com/en/products/meeting-rooms/features/workspace/) [2](https://www.zoom.com/en/products/collaboration-tools/) [3](https://zoom.us/pricing) |
| `employee-engagement` | Collaboration | Workvivo | Employee communication and engagement platform (company updates, recognition, community) marketed inside Zoom Workplace. | not shown | not stated (not on the Workplace pricing page) | [1](https://www.zoom.com/en/products/collaboration-tools/) |

## Getting data out

How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.

| Full extraction | Incremental (delta) | By API |
|---|---|---|
| partial | partial | yes |

Cloud recordings, Team Chat messages and files, phone recordings/call logs/voicemails, whiteboards and Docs all have read or export APIs, but many list/report endpoints only accept one-month windows and some reports only reach back six months (past meeting details: one year), so full history is not guaranteed by API. Incremental sync is possible via date-range queries and webhooks (recording.completed, chat_message.*, team_chat.*), but webhooks have no ordering or delivery guarantee and stop after three retries.

### Export options

| Export | What it exports | Formats | Limits | Lowest tier | Sources |
|---|---|---|---|---|---|
| Chat History report (Team Chat) | Account owners/admins with Chat History permission can view and locally download all messages sent and received by users: text, files, images, emoji reactions, GIFs, audio messages, code snippets. Messages can be stored in Zoom's cloud up to 10 years. | CSV, HTML | CSV export max 50 million messages; HTML max 1 million; files over 50 MB not included; after the export reaches 1 GB further files are not included. Requires cloud message storage enabled and advanced chat encryption disabled. | Pro | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061552) [2](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060329) |
| Cloud recording download (web portal) | Recordings are downloaded one meeting at a time; within a meeting 'Download (n files)' pulls all its files. Recording management offers an Export that produces a CSV of recording metadata (host email, meeting ID, topic, date, file size), not the media. | CSV | Zoom states there is no direct way to bulk download multiple cloud recordings at once in the web portal. | Pro | [1](https://x.com/Zoom/status/2026620640107597859) [2](https://developers.zoom.us/docs/api/meetings/) |
| Whiteboard Export | Per-board export from the whiteboard menu: PDF (most content, static), PNG (frame-by-frame or whole board), CSV (sticky notes and tables), PowerPoint. | PDF, PNG, CSV, PPTX | not stated | not stated | [1](https://library.zoom.com/zoom-workplace/zoom-whiteboard/zoom-whiteboard-explainer) |
| Zoom Docs Export | Per-document export from the More menu; data tables can export as CSV. Seen only in third-party tutorials and community threads (including a report that Markdown export disappeared); not confirmed on a Zoom help page. | PDF, CSV, Markdown | not stated | not stated | [1](https://www.guideflow.com/tutorial/how-to-export-a-document-as-a-pdf-in-zoom-docs) [2](https://community.zoom.com/docs-7/why-has-the-docs-markdown-export-feature-disappeared-80066) |

### Bulk, incremental and event APIs

| API | Kind | What it gives an importer | Sources |
|---|---|---|---|
| Cloud Recording API (GET /users/{userId}/recordings, GET /meetings/{meetingId}/recordings) | read-api | Lists a user's cloud recordings with download_url per file (download with the OAuth access token or download_access_token); from/to max range one month; trash=true lists trashed recordings (no date filter); recording_source_type covers My Notes recordings. Pro or higher; rate label MEDIUM. No account-wide recordings list was found on the Meetings API page, so an importer iterates users. | [1](https://developers.zoom.us/docs/api/meetings/) |
| Reports API (/report/users/{userId}/meetings, /report/meetings/{meetingId}, /report/cloud_recording, /report/operationlogs, /report/activities) | read-api | Past meetings/webinars per user (one-month window within past six months, only meetings with two or more unique participants), meeting detail, recording storage usage, operation (admin audit) logs, sign-in/out activity (one month per request within last six months). Pro or higher; mostly HEAVY rate label. GET /past_meetings/{meetingId} cannot access meetings more than one year old. | [1](https://developers.zoom.us/docs/api/meetings/) |
| Archiving API (GET /archive_files, /past_meetings/{meetingUUID}/archive_files) | bulk-export | Account-level list of archived meeting/webinar files with download_url, for compliance archiving (e.g. FINRA); requires the Meeting and Webinar Archiving feature enabled by Zoom Support. | [1](https://developers.zoom.us/docs/api/meetings/) |
| Team Chat API (channels, messages, files, sessions) | read-api | GET /chat/users/{userId}/channels, GET /chat/users/{userId}/messages (per contact or channel; from/to date-time; include_deleted_and_edited_message; thread replies via /messages/{id}/thread), GET /chat/users/{userId}/sessions, GET /chat/files/{fileId} (download_url, SHA-256 digest), spaces, contacts. For account-level apps, messages can only be read on behalf of a user with the Edit permission for Chat Messages. | [1](https://developers.zoom.us/docs/api/chat/) |
| Chat reports (GET /report/chat/sessions, /report/chat/sessions/{sessionId}) | incremental | Admin-wide chat sessions and messages; one-month window within last six months; include_fields for edited/deleted messages; query_all_modifications lets the window be based on modification time, usable for delta sync. Pro or higher. | [1](https://developers.zoom.us/docs/api/chat/) |
| Legal Hold API (/chat/legalhold/matters, /matters/{matterId}/files/download) | bulk-export | Lists legal hold matters and downloads held chat files; RESOURCE-INTENSIVE rate label. | [1](https://developers.zoom.us/docs/api/chat/) |
| Zoom Phone API (/phone/call_history, /phone/call_logs, /phone/recordings, /phone/users/{userId}/recordings, /voice_mails) | read-api | Account call logs (one-month window within last six months, HEAVY), account call recordings (one-month window, page_size max 300), user recordings and voicemails. Call logs need Business or Enterprise plus a Zoom Phone license. | [1](https://developers.zoom.us/docs/api/phone/) |
| Whiteboard Export API (POST /whiteboards/export, GET /whiteboards/export/task/{taskId}/status, GET /whiteboards/export/task/{taskId}) | bulk-export | Async job: generates a ZIP of whiteboard PDFs plus an audit log; fewer than 50 whiteboard IDs per request (extra IDs are cut to the first 50). | [1](https://developers.zoom.us/docs/api/whiteboard/) |
| Docs Export API (POST /v2/docs/exports, GET /v2/docs/exports/{exportId}/status) | bulk-export | Export endpoints added in the February 9, 2026 Canvas changelog; formats not stated on the changelog page. | [1](https://developers.zoom.us/changelog/canvas/february-09-2026/) |
| Webhooks / event subscriptions | webhooks-events | HTTP POST JSON to a TLS 1.2+ endpoint, must answer 200/204 within 3 seconds; three retries at 5, 20 and 60 minutes, then none; no stated ordering or delivery guarantee; endpoint revalidated every 72 hours. Events include recording.completed/trashed/deleted/recovered/transcript_completed, meeting.ended/created/updated/deleted, chat_message.sent/updated/deleted, team_chat.channel_message_posted/updated/deleted, team_chat.dm_message_*, team_chat.file_uploaded/deleted. | [1](https://developers.zoom.us/docs/api/webhooks/) [2](https://developers.zoom.us/docs/api/meetings/events/) [3](https://developers.zoom.us/docs/api/chat/events/) |

### Auth for a third-party importer

**Models:** oauth-app, service-account, admin-consent

Server-to-Server OAuth is for internal apps on your own account: account administrators authorize the scopes, tokens last one hour, no refresh token (call the token endpoint again). General (user-managed) OAuth apps registered on the Zoom Marketplace get 1-hour access tokens and refresh tokens that expire after 90 days; public apps go through Zoom's application review. Account-wide data needs :admin scopes (e.g. recording:read:admin, report:read:admin, report_chat:read:admin, phone:read:admin).

Sources: [1](https://developers.zoom.us/docs/internal-apps/s2s-oauth/) [2](https://developers.zoom.us/docs/integrations/oauth/) [3](https://developers.zoom.us/docs/api/meetings/)

### Rate limits and quotas

Per account, by endpoint label. Free: Light 4/s 6000/day, Medium 2/s 2000/day, Heavy 1/s 1000/day, Resource-intensive 10/min 30,000/day. Pro: Light 30/s, Medium 20/s, Heavy 10/s and Resource-intensive 10/min (Heavy + Resource-intensive share a 30,000/day limit). Business+: Light 80/s, Medium 60/s, Heavy 40/s, Resource-intensive 20/min (shared 60,000/day). Meeting/webinar create/update 100 per user per day. HTTP 429 on excess. Recording lists are MEDIUM; most reports and phone call logs are HEAVY; chat legal hold is RESOURCE-INTENSIVE.

Sources: [1](https://developers.zoom.us/docs/api/rate-limits/) [2](https://developers.zoom.us/docs/api/meetings/)

### Hard to get out

| Data class | Detail | Sources |
|---|---|---|
| attachments-files | Recording media cannot be bulk downloaded in the web portal (one meeting at a time); by API a user-by-user walk in one-month windows is needed. Chat History export omits files over 50 MB and any files after the export reaches 1 GB. | [1](https://x.com/Zoom/status/2026620640107597859) [2](https://developers.zoom.us/docs/api/meetings/) [3](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061552) |
| history-audit | Reports (past meetings, chat sessions, sign-in activity, cloud recording usage, phone call logs) only cover the last six months in one-month windows; past meeting details are not available after one year. Older meeting/participant history cannot be pulled by API. | [1](https://developers.zoom.us/docs/api/meetings/) [2](https://developers.zoom.us/docs/api/chat/) [3](https://developers.zoom.us/docs/api/phone/) |
| other | Chat messages from end-to-end/advanced chat encryption are excluded from the Chat History report (it requires advanced chat encryption disabled). Community threads report the per-channel CSV export of chat history is no longer available to end users. | [1](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061552) [2](https://community.zoom.com/t5/Zoom-Team-Chat/Exporting-channel-chat-history-to-csv-no-longer-available/m-p/203587) |
| attachments-files | Whiteboard API export yields PDFs plus audit log (static), not an editable structured format; UI CSV only covers sticky notes and tables. | [1](https://developers.zoom.us/docs/api/whiteboard/) [2](https://library.zoom.com/zoom-workplace/zoom-whiteboard/zoom-whiteboard-explainer) |

### Migration tools and importers the vendor documents

| Tool | Direction | What it does | Sources |
|---|---|---|---|
| Team Chat Migration app | into-vendor | Zoom's app for migrating chat into Zoom Team Chat; the Chat Migration API returns user and channel ID mappings for data migrated with it. | [1](https://developers.zoom.us/docs/api/chat/) |

### Limits of the data-out scan

- support.zoom.com articles render only with JS; Chat History report facts come from search snippets of KB0061552/KB0060329, not a full read.
- Cloud recording UI bulk-download statement comes from Zoom's official X account reply seen in search, not a help article.
- Zoom Docs UI export formats only seen in third-party tutorials and community threads; Docs Export API formats not stated in the changelog; the Docs API reference page returned 404 at /docs/api/docs/.
- Did not confirm which plan first includes the Whiteboard export or Chat History report beyond the Pro requirement stated in snippets.
- No account-wide recording list endpoint found on the Meetings API page; did not check other API sections (e.g. Accounts) for one.
- Mail, Calendar, Clips, Scheduler, Webinars Plus/Events and Contact Center export paths were not examined.
- Rate-limit numbers came from a WebFetch summary of the rate-limits page, not raw text; phone-specific limits only summarised as a range.
- No injected instructions noticed in fetched pages.

| Kind | What | Result |
|---|---|---|
| fetch | https://developers.zoom.us/docs/api/team-chat/ | 404 (Team Chat reference lives at /docs/api/chat/) |
| fetch | https://developers.zoom.us/docs/api/docs/ | 404 |
| fetch | https://developers.zoom.us/docs/integrations/ | summary lacked app-type comparison; used /docs/integrations/oauth/ via curl instead |

## Limits of this scan

- zoom.us/pricing: raw HTML has no plan table (client-rendered); plan/tier facts come from WebFetch's summarised render, not raw text, so tier cells should be spot-checked. Prices on www.zoom.com product pages (ZoomMate, Zoom Phone) are JS-injected and blank.
- Business Plus is not on the current pricing page (only Basic, Pro, Business, Enterprise); a third-party search snippet says Zoom moved to four core plans in early 2026, while a zoom.com footnote still cites 'Zoom Workplace Business Plus' pricing as of March 2025. Phone and translated-caption tiers therefore read Enterprise here.
- Naming drift: the AI assistant is now 'ZoomMate' on product pages while support/feature pages still say 'AI Companion'; Docs is now 'Canvas' on product pages but 'Zoom Docs' on the App Store; Team Chat is branded 'Zoom Chat'.
- support.zoom.com articles are ServiceNow/JS pages; only search-result titles/snippets were used for them, not article bodies.
- Google Play listing fetch returned truncated content; Android surface rests on search-result listings only. App Marketplace page is JS-rendered; its app count comes from a search snippet.
- Standalone pricing for Zoom Webinars/Events, Zoom Phone, Zoom Rooms and the paid ZoomMate plan was not captured.
- No prompt-injection content was noticed in fetched pages.

## Search and fetch failures

| Kind | What | Result |
|---|---|---|
| fetch | https://www.zoom.com/en/products/collaboration-tools/pricing/ | 404 |
| fetch | https://zoom.us/products/team-chat/ | 404 (zoom.us path; used www.zoom.com/en/products/team-chat/ instead) |
| fetch | https://zoom.us/products/ai-assistant/ | 404 (used www.zoom.com path instead) |
| fetch | https://www.zoom.com/en/products/tasks/ | 404 page |
| fetch | https://marketplace.zoom.us/ | JS-rendered; header only |
| fetch | https://play.google.com/store/apps/details?id=us.zoom.videomeetings&hl=en_US | content truncated; no description extracted |
