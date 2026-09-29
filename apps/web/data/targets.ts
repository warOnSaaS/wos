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
  /** Stable target ID, e.g. TGT-01. Order on the Sniper List. */
  id: string;
  slug: string;
  /** Short category label, e.g. CRM. */
  category: string;
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
    id: "TGT-01",
    slug: "salesforce",
    category: "CRM",
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
    id: "TGT-02",
    slug: "hubspot",
    category: "Marketing",
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
    id: "TGT-03",
    slug: "slack",
    category: "Team chat",
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
    id: "TGT-04",
    slug: "zoom",
    category: "Video meetings",
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
    id: "TGT-05",
    slug: "shopify",
    category: "E-commerce",
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
    id: "TGT-06",
    slug: "quickbooks",
    category: "Accounting",
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
    id: "TGT-07",
    slug: "jira",
    category: "Issue tracking",
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
    id: "TGT-08",
    slug: "zendesk",
    category: "Customer support",
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
    id: "TGT-09",
    slug: "docusign",
    category: "E-signature",
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
    id: "TGT-10",
    slug: "netsuite",
    category: "ERP",
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

/** Short roadmap state for tables: OPEN or NOT OPENED. */
export function roadmapState(t: Target): string {
  return t.roadmapPr ? "OPEN" : "NOT OPENED";
}

/**
 * Operational status, derived only from the data above.
 * STANDBY: no roadmap opened. MAPPING: roadmap open, nothing specified.
 * SPECIFYING: contracts in progress, nothing built. BUILDING: some merged. COMPLETE: 100% built.
 */
export function targetStatus(t: Target): string {
  if (t.built >= 100) return "COMPLETE";
  if (t.built > 0) return "BUILDING";
  if (t.specified > 0) return "SPECIFYING";
  if (t.roadmapPr || t.mapped > 0) return "MAPPING";
  return "STANDBY";
}

/**
 * Programme-wide counters. Real values only; swap for the control-plane API later.
 * Nothing has started, so every counter is zero.
 */
export const programme = {
  contributors: 0,
  acceptedContributions: 0,
  tokensIssued: 0,
};

/** Programme-wide percentages: the mean across all targets. */
export function overall(key: "mapped" | "specified" | "built"): number {
  return Math.round(targets.reduce((n, t) => n + t[key], 0) / targets.length);
}

export function roadmapsOpen(): number {
  return targets.filter((t) => t.roadmapPr).length;
}
