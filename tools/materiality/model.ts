/**
 * warOnSaaS materiality model. Deterministic: no randomness, no network, no clock.
 *
 *   node tools/materiality/model.ts > tools/materiality/OUTPUT.md
 *
 * Every input is either a SOURCED figure (id S*, cited in docs/whitepaper/MATERIALITY.md) or a named
 * ASSUMPTION (id A*) with low / central / high values and a rationale. Every output is an estimate and is
 * printed as a range:
 *   - "central" evaluates every assumption at its central value;
 *   - "low" and "high" are the minimum and maximum over every combination of low, central and high values of
 *     the assumptions the output depends on (a full grid, so they are true corner bounds, not percentiles).
 * A tornado table shows which assumptions move each headline output most.
 * The test tests/materiality.test.ts fails if OUTPUT.md is not exactly what this script prints.
 */

type Assumption = { id: string; name: string; low: number; central: number; high: number; unit: string; basis: string };
type Values = Record<string, number>;

// ---------------------------------------------------------------------------------------------------------
// Sourced figures. Ids M* match the source list in docs/whitepaper/MATERIALITY.md, section 2.
// ---------------------------------------------------------------------------------------------------------
type Sourced = { value: number; unit: string; what: string; src: string };

/** Sniper List vendors: most recent full fiscal year, US$ billions (M8a to M8i). */
export const SNIPER: { vendor: string; whole: number; relevant: number; note: string; src: string }[] = [
  {
    vendor: "Salesforce (FY ended Jan 2026)",
    whole: 41.525,
    relevant: 18.846,
    note: "relevant = Sales 9.028 + Service 9.818; Slack not disclosed, excluded",
    src: "M8a",
  },
  { vendor: "HubSpot (FY2025)", whole: 3.131, relevant: 3.131, note: "whole company", src: "M8b" },
  { vendor: "Zoom (FY ended Jan 2026)", whole: 4.869, relevant: 4.869, note: "whole company", src: "M8c" },
  { vendor: "Shopify (FY2025)", whole: 11.556, relevant: 2.752, note: "relevant = subscription solutions only", src: "M8d" },
  {
    vendor: "Intuit (FY ended Jul 2026)",
    whole: 21.448,
    relevant: 9.9,
    note: "relevant = Online Ecosystem (QuickBooks Online-centred, includes Mailchimp)",
    src: "M8e",
  },
  { vendor: "Atlassian (FY ended Jun 2026)", whole: 6.572, relevant: 6.572, note: "whole company; Jira not disclosed", src: "M8f" },
  { vendor: "Zendesk (private, ESTIMATE)", whole: 2.0, relevant: 2.0, note: "estimate from secondary sources", src: "M8g" },
  { vendor: "DocuSign (FY ended Jan 2026)", whole: 3.22, relevant: 3.22, note: "whole company", src: "M8h" },
  {
    vendor: "Oracle NetSuite (ESTIMATE)",
    whole: 4.2,
    relevant: 4.2,
    note: "estimate from Oracle's quarterly NetSuite statements",
    src: "M8i",
  },
];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const SNIPER_WHOLE = sum(SNIPER.map((x) => x.whole));
export const SNIPER_RELEVANT = sum(SNIPER.map((x) => x.relevant));

export const SOURCED: Record<string, Sourced> = {
  SAAS_2025: { value: 299.1, unit: "US$ bn", what: "Worldwide SaaS end-user spending, 2025 forecast (Gartner, Nov 2024)", src: "M2" },
  SOFTWARE_2026: { value: 1470, unit: "US$ bn", what: "Worldwide software spending, 2026 forecast (Gartner, Jul 2026)", src: "M1" },
  SNIPER_WHOLE: {
    value: SNIPER_WHOLE,
    unit: "US$ bn",
    what: "Sniper List vendors, whole-company revenue, latest fiscal years (sum)",
    src: "M8",
  },
  SNIPER_RELEVANT: { value: SNIPER_RELEVANT, unit: "US$ bn", what: "Sniper List vendors, product-relevant revenue (sum)", src: "M8" },
  DC_TWH_2025: { value: 485, unit: "TWh", what: "Global data-centre electricity, 2025 (IEA, Apr 2026)", src: "M13" },
  DC_TWH_2030: { value: 950, unit: "TWh", what: "Global data-centre electricity, 2030 projection (IEA, Apr 2026)", src: "M13" },
  AI_DC_TWH_2030: { value: 465, unit: "TWh", what: "AI-focused data centres, 2030 projection (IEA, Apr 2026)", src: "M13" },
};

// ---------------------------------------------------------------------------------------------------------
// Assumptions. Low / central / high, with the basis for each. None is a measurement.
// ---------------------------------------------------------------------------------------------------------
export const ASSUMPTIONS: Assumption[] = [
  {
    id: "A1",
    name: "Share of SaaS spend in Sniper List categories",
    low: 0.19,
    central: 0.3,
    high: 0.4,
    unit: "fraction",
    basis:
      "Floor: the nine vendors' product-relevant revenue alone is 0.186 of 2025 SaaS spend (M2, M8); categories include many other vendors, hence higher central and high. Not sourced as a category share.",
  },
  {
    id: "A2",
    name: "Unused share of licences",
    low: 0.25,
    central: 0.36,
    high: 0.46,
    unit: "fraction",
    basis:
      "Zylo 2026 index: 36% unused (M4); Zylo's 2025 utilisation of 54% implies 46% (M4). Low allows for the selection bias of a SaaS-management vendor's customers.",
  },
  {
    id: "A3",
    name: "Professional developers worldwide",
    low: 30,
    central: 36.5,
    high: 47.2,
    unit: "million",
    basis: "SlashData, early 2025: 36.5M professional, 47.2M all developers (M20, via secondary). Low allows for a narrower definition.",
  },
  {
    id: "A4",
    name: "Share of developers using coding agents regularly (2026)",
    low: 0.2,
    central: 0.35,
    high: 0.5,
    unit: "fraction",
    basis:
      "Stack Overflow 2025: 51% of professionals use AI tools daily (M19), not all agentic; Menlo: 50% daily (M18). Agentic share assumed lower.",
  },
  {
    id: "A5",
    name: "Agent compute per agent-using developer",
    low: 600,
    central: 2400,
    high: 7000,
    unit: "ACU per year",
    basis:
      "Anthropic's Claude Code cost guide: about $13 per developer per active day, $150-250 per month, under $30 per active day for 90% of users, at list price (M22). High is about $30 x 230 days; low covers light use and cheaper models.",
  },
  {
    id: "A6",
    name: "Share of agent coding on business-application features",
    low: 0.15,
    central: 0.3,
    high: 0.45,
    unit: "fraction",
    basis:
      "Assumption, no direct source: CRM, collaboration, commerce, finance, support, project and document workflows, internal tools and their integrations, as against infrastructure, games, research, embedded and so on.",
  },
  {
    id: "A7",
    name: "Duplicated share of that work",
    low: 0.2,
    central: 0.4,
    high: 0.6,
    unit: "fraction",
    basis:
      "Assumption anchored on: 70% of GitHub files are clones (M11); 70-77% of scanned commercial code is of open-source origin (M9), i.e. reuse already works at the component layer; copy-paste rising with AI assistants (M12). No credible direct estimate exists for the application layer.",
  },
  {
    id: "A8",
    name: "Facility energy per ACU of agent inference",
    low: 0.03,
    central: 0.13,
    high: 0.4,
    unit: "kWh per ACU",
    basis:
      "Central: Couch's per-token energy assumptions (390 / 1,950 / 39 Wh per million input / output / cache-read tokens, M16) divided by Sonnet-class list prices ($3 / $15 / $0.30) give 0.13 kWh per dollar for all three. Low: Google's reported efficiency (M15) and falling energy per task (M13). High: reasoning-heavy agentic work (M13, M15). Order-of-magnitude uncertainty.",
  },
  {
    id: "A9",
    name: "Growth of agent coding compute to 2030",
    low: 1.5,
    central: 4,
    high: 10,
    unit: "multiple of 2026, in ACU",
    basis:
      "Scenario. Tokens processed grew about 7x a year at Google (M24) while price per capability fell 9-900x a year (M23); ACU is list-price dollars, so it grows far more slowly than tokens.",
  },
  {
    id: "A10",
    name: "Energy per ACU in 2030 relative to 2026",
    low: 0.1,
    central: 0.3,
    high: 1,
    unit: "multiple",
    basis:
      "Scenario. The IEA reports energy per AI task falling by at least an order of magnitude a year (M13); list prices fall too, so energy per dollar falls more slowly. High assumes no improvement.",
  },
  {
    id: "C1",
    name: "Capture: share of duplicated work built once in a shared catalog",
    low: 0.01,
    central: 0.05,
    high: 0.2,
    unit: "fraction",
    basis: "Scenario, not a forecast: what share of the duplicated work any shared-catalog network (not only warOnSaaS) might capture.",
  },
  {
    id: "C2",
    name: "Reuse: would-be builders per shared capability",
    low: 3,
    central: 20,
    high: 100,
    unit: "count",
    basis: "Scenario. Open-source components are reused by far more (M9, M10); application features are more specific, so fewer.",
  },
  {
    id: "C3",
    name: "Adoption cost per reuser, as a share of building it",
    low: 0.1,
    central: 0.2,
    high: 0.4,
    unit: "fraction",
    basis: "Assumption: configuring, integrating and testing a shared capability still costs each adopter something.",
  },
  {
    id: "C4",
    name: "Coordination and review overhead of a shared build",
    low: 0.5,
    central: 1,
    high: 2,
    unit: "multiple of build cost",
    basis:
      "Assumption: two agent reviews at maximum reasoning, human review, audits and consensus rounds per unit (Part II). Multi-agent systems carry large token overhead [R2].",
  },
  {
    id: "C5",
    name: "Rebound: share of saved compute respent on more software",
    low: 0,
    central: 0.5,
    high: 1,
    unit: "fraction",
    basis: "Jevons scenario. At 1 the whole saving is respent: more software per unit of compute, no reduction in compute.",
  },
  {
    id: "C6",
    name: "Adoption: share of in-scope SaaS rent moved to shared open software",
    low: 0.005,
    central: 0.02,
    high: 0.1,
    unit: "fraction",
    basis: "Scenario, not a forecast.",
  },
  {
    id: "E1",
    name: "SaaS spend per employee",
    low: 3000,
    central: 6500,
    high: 9500,
    unit: "US$ per year",
    basis:
      "Zylo 2025 average $4,830 (M5); Zylo 2026 median $9,455 (M4); Vertice Q2 2026 $9,324 (M6). No sourced breakdown by company size; low allows for lighter stacks in small firms.",
  },
  {
    id: "E2",
    name: "Hosting, support and vendor margin for the open replacement",
    low: 0.15,
    central: 0.3,
    high: 0.5,
    unit: "share of replaced spend",
    basis: "Assumption: hosted open software still costs money to run and support; a hosted provider charges above cost.",
  },
  {
    id: "E3",
    name: "Migration, one-off",
    low: 0.3,
    central: 0.75,
    high: 1.5,
    unit: "multiple of one year's replaced spend",
    basis: "Assumption: data migration, retraining and parallel running. Amortised over three years in the model.",
  },
  {
    id: "E4",
    name: "Extra internal labour",
    low: 0.05,
    central: 0.1,
    high: 0.2,
    unit: "share of replaced spend",
    basis: "Assumption: administration and ownership that a SaaS vendor previously carried.",
  },
  {
    id: "E5",
    name: "AI spend per employee (context only, unchanged by replacement)",
    low: 300,
    central: 1000,
    high: 3000,
    unit: "US$ per year",
    basis:
      "Assumption: chat seats for most staff (roughly $240-360 a year at list prices) and coding agents for developers ($1,800-3,000 a year, M22).",
  },
];

// ---------------------------------------------------------------------------------------------------------
// Model. Formulas are written out so they can be read without running anything.
// ---------------------------------------------------------------------------------------------------------
const MIGRATION_YEARS = 3;
const S = (k: string) => SOURCED[k].value;

/** Agent coding compute, billions of ACU per year: developers (M) x share using agents x ACU per developer / 1000. */
const agentAcuBn = (v: Values) => (v.A3 * v.A4 * v.A5) / 1000;
const bizAcuBn = (v: Values) => agentAcuBn(v) * v.A6;
const dupAcuBn = (v: Values) => bizAcuBn(v) * v.A7;
/** Net saving per unit of captured duplicated work: (1 - adoption cost) - (1 + overhead) / reuse. Negative means a loss. */
const netShare = (v: Values) => 1 - v.C3 - (1 + v.C4) / v.C2;
const netAcuBn = (v: Values) => dupAcuBn(v) * v.C1 * netShare(v);
/** Billions of ACU x kWh per ACU = billions of kWh = TWh. */
const twh = (acuBn: number, kwhPerAcu: number) => acuBn * kwhPerAcu;
/** Net saving ratio on replaced SaaS spend, per year, over the migration period. */
const netRatio = (v: Values) => 1 - v.E2 - v.E3 / MIGRATION_YEARS - v.E4;
/** The same ratio once migration is paid off. */
const netRatioAfter = (v: Values) => 1 - v.E2 - v.E4;
const rentInScope = (v: Values) => S("SAAS_2025") * v.A1;

const COMPANY_SIZES = [50, 500, 5000];

type Output = { id: string; name: string; unit: string; deps: string[]; f: (v: Values) => number; digits?: number; group: string };
export const OUTPUTS: Output[] = [
  {
    group: "Money",
    id: "P1",
    name: "SaaS rent in Sniper List categories, worldwide",
    unit: "US$ bn per year",
    deps: ["A1"],
    f: rentInScope,
  },
  {
    group: "Money",
    id: "P2",
    name: "of which on unused licences",
    unit: "US$ bn per year",
    deps: ["A1", "A2"],
    f: (v) => rentInScope(v) * v.A2,
  },
  {
    group: "Compute and power",
    id: "P3",
    name: "Agent coding compute, all software",
    unit: "bn ACU per year",
    deps: ["A3", "A4", "A5"],
    f: agentAcuBn,
  },
  {
    group: "Compute and power",
    id: "P4",
    name: "Agent coding compute on business-application features",
    unit: "bn ACU per year",
    deps: ["A3", "A4", "A5", "A6"],
    f: bizAcuBn,
  },
  {
    group: "Compute and power",
    id: "P5",
    name: "of which duplicated",
    unit: "bn ACU per year",
    deps: ["A3", "A4", "A5", "A6", "A7"],
    f: dupAcuBn,
  },
  {
    group: "Compute and power",
    id: "P6",
    name: "Electricity, agent coding, all software",
    unit: "TWh per year",
    deps: ["A3", "A4", "A5", "A8"],
    f: (v) => twh(agentAcuBn(v), v.A8),
  },
  {
    group: "Compute and power",
    id: "P7",
    name: "Electricity, duplicated business-application work",
    unit: "TWh per year",
    deps: ["A3", "A4", "A5", "A6", "A7", "A8"],
    f: (v) => twh(dupAcuBn(v), v.A8),
  },
  {
    group: "Compute and power",
    id: "P8",
    name: "P6 as a share of global data-centre electricity (2025)",
    unit: "percent",
    deps: ["A3", "A4", "A5", "A8"],
    f: (v) => (100 * twh(agentAcuBn(v), v.A8)) / S("DC_TWH_2025"),
  },
  {
    group: "Compute and power",
    id: "P9",
    name: "Electricity, agent coding, all software, 2030 scenario",
    unit: "TWh per year",
    deps: ["A3", "A4", "A5", "A8", "A9", "A10"],
    f: (v) => twh(agentAcuBn(v) * v.A9, v.A8 * v.A10),
  },
  {
    group: "Network-scale savings",
    id: "N1",
    name: "Net saving per unit of captured duplicated work",
    unit: "fraction (negative = loss)",
    deps: ["C2", "C3", "C4"],
    f: netShare,
  },
  {
    group: "Network-scale savings",
    id: "N2",
    name: "Compute saved, net of overhead",
    unit: "bn ACU per year",
    deps: ["A3", "A4", "A5", "A6", "A7", "C1", "C2", "C3", "C4"],
    f: netAcuBn,
  },
  {
    group: "Network-scale savings",
    id: "N3",
    name: "Compute saved, net of overhead and rebound",
    unit: "bn ACU per year",
    deps: ["A3", "A4", "A5", "A6", "A7", "C1", "C2", "C3", "C4", "C5"],
    f: (v) => netAcuBn(v) * (1 - v.C5),
  },
  {
    group: "Network-scale savings",
    id: "N4",
    name: "Electricity saved, net of overhead",
    unit: "TWh per year",
    deps: ["A3", "A4", "A5", "A6", "A7", "C1", "C2", "C3", "C4", "A8"],
    f: (v) => twh(netAcuBn(v), v.A8),
  },
  {
    group: "Network-scale savings",
    id: "N5",
    name: "SaaS rent saved, net of hosting, migration and labour",
    unit: "US$ bn per year",
    deps: ["A1", "C6", "E2", "E3", "E4"],
    f: (v) => rentInScope(v) * v.C6 * netRatio(v),
  },
  {
    group: "Network-scale savings",
    id: "N6",
    name: "SaaS rent saved if all in-scope rent moved (theoretical ceiling)",
    unit: "US$ bn per year",
    deps: ["A1", "E2", "E3", "E4"],
    f: (v) => rentInScope(v) * netRatio(v),
  },
  {
    group: "Network-scale savings",
    id: "N7",
    name: "SaaS rent saved if all in-scope rent moved, after migration is paid off",
    unit: "US$ bn per year",
    deps: ["A1", "E2", "E4"],
    f: (v) => rentInScope(v) * netRatioAfter(v),
  },
  {
    group: "Enterprise",
    id: "E0",
    name: "Net saving ratio on replaced spend (first three years)",
    unit: "fraction (negative = loss)",
    deps: ["E2", "E3", "E4"],
    f: netRatio,
  },
  {
    group: "Enterprise",
    id: "E0a",
    name: "Net saving ratio on replaced spend, after migration is paid off",
    unit: "fraction",
    deps: ["E2", "E4"],
    f: netRatioAfter,
  },
  ...COMPANY_SIZES.flatMap((n): Output[] => [
    {
      group: "Enterprise",
      id: `E${n}-saas`,
      name: `${n} staff: SaaS spend today`,
      unit: "US$ k per year",
      deps: ["E1"],
      f: (v) => (n * v.E1) / 1000,
    },
    {
      group: "Enterprise",
      id: `E${n}-ai`,
      name: `${n} staff: AI spend today (unchanged)`,
      unit: "US$ k per year",
      deps: ["E5"],
      f: (v) => (n * v.E5) / 1000,
    },
    {
      group: "Enterprise",
      id: `E${n}-rep`,
      name: `${n} staff: spend a shared open suite could replace`,
      unit: "US$ k per year",
      deps: ["E1", "A1"],
      f: (v) => (n * v.E1 * v.A1) / 1000,
    },
    {
      group: "Enterprise",
      id: `E${n}-cost`,
      name: `${n} staff: remaining costs (hosting, migration over 3 years, labour)`,
      unit: "US$ k per year",
      deps: ["E1", "A1", "E2", "E3", "E4"],
      f: (v) => ((n * v.E1 * v.A1) / 1000) * (v.E2 + v.E3 / MIGRATION_YEARS + v.E4),
    },
    {
      group: "Enterprise",
      id: `E${n}-net`,
      name: `${n} staff: net saving, first three years`,
      unit: "US$ k per year",
      deps: ["E1", "A1", "E2", "E3", "E4"],
      f: (v) => ((n * v.E1 * v.A1) / 1000) * netRatio(v),
    },
    {
      group: "Enterprise",
      id: `E${n}-after`,
      name: `${n} staff: net saving after migration is paid off`,
      unit: "US$ k per year",
      deps: ["E1", "A1", "E2", "E4"],
      f: (v) => ((n * v.E1 * v.A1) / 1000) * netRatioAfter(v),
    },
  ]),
];

export const CAPTURE_LEVELS = [0.05, 0.25, 0.5, 1];

export const HEADLINE = ["P1", "P5", "P7", "N2", "N4", "N5", "E500-net"];

// ---------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------
function byId(id: string): Assumption {
  const a = ASSUMPTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown assumption ${id}`);
  return a;
}
function centralValues(): Values {
  return Object.fromEntries(ASSUMPTIONS.map((a) => [a.id, a.central]));
}
export function evaluate(o: Output): { low: number; central: number; high: number } {
  const base = centralValues();
  const central = o.f(base);
  let low = central;
  let high = central;
  const deps = o.deps;
  const n = deps.length;
  const total = 3 ** n;
  for (let k = 0; k < total; k++) {
    const v = { ...base };
    let r = k;
    for (let i = 0; i < n; i++) {
      const a = byId(deps[i]);
      const pick = r % 3;
      r = Math.floor(r / 3);
      v[a.id] = pick === 0 ? a.low : pick === 1 ? a.central : a.high;
    }
    const y = o.f(v);
    if (y < low) low = y;
    if (y > high) high = y;
  }
  return { low, central, high };
}
export function tornado(o: Output): { id: string; atLow: number; atHigh: number; swing: number }[] {
  const base = centralValues();
  return o.deps
    .map((id) => {
      const a = byId(id);
      const atLow = o.f({ ...base, [id]: a.low });
      const atHigh = o.f({ ...base, [id]: a.high });
      return { id, atLow, atHigh, swing: Math.abs(atHigh - atLow) };
    })
    .sort((x, y) => y.swing - x.swing || x.id.localeCompare(y.id));
}

// ---------------------------------------------------------------------------------------------------------
// Printing. Locale-independent, so the output is byte-identical on every machine.
// ---------------------------------------------------------------------------------------------------------
function group3(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** Three significant figures, thousands separated; integers from 1,000 up. */
export function fmt(x: number): string {
  if (x === 0) return "0";
  const sign = x < 0 ? "-" : "";
  const a = Math.abs(x);
  if (a >= 1000) return sign + group3(String(Math.round(a)));
  const decimals = Math.max(0, 2 - Math.floor(Math.log10(a)));
  const fixed = a
    .toFixed(Math.min(decimals, 6))
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  const [i, d] = fixed.split(".");
  return sign + group3(i) + (d ? `.${d}` : "");
}

export function render(): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  p("# Materiality model output");
  p();
  p("Generated by `node tools/materiality/model.ts` (source: `tools/materiality/model.ts`). Do not edit by hand.");
  p("Every output is an ESTIMATE. Low and high are corner bounds over every combination of the low, central and high values of the");
  p("assumptions each output depends on; central uses central values throughout. Sources M1 onwards: docs/whitepaper/MATERIALITY.md.");
  p();
  p("## Sniper List vendors, latest fiscal year (US$ bn)");
  p();
  p("| Vendor | Whole company | Product-relevant | Note | Source |");
  p("|---|---|---|---|---|");
  for (const x of SNIPER) p(`| ${x.vendor} | ${fmt(x.whole)} | ${fmt(x.relevant)} | ${x.note} | ${x.src} |`);
  p(`| Total | ${fmt(SNIPER_WHOLE)} | ${fmt(SNIPER_RELEVANT)} | fiscal years differ (Dec 2025 to Jul 2026) | |`);
  p();
  p("## Sourced inputs");
  p();
  p("| Id | Value | Unit | What | Source |");
  p("|---|---|---|---|---|");
  for (const [id, x] of Object.entries(SOURCED)) p(`| ${id} | ${fmt(x.value)} | ${x.unit} | ${x.what} | ${x.src} |`);
  p();
  p("## Assumptions (named, with ranges)");
  p();
  p("| Id | Assumption | Low | Central | High | Unit | Basis |");
  p("|---|---|---|---|---|---|---|");
  for (const a of ASSUMPTIONS) p(`| ${a.id} | ${a.name} | ${fmt(a.low)} | ${fmt(a.central)} | ${fmt(a.high)} | ${a.unit} | ${a.basis} |`);
  p();
  p("## Formulas");
  p();
  p("- P1 = SaaS 2025 x A1. P2 = P1 x A2.");
  p("- P3 (bn ACU) = A3 (million) x A4 x A5 / 1,000. P4 = P3 x A6. P5 = P4 x A7.");
  p("- Electricity (TWh) = bn ACU x kWh per ACU (A8). P8 = P6 / global data-centre use in 2025. P9 = P3 x A9 x A8 x A10.");
  p("- N1, net saving per unit of captured duplicated work = (1 - C3) - (1 + C4) / C2. A shared build costs 1 + C4 builds once;");
  p("  each of C2 would-be builders avoids a build but pays C3 to adopt. Negative means sharing costs more than it saves.");
  p("- N2 = P5 x C1 x N1. N3 = N2 x (1 - C5). N4 = N2 x A8. ACU are list-price dollars, so N2 is also US$ bn at list price.");
  p(
    `- E0, net saving ratio on replaced SaaS spend = 1 - E2 - E3 / ${MIGRATION_YEARS} - E4 (migration amortised over ${MIGRATION_YEARS} years).`,
  );
  p("- E0a, the same ratio after migration is paid off = 1 - E2 - E4.");
  p("- N5 = P1 x C6 x E0. N6 = P1 x E0. N7 = P1 x E0a.");
  p(
    "- Company of n staff: SaaS = n x E1; replaceable = SaaS x A1; remaining costs = replaceable x (E2 + E3 / 3 + E4); net = replaceable x E0.",
  );
  p();
  p("## Outputs (estimates)");
  let group = "";
  for (const o of OUTPUTS) {
    if (o.group !== group) {
      group = o.group;
      p();
      p(`### ${group}`);
      p();
      p("| Id | Output | Low | Central | High | Unit |");
      p("|---|---|---|---|---|---|");
    }
    const r = evaluate(o);
    p(`| ${o.id} | ${o.name} | ${fmt(r.low)} | ${fmt(r.central)} | ${fmt(r.high)} | ${o.unit} |`);
  }
  p();
  p("## Capture scenarios: theoretical savings if a shared model captured X of the duplicated work and X of the in-scope rent");
  p();
  p("Scenarios, not forecasts. Each cell is low / central / high over the other assumptions, as above.");
  p();
  p(
    "| X | Compute saved, net of overhead (bn ACU per year) | Same, after 50% rebound (C5 central) | Electricity saved (TWh per year) | SaaS rent saved, first three years (US$ bn per year) | SaaS rent saved after migration (US$ bn per year) |",
  );
  p("|---|---|---|---|---|---|");
  const dupDeps = ["A3", "A4", "A5", "A6", "A7", "C2", "C3", "C4"];
  const cell = (deps: string[], f: (v: Values) => number) => {
    const r = evaluate({ group: "", id: "", name: "", unit: "", deps, f });
    return `${fmt(r.low)} / ${fmt(r.central)} / ${fmt(r.high)}`;
  };
  for (const x of CAPTURE_LEVELS) {
    const c = (v: Values) => ({ ...v, C1: x, C6: x });
    p(
      `| ${fmt(x * 100)}% | ${cell(dupDeps, (v) => netAcuBn(c(v)))} | ${cell(dupDeps, (v) => netAcuBn(c(v)) * 0.5)} | ${cell([...dupDeps, "A8"], (v) => twh(netAcuBn(c(v)), v.A8))} | ${cell(["A1", "E2", "E3", "E4"], (v) => rentInScope(v) * x * netRatio(v))} | ${cell(["A1", "E2", "E4"], (v) => rentInScope(v) * x * netRatioAfter(v))} |`,
    );
  }
  p();
  p("## Sensitivity: one assumption at a time from its low to its high, all others central");
  for (const id of HEADLINE) {
    const o = OUTPUTS.find((x) => x.id === id)!;
    p();
    p(`### ${o.id}: ${o.name} (${o.unit}); central ${fmt(o.f(centralValues()))}`);
    p();
    p("| Assumption | At its low | At its high | Swing |");
    p("|---|---|---|---|");
    for (const t of tornado(o)) p(`| ${t.id} ${byId(t.id).name} | ${fmt(t.atLow)} | ${fmt(t.atHigh)} | ${fmt(t.swing)} |`);
  }
  p();
  return out.join("\n");
}

if (process.argv[1]?.endsWith("model.ts")) process.stdout.write(render());
