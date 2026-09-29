/**
 * The Sniper List: the ten initial targets, in order.
 *
 * This is the ONLY source of target data for the site. It is shaped so it can
 * later be swapped for the control-plane API without touching any page.
 *
 * Nothing has started. Every number is 0 and every roadmap is unopened.
 * Do not put invented progress, contributors or dates in here.
 */

export type Target = {
  /** Product name, text only. Never render a company's logo. */
  name: string;
  slug: string;
  /** What the product is, in one line. */
  whatItIs: string;
  /** What the replacement will cover, in broad strokes. The roadmap decides the detail. */
  replacementCovers: string[];
  /** Percent of the product that is on the roadmap. */
  mapped: number;
  /** Percent of the product that has consensus Feature Contracts. */
  specified: number;
  /** Percent of the product that is merged. */
  built: number;
  /** URL of the canonical roadmap pull request, or null if it has not been opened. */
  roadmapPr: string | null;
  /** Whether a hosted instance of the replacement is running. */
  hosted: boolean;
  /** Whether the replacement can be self-hosted yet. */
  selfHosted: boolean;
};

export const targets: Target[] = [
  {
    name: "Salesforce",
    slug: "salesforce",
    whatItIs: "Customer relationship management (CRM) for sales teams.",
    replacementCovers: [
      "Contacts, companies and leads",
      "Deals and sales pipelines",
      "Activity history: calls, emails, meetings and tasks",
      "Reports and dashboards",
      "Workflow automation and approvals",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "HubSpot",
    slug: "hubspot",
    whatItIs: "Marketing, sales and customer service software built around one contact database.",
    replacementCovers: [
      "A shared contact database",
      "Email marketing and newsletters",
      "Landing pages and forms",
      "Marketing automation and lead scoring",
      "Campaign analytics",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "Slack",
    slug: "slack",
    whatItIs: "Team chat for work.",
    replacementCovers: [
      "Channels and direct messages",
      "Threads and reactions",
      "File sharing",
      "Search across conversations",
      "Integrations and bots",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "Zoom",
    slug: "zoom",
    whatItIs: "Video meetings and webinars.",
    replacementCovers: [
      "Video and audio calls",
      "Screen sharing",
      "Meeting scheduling and invites",
      "Recording",
      "Webinars and large meetings",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "Shopify",
    slug: "shopify",
    whatItIs: "Software for running an online store.",
    replacementCovers: [
      "Storefront and product catalogue",
      "Cart and checkout",
      "Orders and fulfilment",
      "Inventory",
      "Payment provider connections",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "QuickBooks",
    slug: "quickbooks",
    whatItIs: "Accounting software for small businesses.",
    replacementCovers: [
      "Invoices and payments",
      "Expenses and bills",
      "Bank reconciliation",
      "Chart of accounts and bookkeeping",
      "Financial reports",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "Jira",
    slug: "jira",
    whatItIs: "Issue and project tracking for software teams.",
    replacementCovers: [
      "Issues and backlogs",
      "Boards and sprints",
      "Custom workflows",
      "Search and filters",
      "Progress reports",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "Zendesk",
    slug: "zendesk",
    whatItIs: "Customer support and help desk software.",
    replacementCovers: [
      "Support tickets and a shared inbox",
      "Help centre and knowledge base",
      "Live chat",
      "Service-level targets",
      "Support reporting",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "DocuSign",
    slug: "docusign",
    whatItIs: "Electronic signatures for documents and agreements.",
    replacementCovers: [
      "Upload a document and place signature fields",
      "Send for signing to one or many people",
      "Signing order and reminders",
      "A tamper-evident audit trail",
      "Reusable templates",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
  {
    name: "NetSuite",
    slug: "netsuite",
    whatItIs: "Business management (ERP) software for finance and operations.",
    replacementCovers: [
      "Financials and general ledger",
      "Inventory and warehouses",
      "Order management",
      "Purchasing",
      "Reporting across companies and subsidiaries",
    ],
    mapped: 0,
    specified: 0,
    built: 0,
    roadmapPr: null,
    hosted: false,
    selfHosted: false,
  },
];

export function getTarget(slug: string): Target | undefined {
  return targets.find((t) => t.slug === slug);
}

/** Name of the canonical roadmap pull request for a target. */
export function roadmapTitle(t: Target): string {
  return `${t.name} Replacement Roadmap`;
}

export function roadmapStatus(t: Target): string {
  return t.roadmapPr ? "Roadmap PR open" : "Roadmap PR not opened yet";
}
