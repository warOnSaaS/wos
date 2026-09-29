/**
 * Public-route fixtures for the FAKE control plane (development and tests only; never shipped). Shaped
 * exactly like the contract responses and parsed with the route schemas by public-api.ts. Numbers are
 * the fake world's: the Sniper List is at 0% except Salesforce, which in this fake world has one mapped
 * capability with one specified feature (the one the orchestrator's fake control plane can build).
 */
import type { AbuSummary, AppFeatureDetail, AppFeatureSummary, TargetDetail, TargetSummary } from "@waronsaas/contracts";
import { ZERO_PROGRESS } from "@waronsaas/contracts";

const AT = "2026-09-29T12:00:00Z";

const SNIPER: Array<[string, string, string]> = [
  ["salesforce", "Salesforce", "Customer relationship management (CRM) for sales teams."],
  ["hubspot", "HubSpot", "Marketing, sales and customer service software built around one contact database."],
  ["slack", "Slack", "Team chat for work."],
  ["zoom", "Zoom", "Video meetings and webinars."],
  ["shopify", "Shopify", "Software for running an online store."],
  ["quickbooks", "QuickBooks", "Accounting software for small businesses."],
  ["jira", "Jira", "Issue and project tracking for software teams."],
  ["zendesk", "Zendesk", "Customer support and help desk software."],
  ["docusign", "DocuSign", "Electronic signatures for documents and agreements."],
  ["netsuite", "NetSuite", "Business management (ERP) software for finance and operations."],
];

const ROADMAP = {
  id: "0192ab3c-0000-7000-8000-00000000f001",
  kind: "roadmap" as const,
  version: 1,
  state: "merged" as const,
  roundNumber: 2,
  prUrl: "https://github.com/waronsaas/product/pull/3",
  headSha: "a".repeat(40),
  updatedAt: AT,
};

export function targets(): TargetSummary[] {
  const self: TargetSummary = {
    slug: "waronsaas",
    name: "warOnSaaS",
    rank: 0,
    whatItIs: "wOS itself: the platform that builds the replacements (dogfood).",
    productName: "wOS",
    repo: "waronsaas/wos",
    progress: { ...ZERO_PROGRESS },
    roadmap: null,
    hosted: { available: false, url: null },
    selfHostable: false,
  };
  return [
    self,
    ...SNIPER.map(
      ([slug, name, whatItIs], i): TargetSummary => ({
        slug,
        name,
        rank: i + 1,
        whatItIs,
        productName: null,
        repo: "waronsaas/product",
        progress:
          slug === "salesforce"
            ? {
                mappedBp: 1250,
                specifiedBp: 310,
                builtBp: 0,
                roadmapVersion: 1,
                inventoryVersion: 1,
                inventoryItems: 96,
                excludedItems: 4,
                computedAt: AT,
              }
            : { ...ZERO_PROGRESS },
        roadmap: slug === "salesforce" ? ROADMAP : null,
        hosted: { available: false, url: null },
        selfHostable: false,
      }),
    ),
  ];
}

const surfaces = (built = 0) =>
  (["web", "ios", "android"] as const).map((surface, i) => ({
    surface,
    weightBp: [5000, 2500, 2500][i]!,
    weightRationale: surface === "web" ? "Most daily CRM work happens in the browser." : "Field sales use the phone app.",
    specifiedBp: 10_000,
    builtBp: built,
    relevantPoints: 3,
    mergedPoints: 0,
    acceptancePassed: false,
  }));

function contactsSummary(): AppFeatureSummary {
  return {
    key: "contacts",
    capability: "crm",
    title: "Contacts",
    summary: "People and companies, with owners, fields and a paginated list.",
    state: "specified",
    weightBp: 2500,
    weightRationale: "Every other CRM feature hangs off the contact record.",
    effectiveAppWeightBp: 1250,
    specifiedBp: 10_000,
    builtBp: 0,
    relevantPoints: 3,
    mergedPoints: 0,
    surfaces: surfaces(),
    journeys: [
      {
        key: "J-001",
        surface: "web",
        title: "Find a contact and open their record",
        steps: ["Open Contacts from the navigation", "Type part of a name", "Open the matching contact"],
        entryPoints: ["navigation: Contacts"],
        platformBehaviour: "none",
        nativeCapabilities: [],
      },
    ],
    sharedWith: ["hubspot"],
    contract: { ...ROADMAP, id: "0192ab3c-0000-7000-8000-00000000f002", kind: "feature_contract", version: 1, state: "merged" },
  };
}

export function targetDetail(slug: string): TargetDetail | null {
  const t = targets().find((x) => x.slug === slug);
  if (!t) return null;
  const isSf = slug === "salesforce";
  return {
    ...t,
    surfaces: isSf
      ? [
          { surface: "web", status: "in_scope", reason: null, repo: "waronsaas/product", specifiedBp: 310, builtBp: 0 },
          { surface: "ios", status: "in_scope", reason: null, repo: "waronsaas/product", specifiedBp: 310, builtBp: 0 },
          { surface: "android", status: "in_scope", reason: null, repo: "waronsaas/product", specifiedBp: 310, builtBp: 0 },
          {
            surface: "desktop",
            status: "excluded",
            reason: "The vendor ships no desktop CRM client.",
            repo: null,
            specifiedBp: 0,
            builtBp: 0,
          },
        ]
      : [],
    capabilities: isSf
      ? [
          {
            key: "crm",
            title: "CRM",
            summary: "Contacts, companies, leads and the records sales teams work from.",
            weightBp: 5000,
            weightRationale: "The core of the product: what customers buy it for.",
            mapped: true,
            specifiedBp: 2500,
            builtBp: 0,
            features: [
              contactsSummary(),
              {
                ...contactsSummary(),
                key: "companies",
                title: "Companies",
                summary: "Accounts that group contacts, with hierarchy and ownership.",
                state: "mapped",
                weightBp: 2000,
                effectiveAppWeightBp: 1000,
                specifiedBp: 0,
                relevantPoints: 0,
                surfaces: surfaces().map((s) => ({ ...s, specifiedBp: 0, relevantPoints: 0 })),
                journeys: [],
                sharedWith: [],
                contract: null,
              },
            ],
          },
          {
            key: "pipeline",
            title: "Deals and pipelines",
            summary: "Opportunities, stages and forecasts.",
            weightBp: 3000,
            weightRationale: "Second reason customers buy it.",
            mapped: false,
            specifiedBp: 0,
            builtBp: 0,
            features: [],
          },
          {
            key: "reports",
            title: "Reports and dashboards",
            summary: "Saved reports and dashboards over CRM data.",
            weightBp: 2000,
            weightRationale: "Managers depend on it; less daily use.",
            mapped: false,
            specifiedBp: 0,
            builtBp: 0,
            features: [],
          },
        ]
      : [],
    excluded: isSf
      ? [{ item: "INV-0091", title: "AppExchange marketplace", reason: "A third-party marketplace is not a product feature." }]
      : [],
  };
}

export function featureDetail(slug: string, feature: string, abu: AbuSummary): AppFeatureDetail | null {
  if (slug !== "salesforce" || feature !== "contacts") return null;
  return {
    ...contactsSummary(),
    target: "salesforce",
    requirements: [
      {
        key: "R-001",
        kind: "api",
        statement: "The contact list returns the signed-in tenant's contacts, 50 per page, newest first.",
        abus: [abu.key],
        built: false,
        profiles: ["salesforce", "hubspot"],
        surfaces: ["web", "ios", "android"],
      },
    ],
    abus: [{ ...abu, claimable: null }],
  };
}
