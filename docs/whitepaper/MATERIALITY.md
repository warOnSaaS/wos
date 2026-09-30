# warOnSaaS white paper: materiality

Companion file to the warOnSaaS white paper (`WHITEPAPER.md`, the core; its header gives the version and last-updated date). It holds the sources and the full estimation model behind Part I, section 3 of the core: how big the problem is in money, compute and power, what share of it is duplicated, what sharing could theoretically save at network scale and for one company. It is optional depth: an evaluating agent can reach a full assessment from the core alone and should open this file to check a figure or change an assumption.

Part I does not depend on warOnSaaS existing. Nothing in this file estimates what warOnSaaS will achieve; section 14 of the core does that, separately.

History: https://github.com/warOnSaaS/wos/commits/main/docs/whitepaper . Figures researched on 2026-09-30.

## 1. How to read this file

- **Sourced figure (M1 onwards).** A number as its publisher stated it, with the year it refers to, the publisher, the publication date, the URL, and whether we read it at the primary source (**primary**) or only through another publication (**secondary**, named). Secondary figures should be confirmed at the primary source before anyone relies on them.
- **Assumption (A, C and E ids).** A number we chose, with low, central and high values and the reason for each. None is a measurement. The C ids are scenarios, not forecasts.
- **Estimate (P, N and E outputs).** Every output is computed from sourced figures and assumptions by the model in the repository, `tools/materiality/model.ts`, which is deterministic (no randomness, no network, no clock). Run it with `node tools/materiality/model.ts` (Node 22). Section 9 below is a verbatim copy of its output; a test in the repository (`tests/materiality.test.ts`) fails if the committed output or this copy drifts from what the model prints.
- **Ranges.** Every output is given as low / central / high. Central uses every assumption's central value. Low and high are corner bounds: the minimum and maximum over every combination of the low, central and high values of the assumptions the output depends on. Corner bounds multiply extremes together, so they are wide on purpose; they are not confidence intervals.
- **ACU.** One ACU is agent model usage that would cost one US dollar at the providers' published API list prices. So a figure in billions of ACU is also a figure in billions of list-price dollars; what people actually pay is often lower, because subscriptions and contracts discount it.

## 2. Sources

### Software and SaaS spending

- **[M1]** Gartner, worldwide IT spending forecast, press release 27 July 2026: IT spending $6.37 trillion in 2026 (+14.2%); **software $1.47 trillion in 2026 (+15.5%)**. https://www.gartner.com/en/newsroom/press-releases/2026-07-27-gartner-forecasts-worldwide-it-spending-to-grow-14-point-2-percent-in-2026-totaling-6-point-37-trillion . **Secondary**: Gartner's page refused automated access; read via Dataconomy (28 July 2026, https://dataconomy.com/2026/07/28/it-spending-forecast-2026-6-37t/) and TechTarget (12 August 2026). An April 2026 Gartner forecast of $1.44 trillion (+15.1%) is superseded.
- **[M2]** Gartner, public cloud end-user spending forecast, press release 19 November 2024: **SaaS $299.1 billion in 2025** (+19.2% from $250.8 billion in 2024); all public cloud $723.4 billion in 2025. https://www.gartner.com/en/newsroom/press-releases/2024-11-19-gartner-forecasts-worldwide-public-cloud-end-user-spending-to-total-723-billion-dollars-in-2025 . **Secondary** (CIO Dive, The Fast Mode). This is the latest worldwide public-cloud release from Gartner we could find; we found no Gartner SaaS dollar figure for 2026, and a widely repeated "$850 billion public cloud in 2026" could not be traced to Gartner, so it is not used.
- **[M3]** IDC, Worldwide Software and Public Cloud Services Spending Guide, March 2026: public cloud spending above $1 trillion in 2026 (+21%), SaaS "more than half" of it, no dollar figure for SaaS. **Secondary**: https://www.biztechreports.com/news-archive/2026/3/20/global-public-cloud-spending-to-surpass-1-trillion-in-2026-driven-by-paas-and-ai-platform-adoption-idc-march-23-2026 . Used as a cross-check only: if SaaS were half of $1 trillion, the model's SaaS base (M2) would be low, so the rent estimates below are conservative on this point.

### SaaS inside companies

- **[M4]** Zylo, 2026 SaaS Management Index, 29 January 2026 (sample: over 40 million licences and $75 billion of spend under management, plus a survey of 218 IT leaders). **Primary**: https://zylo.com/2026-saas-management-index . 305 applications per organization on average (median 240); annual SaaS spend per company $55.7 million on average (median $20.6 million); **median SaaS spend per employee $9,455**; "an average of 36% of their SaaS licenses unused"; business units control 81% of SaaS spend; large enterprises add 21 applications a month. Zylo's statistics page (https://zylo.com/blog/saas-statistics, updated 8 February 2026, primary) gives **licence utilization of 54% in 2025**, which implies 46% unused; the two Zylo figures conflict, so the model uses both as its range. Zylo's customers are companies that bought a SaaS-management product, which may bias these figures upward.
- **[M5]** Zylo, 2025 SaaS Management Index, 16 January 2025. **Primary**: https://zylo.com/news/2025-saas-management-index . **$4,830 average SaaS spend per employee** (+21.9%); 152 applications for companies of 1 to 500 employees, 660 for 10,000 or more.
- **[M6]** Vertice, SaaS spend per employee, page updated July 2026: **$9,324 per employee in Q2 2026** (basis: $5 billion of spend Vertice processes). **Primary**: https://www.vertice.one/insights/saas-spend-per-employee
- **[M7]** Redundancy and sprawl. Torii, SaaS Benchmark 2026 (2025 data): 831 applications per organization on average, 61.3% of them outside IT's control. **Primary**: https://www.toriihq.com/reports/saas-benchmark-annual-report-2026 . Zylo on redundancy: about 9.9 project-management and 9.5 team-collaboration applications per organization. **Secondary** (search excerpt of https://zylo.com/blog/software-redundancy; index edition unclear). The benchmark vendors count applications differently, which is why their counts differ by a factor of three.

### The Sniper List vendors (latest full fiscal year, US$)

- **[M8a]** Salesforce, fiscal year ended 31 January 2026: total **$41.525 billion**; Sales $9.028 billion; Service $9.818 billion; "Platform, Slack and Other" $8.882 billion; Marketing and Commerce $5.428 billion; Integration and Analytics $6.232 billion. **Slack revenue is not disclosed.** Primary: https://www.sec.gov/Archives/edgar/data/1108524/000110852426000056/crm-q4fy26xexhibit991.htm (25 February 2026).
- **[M8b]** HubSpot, 2025: **$3.13 billion**. Primary: https://www.sec.gov/Archives/edgar/data/1404655/000119312526046563/hubs-ex99_1.htm (11 February 2026).
- **[M8c]** Zoom, fiscal year ended 31 January 2026: **$4.869 billion**. Primary: https://www.sec.gov/Archives/edgar/data/1585521/000158552126000026/zm-20260225ex991.htm (25 February 2026).
- **[M8d]** Shopify, 2025: total **$11.556 billion**, of which subscription solutions **$2.752 billion** and merchant solutions (mostly payments) $8.804 billion. Primary: https://www.sec.gov/Archives/edgar/data/1594805/000159480526000007/shop-20251231.htm
- **[M8e]** Intuit, fiscal year ended 31 July 2026: total **$21.448 billion**; Global Business Solutions $12.9 billion; **Online Ecosystem (QuickBooks Online-centred, includes Mailchimp) $9.9 billion**; Consumer (TurboTax, Credit Karma) $8.6 billion. Primary: https://www.sec.gov/Archives/edgar/data/896878/000089687826000029/fy26q4earningspressrelease.htm (25 August 2026).
- **[M8f]** Atlassian, fiscal year ended 30 June 2026: **$6.572 billion**. **Jira revenue is not disclosed.** Primary: https://www.sec.gov/Archives/edgar/data/0001650372/000165037226000031/ex991q4fy26.htm (6 August 2026).
- **[M8g]** Zendesk, private since 2022: **about $2.0 billion (ESTIMATE)**. No company or wire-service figure found; Getlatka puts 2024 revenue at $1.93 billion. **Secondary**: https://getlatka.com/blog/zendesk-revenue
- **[M8h]** DocuSign, fiscal year ended 31 January 2026: **$3.2195 billion**. Primary: https://www.sec.gov/Archives/edgar/data/1261333/000126133326000017/q426ex-991er.htm (17 March 2026).
- **[M8i]** Oracle NetSuite: **about $4.2 billion for Oracle's fiscal year ended 31 May 2026 (ESTIMATE)**, from Oracle's own quarterly statements of NetSuite revenue: $1.0 billion in Q1 (primary, https://www.oracle.com/news/announcement/q1fy26-earnings-release-2025-09-09/), about $1.035 billion in Q2 (secondary), $1.1 billion in Q3 (primary, https://www.sec.gov/Archives/edgar/data/1341439/000119312526100148/orcl-ex99_1.htm); Q4 not broken out, so the annual figure is extrapolated.

**Sniper List totals** (sum computed by the model; fiscal years differ between December 2025 and July 2026): **whole-company revenue about $98.5 billion; product-relevant revenue about $55.5 billion** (Salesforce Sales and Service only, Shopify subscriptions only, Intuit Online Ecosystem only; the rest whole-company). Adding a Slack estimate of $1.5 to 2.5 billion (third-party trackers, not verifiable against a filing) would give about $57 to 58 billion. The product-relevant total is still generous in places (Atlassian is more than Jira; Intuit's Online Ecosystem includes Mailchimp and payments) and conservative in others (Slack excluded, Salesforce's platform line excluded).

### Open-source reuse and code duplication

- **[M9]** Synopsys (now Black Duck), Open Source Security and Risk Analysis. 2024 report (1,067 commercial codebases audited in 2023): open source in 96%; "Seventy-seven percent of all the source code and files scanned originated from open source code". **Primary**: https://static.carahsoft.com/concrete/files/1617/1597/8665/2024_Open_Source_Security_and_Risk_Analysis_Report_WRAPPED.pdf . 2025 report (965 codebases, 2024 audits): "97% of commercial codebases contain open source, and on average, 70% of scanned code has open source origins". **Primary** (vendor blog, 22 May 2025): https://www.blackduck.com/blog/qa-open-source-software-risk-2025.html . 2026 report (947 codebases): open source in 98%; no share-of-code figure found. https://news.blackduck.com/2026-02-25-Black-Duck-Research-Shows-Open-Source-Vulnerabilities-Have-Doubled-as-AI-Accelerates-Code-Creation
- **[M10]** Hoffmann, Nagle and Zhou, "The Value of Open Source Software", Harvard Business School Working Paper 24-038, 2024 (2020 data): the cost to recreate widely used open source once is about **$4.15 billion** (range $1.22 to 6.22 billion), while its value to the firms that use it is about **$8.8 trillion** (range $2.59 to 13.18 trillion); without it firms "would need to spend 3.5 times more on software". **Primary**: https://www.hbs.edu/ris/Publication%20Files/24-038_51f8444f-502c-4139-8bf2-56eb4b65c58a.pdf . This is the strongest published evidence that writing once and reusing everywhere creates value orders of magnitude larger than its cost; it concerns component libraries, not business applications.
- **[M11]** Lopes et al., "DéjàVu: a map of code duplicates on GitHub", Proceedings of the ACM on Programming Languages 1 (OOPSLA), October 2017: of 428 million files in 4.5 million non-fork projects, 85 million are unique; "70% of the code on GitHub consists of clones of previously created files". **Primary**: https://doi.org/10.1145/3133908 . Much of this is vendored libraries, so it measures copying, not independent re-implementation.
- **[M12]** GitClear. 2025 report (211 million changed lines, 2020 to 2024): copy-pasted lines rose from 8.3% to 12.3%, refactoring fell from 25% to under 10%. **Primary**: https://www.gitclear.com/ai_assistant_code_quality_2025_research . 2026 report (623 million changes, 2023 to first half of 2026): duplicated blocks per million changed lines 40.3 in 2023 to 73.0 in 2026 (+81%); copy-paste 15.7% in the first half of 2026. **Primary**: https://www.gitclear.com/the_ai_code_quality_maintainability_gap (page dated January 2026 but containing 2026 data; treat the date as uncertain).
- **Not found:** any credible estimate of the share of business-software features that are common across companies (records, permissions, approvals, notifications, standard integrations). The duplicated-share assumption A7 is therefore an assumption, anchored on M9 to M12 but not derived from them.

### Data-centre electricity and AI

- **[M13]** International Energy Agency. *Energy and AI*, April 2025 (**primary**, https://iea.blob.core.windows.net/assets/de9dea13-b07d-42c5-a398-d1b3ae17d866/EnergyandAI.pdf): data centres used about **415 TWh in 2024**, about 1.5% of global electricity; base case about **945 TWh in 2030** and about 1,200 TWh in 2035 (2035 range across scenarios 700 to 1,720 TWh); accelerated servers were 15% of data-centre demand in 2024, growing about 30% a year. *Key Questions on Energy and AI*, April 2026 (**primary**, https://iea.blob.core.windows.net/assets/3179f7f8-01f6-4dd6-bffa-c9f7b73f1dc9/KeyQuestionsonEnergyandAI.pdf): **about 485 TWh in 2025** (+17%), about **950 TWh in 2030**; AI-focused data centres grew 50% in 2025 and are projected to reach **about 465 TWh by 2030**; indicative GPU-only energy per task of 0.05 Wh (medium model), 1.14 Wh (agentic task), 50 Wh (agentic with reasoning), which the IEA calls "indicative of the order of magnitude"; energy per AI task falling "by at least an order of magnitude annually".
- **[M14]** Lawrence Berkeley National Laboratory for the US Department of Energy, December 2024: US data centres used 176 TWh in 2023, 4.4% of US electricity, projected at 6.7% to 12% by 2028. **Primary**: https://newscenter.lbl.gov/2025/01/15/berkeley-lab-report-evaluates-increase-in-electricity-demand-from-data-centers/ . A 2025 update (June 2026) projects 9.5% to 15.3% for 2030 (abstract only, https://www.osti.gov/biblio/3374245).
- **[M15]** Energy per prompt. Google, 21 August 2025: median Gemini Apps text prompt **0.24 Wh** (0.10 Wh counting active accelerators only), a 33-fold reduction in a year. **Primary**: https://cloud.google.com/blog/products/infrastructure/measuring-the-environmental-impact-of-ai-inference . Sam Altman, "The Gentle Singularity", June 2025: an average ChatGPT query uses "about 0.34 watt-hours" (**primary**, https://blog.samaltman.com/the-gentle-singularity). Epoch AI, 7 February 2025: about 0.3 Wh for a GPT-4o query with 500 output tokens, about 2.5 Wh with 10,000 input tokens and about 40 Wh with 100,000 (**primary**, https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use). Jegham et al., "How Hungry is AI?", preprint, November 2025: long prompts (10,000 in, 1,500 out) from about 0.8 Wh (small models) to above 29 Wh (the most energy-intensive reasoning models) (**primary preprint**, https://arxiv.org/html/2505.09598).
- **[M16]** Energy of coding-agent sessions (non-peer-reviewed estimates inferred from token counts, not measurements). Simon P. Couch, 20 January 2026: about 41 Wh for a median Claude Code session of 24 requests and 592,000 tokens, assuming 390 / 1,950 / 39 Wh per million input / output / cache-read tokens (**primary**, https://simonpcouch.com/blog/2026-01-20-cc-impact/). Zeke Hausfather, 2026: about 170 kWh (range 70 to 330) over eight weeks of heavy personal use, about 3 kWh a day, 3.2 billion tokens, 96% of them cache reads (**primary**, https://www.theclimatebrink.com/p/the-real-energy-use-of-agentic-ai).
- **[M25]** Inference versus training. Epoch AI, 10 October 2025: of OpenAI's about $7 billion of compute in 2024, about $3 billion was training and $1.8 billion inference (Epoch's inputs are press reports) (**primary**, https://epoch.ai/data-insights/openai-compute-spend). Patterson et al., 2022: machine learning was under 15% of Google's energy in 2019 to 2021, about three fifths of it inference (via summary of https://arxiv.org/abs/2204.05149). The IEA's April 2025 report estimates cumulative training energy of frontier models at about 0.1% of data-centre use over the period (M13). The model counts inference only: the agents building business software run inference, and training is shared by every use of a model.

### Coding agents and developers

- **[M17]** Anthropic: run-rate revenue $14 billion and **Claude Code run-rate "over $2.5 billion"** (12 February 2026, **primary**, https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation); run-rate "over $30 billion" (6 April 2026, **primary**, https://www.anthropic.com/news/google-broadcom-partnership-compute); "crossed $47 billion" (28 May 2026, **primary**, https://www.anthropic.com/news/series-h). Run-rates are annualised monthly figures, not audited revenue. A widely repeated "$8 billion Claude Code run-rate" could not be confirmed at a primary source and is not used.
- **[M18]** Menlo Ventures, "2025: The State of Generative AI in the Enterprise", 9 December 2025: enterprise generative-AI spend $37 billion in 2025; **coding $4.0 billion**; 50% of developers use AI coding tools daily. **Primary**: https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/
- **[M19]** Stack Overflow Developer Survey 2025 (July 2025): 84% of respondents use or plan to use AI tools; **51% of professional developers use them daily**. **Primary**: https://survey.stackoverflow.co/2025/ai
- **[M20]** SlashData, April 2025: **47.2 million developers worldwide, 36.5 million professional**. **Secondary** (search summary of https://www.slashdata.co/post/global-developer-population-trends-2025-how-many-developers-are-there).
- **[M21]** Other usage. Microsoft, fiscal 2026 fourth-quarter earnings, 29 July 2026: GitHub Copilot 50 million users; "one in three pull requests on GitHub now involves an agent" (**primary**, https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q4). Cursor (Anysphere): above $4 billion annualised revenue in June 2026 (**secondary**, no primary found). OpenAI Codex: above 5 million weekly active users around June 2026 (**secondary**: search excerpt of https://openai.com/index/codex-for-knowledge-work/, which refused automated access).
- **[M22]** Anthropic, Claude Code documentation, "Manage costs effectively", read 30 September 2026: "Across enterprise deployments, the average cost is around $13 per developer per active day and $150-250 per developer per month, with costs remaining below $30 per active day for 90% of users", computed at list price. **Primary**: https://code.claude.com/docs/en/costs
- **[M23]** Epoch AI (Cottier et al.), 12 March 2025: the price of reaching a fixed capability fell between 9-fold and 900-fold a year depending on the benchmark. **Primary**: https://epoch.ai/data-insights/llm-inference-price-trends
- **[M24]** Google: about 480 trillion tokens a month in May 2025, "over 1.3 quadrillion monthly tokens" in October 2025 (**primary**, https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q3-2025/), "over 3.2 quadrillion per month" in May 2026 (**primary**, https://blog.google/innovation-and-ai/sundar-pichai-io-2026/). OpenRouter and a16z, December 2025: programming rose from about 11% to over 50% of OpenRouter's tokens during 2025 (**primary**, https://arxiv.org/html/2601.10088v1).

## 3. The size of the problem: money

**Facts.** Worldwide software spending is forecast at **$1.47 trillion in 2026** [M1], and SaaS end-user spending at **$299.1 billion in 2025** [M2] (IDC's 2026 figures imply more [M3]). The nine vendors on the Sniper List took **about $98.5 billion** of whole-company revenue in their latest fiscal years, **about $55.5 billion** from the products the list targets [M8]. Inside companies, SaaS costs **$4,830 to $9,455 per employee a year** depending on the benchmark and statistic [M4, M5, M6]; an average organization runs **about 240 to 830 applications** depending on how they are counted [M4, M7]; and **36% to 46% of licences go unused** [M4].

**Estimates** (model section 9, outputs P1 and P2):

| Estimate | Low | Central | High |
|---|---|---|---|
| SaaS rent in Sniper List categories, worldwide (US$ bn a year) | 56.8 | 89.7 | 120 |
| of which on unused licences (US$ bn a year) | 14.2 | 32.3 | 55 |

One assumption decides P1: A1, the share of SaaS spend in the Sniper List's categories. Its floor is sourced (the nine vendors' product-relevant revenue alone is 18.6% of 2025 SaaS spend); its central and high values are not.

## 4. The size of the problem: compute and power

**Facts.** Data centres used **about 485 TWh in 2025**, heading for **about 950 TWh by 2030**, with AI-focused data centres at **about 465 TWh by 2030** [M13]. Agent coding is a fast-growing part of AI use: programming passed half of OpenRouter's tokens in 2025 [M24]; Claude Code alone had a run-rate above $2.5 billion in February 2026 [M17]; enterprise coding-AI spend was $4.0 billion in 2025 [M18]; GitHub Copilot has 50 million users [M21]. Anthropic's own guide puts enterprise Claude Code use at **$150 to 250 per developer per month at list price** [M22]. Energy per simple prompt is now a fraction of a watt-hour [M15], but agentic and reasoning work uses hundreds to thousands of times more [M13]: one careful estimate puts a median coding-agent session at about 41 Wh [M16].

**Estimates** (outputs P3 to P9):

| Estimate | Low | Central | High |
|---|---|---|---|
| Agent coding compute, all software (bn ACU a year) | 3.6 | 30.7 | 165 |
| on business-application features (bn ACU a year) | 0.54 | 9.2 | 74.3 |
| of which duplicated (bn ACU a year) | 0.108 | 3.68 | 44.6 |
| Electricity, agent coding, all software (TWh a year) | 0.108 | 3.99 | 66.1 |
| Electricity, duplicated business-application work (TWh a year) | 0.00324 | 0.478 | 17.8 |
| Agent coding electricity as a share of data-centre use in 2025 (%) | 0.0223 | 0.822 | 13.6 |
| Agent coding electricity, 2030 scenario (TWh a year) | 0.0162 | 4.78 | 661 |

**Cross-check.** The central 30.7 billion ACU a year is list-price usage. Reported coding revenue is lower but of the same order once subscriptions are allowed for: Claude Code above $2.5 billion run-rate in February 2026 [M17], Cursor above $4 billion in June 2026 [M21, secondary], Menlo's $4.0 billion of enterprise coding spend in 2025 [M18], plus Copilot, Codex and others; subscription users consume more list-price usage than they pay for. We did not find a figure that would let us reconcile the two precisely; the reconciliation is open.

**What this says, plainly.** The compute is material in money (billions of list-price dollars a year on duplicated business-application work in the central case) and growing fast. **The electricity is not large on a world scale today**: agent coding of all software is under 1% of data-centre electricity in the central case, and its duplicated business-application part is about half a terawatt-hour. The power argument is about growth and efficiency per unit, not about today's grid. The high corners (66 TWh now, 661 TWh in 2030) multiply every high assumption together and should not be read as forecasts.

## 5. The duplicated share

The model's A7 (central 40% of agent work on business-application features duplicates a capability that already exists elsewhere) is an assumption. What the evidence shows: reuse already works at the component layer, where 70% to 77% of the code in audited commercial codebases is of open-source origin [M9] and the value of that reuse to firms is estimated at about $8.8 trillion against a recreation cost of about $4.15 billion [M10]; 70% of files on GitHub are clones [M11]; duplicated code blocks rose 81% between 2023 and 2026 as AI assistants spread [M12]. What it does not show: how much of the application layer (records, approvals, pipelines, invoices, tickets, permissions) each company's agents rebuild. No credible measurement exists, so the range is wide (20% to 60%) and the sensitivity tables show what it moves.

## 6. Theoretical savings at network scale

This is about any shared-catalog model, not warOnSaaS. A shared build of one capability costs one build plus coordination and review overhead (C4); each of the would-be builders (C2) avoids its own build but pays something to adopt it (C3). The net saving per unit of captured duplicated work is (1 − C3) − (1 + C4) / C2: central 0.70, **low −0.40 (sharing costs more than it saves when few would reuse a capability and overhead is high)**, high 0.885. A rebound share (C5) of the saving is respent on more software.

| If a shared model captured X of the duplicated work and X of the in-scope rent | Compute saved, net of overhead (bn ACU a year) | Electricity saved (TWh a year) | SaaS rent saved in the first three years (US$ bn a year) | SaaS rent saved after migration (US$ bn a year) |
|---|---|---|---|---|
| 5% | −0.892 / 0.129 / 1.97 | −0.357 / 0.0167 / 0.789 | −1.2 / 1.57 / 4.19 | 0.852 / 2.69 / 4.79 |
| 25% | −4.46 / 0.644 / 9.87 | −1.78 / 0.0837 / 3.95 | −5.98 / 7.85 / 20.9 | 4.26 / 13.5 / 23.9 |
| 50% | −8.92 / 1.29 / 19.7 | −3.57 / 0.167 / 7.89 | −12 / 15.7 / 41.9 | 8.52 / 26.9 / 47.9 |
| 100% (theoretical ceiling) | −17.8 / 2.58 / 39.5 | −7.14 / 0.335 / 15.8 | −23.9 / 31.4 / 83.7 | 17 / 53.8 / 95.7 |

Each cell is low / central / high. **Rebound:** at the central rebound of 50%, the compute saved halves (for example 1.29 instead of 2.58 billion ACU at full capture); at 100% nothing is saved in compute, only more software per unit of it. Reading: the money case (tens of billions of dollars a year of rent, once migration is paid) is much larger than the compute case (a few billion list-price dollars) and far larger than the power case (a fraction of a terawatt-hour in the central case).

## 7. Enterprise-level examples

A company of n staff spends n × E1 on SaaS; a shared open suite could replace the Sniper List share (A1); it then pays hosting, support and a provider's margin (E2), migration (E3, amortised over three years) and extra internal labour (E4). AI spend (E5) is shown for context and assumed unchanged: replacing SaaS does not reduce it, and any contribution a company makes to a shared network costs extra and earns nothing of guaranteed value (the core's section 9). US$ thousands a year, low / central / high:

| Company | SaaS spend today | AI spend today | Could be replaced | Remaining costs | Net saving, first three years | Net saving after migration |
|---|---|---|---|---|---|---|
| 50 staff | 150 / 325 / 475 | 15 / 50 / 150 | 28.5 / 97.5 / 190 | 8.55 / 63.4 / 228 | −38 / 34.1 / 133 | 8.55 / 58.5 / 152 |
| 500 staff | 1,500 / 3,250 / 4,750 | 150 / 500 / 1,500 | 285 / 975 / 1,900 | 85.5 / 634 / 2,280 | −380 / 341 / 1,330 | 85.5 / 585 / 1,520 |
| 5,000 staff | 15,000 / 32,500 / 47,500 | 1,500 / 5,000 / 15,000 | 2,850 / 9,750 / 19,000 | 855 / 6,338 / 22,800 | −3,800 / 3,413 / 13,300 | 855 / 5,850 / 15,200 |

The model scales linearly with staff because we found no sourced breakdown of spend per employee by company size; real small companies may run lighter stacks and real large ones negotiate discounts. The first-three-years range includes a loss: with expensive migration (1.5 times a year's replaced spend) and costly hosting, switching does not pay back within three years. After migration, the saving is 30% to 80% of the replaced spend (central 60%).

## 8. Which assumptions dominate

From the sensitivity tables in section 9 (one assumption moved from its low to its high, others central):

- **Rent in scope (P1):** only A1, the category share.
- **Duplicated compute (P5):** A5, agent compute per developer, dominates (0.92 to 10.7 billion ACU); then A6 and A7 (business-application share and duplicated share); then adoption (A4).
- **Duplicated electricity (P7):** A8, energy per ACU, and A5 together; each moves the result more than tenfold.
- **Compute saved (N2):** capture (C1) first, then A5; reuse per capability (C2) matters more than overhead (C4) at central values, but at low reuse (C2 = 3) overhead decides whether sharing saves anything.
- **Enterprise net saving (E500):** migration cost (E3), hosting share (E2) and spend per employee (E1), in that order.

The assumptions that matter most and are least sourced are **A6 and A7** (how much agent work is business-application work, and how much of that is duplicated) and **A8** (energy per ACU). Measuring any of them would narrow the ranges more than any other research.

## 9. Model output (verbatim)

The following is an exact copy of `tools/materiality/OUTPUT.md` at this version, generated by `node tools/materiality/model.ts`.

### Sniper List vendors, latest fiscal year (US$ bn)

| Vendor | Whole company | Product-relevant | Note | Source |
|---|---|---|---|---|
| Salesforce (FY ended Jan 2026) | 41.5 | 18.8 | relevant = Sales 9.028 + Service 9.818; Slack not disclosed, excluded | M8a |
| HubSpot (FY2025) | 3.13 | 3.13 | whole company | M8b |
| Zoom (FY ended Jan 2026) | 4.87 | 4.87 | whole company | M8c |
| Shopify (FY2025) | 11.6 | 2.75 | relevant = subscription solutions only | M8d |
| Intuit (FY ended Jul 2026) | 21.4 | 9.9 | relevant = Online Ecosystem (QuickBooks Online-centred, includes Mailchimp) | M8e |
| Atlassian (FY ended Jun 2026) | 6.57 | 6.57 | whole company; Jira not disclosed | M8f |
| Zendesk (private, ESTIMATE) | 2 | 2 | estimate from secondary sources | M8g |
| DocuSign (FY ended Jan 2026) | 3.22 | 3.22 | whole company | M8h |
| Oracle NetSuite (ESTIMATE) | 4.2 | 4.2 | estimate from Oracle's quarterly NetSuite statements | M8i |
| Total | 98.5 | 55.5 | fiscal years differ (Dec 2025 to Jul 2026) | |

### Sourced inputs

| Id | Value | Unit | What | Source |
|---|---|---|---|---|
| SAAS_2025 | 299 | US$ bn | Worldwide SaaS end-user spending, 2025 forecast (Gartner, Nov 2024) | M2 |
| SOFTWARE_2026 | 1,470 | US$ bn | Worldwide software spending, 2026 forecast (Gartner, Jul 2026) | M1 |
| SNIPER_WHOLE | 98.5 | US$ bn | Sniper List vendors, whole-company revenue, latest fiscal years (sum) | M8 |
| SNIPER_RELEVANT | 55.5 | US$ bn | Sniper List vendors, product-relevant revenue (sum) | M8 |
| DC_TWH_2025 | 485 | TWh | Global data-centre electricity, 2025 (IEA, Apr 2026) | M13 |
| DC_TWH_2030 | 950 | TWh | Global data-centre electricity, 2030 projection (IEA, Apr 2026) | M13 |
| AI_DC_TWH_2030 | 465 | TWh | AI-focused data centres, 2030 projection (IEA, Apr 2026) | M13 |

### Assumptions (named, with ranges)

| Id | Assumption | Low | Central | High | Unit | Basis |
|---|---|---|---|---|---|---|
| A1 | Share of SaaS spend in Sniper List categories | 0.19 | 0.3 | 0.4 | fraction | Floor: the nine vendors' product-relevant revenue alone is 0.186 of 2025 SaaS spend (M2, M8); categories include many other vendors, hence higher central and high. Not sourced as a category share. |
| A2 | Unused share of licences | 0.25 | 0.36 | 0.46 | fraction | Zylo 2026 index: 36% unused (M4); Zylo's 2025 utilisation of 54% implies 46% (M4). Low allows for the selection bias of a SaaS-management vendor's customers. |
| A3 | Professional developers worldwide | 30 | 36.5 | 47.2 | million | SlashData, early 2025: 36.5M professional, 47.2M all developers (M20, via secondary). Low allows for a narrower definition. |
| A4 | Share of developers using coding agents regularly (2026) | 0.2 | 0.35 | 0.5 | fraction | Stack Overflow 2025: 51% of professionals use AI tools daily (M19), not all agentic; Menlo: 50% daily (M18). Agentic share assumed lower. |
| A5 | Agent compute per agent-using developer | 600 | 2,400 | 7,000 | ACU per year | Anthropic's Claude Code cost guide: about $13 per developer per active day, $150-250 per month, under $30 per active day for 90% of users, at list price (M22). High is about $30 x 230 days; low covers light use and cheaper models. |
| A6 | Share of agent coding on business-application features | 0.15 | 0.3 | 0.45 | fraction | Assumption, no direct source: CRM, collaboration, commerce, finance, support, project and document workflows, internal tools and their integrations, as against infrastructure, games, research, embedded and so on. |
| A7 | Duplicated share of that work | 0.2 | 0.4 | 0.6 | fraction | Assumption anchored on: 70% of GitHub files are clones (M11); 70-77% of scanned commercial code is of open-source origin (M9), i.e. reuse already works at the component layer; copy-paste rising with AI assistants (M12). No credible direct estimate exists for the application layer. |
| A8 | Facility energy per ACU of agent inference | 0.03 | 0.13 | 0.4 | kWh per ACU | Central: Couch's per-token energy assumptions (390 / 1,950 / 39 Wh per million input / output / cache-read tokens, M16) divided by Sonnet-class list prices ($3 / $15 / $0.30) give 0.13 kWh per dollar for all three. Low: Google's reported efficiency (M15) and falling energy per task (M13). High: reasoning-heavy agentic work (M13, M15). Order-of-magnitude uncertainty. |
| A9 | Growth of agent coding compute to 2030 | 1.5 | 4 | 10 | multiple of 2026, in ACU | Scenario. Tokens processed grew about 7x a year at Google (M24) while price per capability fell 9-900x a year (M23); ACU is list-price dollars, so it grows far more slowly than tokens. |
| A10 | Energy per ACU in 2030 relative to 2026 | 0.1 | 0.3 | 1 | multiple | Scenario. The IEA reports energy per AI task falling by at least an order of magnitude a year (M13); list prices fall too, so energy per dollar falls more slowly. High assumes no improvement. |
| C1 | Capture: share of duplicated work built once in a shared catalog | 0.01 | 0.05 | 0.2 | fraction | Scenario, not a forecast: what share of the duplicated work any shared-catalog network (not only warOnSaaS) might capture. |
| C2 | Reuse: would-be builders per shared capability | 3 | 20 | 100 | count | Scenario. Open-source components are reused by far more (M9, M10); application features are more specific, so fewer. |
| C3 | Adoption cost per reuser, as a share of building it | 0.1 | 0.2 | 0.4 | fraction | Assumption: configuring, integrating and testing a shared capability still costs each adopter something. |
| C4 | Coordination and review overhead of a shared build | 0.5 | 1 | 2 | multiple of build cost | Assumption: two agent reviews at maximum reasoning, human review, audits and consensus rounds per unit (Part II). Multi-agent systems carry large token overhead [R2]. |
| C5 | Rebound: share of saved compute respent on more software | 0 | 0.5 | 1 | fraction | Jevons scenario. At 1 the whole saving is respent: more software per unit of compute, no reduction in compute. |
| C6 | Adoption: share of in-scope SaaS rent moved to shared open software | 0.005 | 0.02 | 0.1 | fraction | Scenario, not a forecast. |
| E1 | SaaS spend per employee | 3,000 | 6,500 | 9,500 | US$ per year | Zylo 2025 average $4,830 (M5); Zylo 2026 median $9,455 (M4); Vertice Q2 2026 $9,324 (M6). No sourced breakdown by company size; low allows for lighter stacks in small firms. |
| E2 | Hosting, support and vendor margin for the open replacement | 0.15 | 0.3 | 0.5 | share of replaced spend | Assumption: hosted open software still costs money to run and support; a hosted provider charges above cost. |
| E3 | Migration, one-off | 0.3 | 0.75 | 1.5 | multiple of one year's replaced spend | Assumption: data migration, retraining and parallel running. Amortised over three years in the model. |
| E4 | Extra internal labour | 0.05 | 0.1 | 0.2 | share of replaced spend | Assumption: administration and ownership that a SaaS vendor previously carried. |
| E5 | AI spend per employee (context only, unchanged by replacement) | 300 | 1,000 | 3,000 | US$ per year | Assumption: chat seats for most staff (roughly $240-360 a year at list prices) and coding agents for developers ($1,800-3,000 a year, M22). |

### Formulas

- P1 = SaaS 2025 x A1. P2 = P1 x A2.
- P3 (bn ACU) = A3 (million) x A4 x A5 / 1,000. P4 = P3 x A6. P5 = P4 x A7.
- Electricity (TWh) = bn ACU x kWh per ACU (A8). P8 = P6 / global data-centre use in 2025. P9 = P3 x A9 x A8 x A10.
- N1, net saving per unit of captured duplicated work = (1 - C3) - (1 + C4) / C2. A shared build costs 1 + C4 builds once;
  each of C2 would-be builders avoids a build but pays C3 to adopt. Negative means sharing costs more than it saves.
- N2 = P5 x C1 x N1. N3 = N2 x (1 - C5). N4 = N2 x A8. ACU are list-price dollars, so N2 is also US$ bn at list price.
- E0, net saving ratio on replaced SaaS spend = 1 - E2 - E3 / 3 - E4 (migration amortised over 3 years).
- E0a, the same ratio after migration is paid off = 1 - E2 - E4.
- N5 = P1 x C6 x E0. N6 = P1 x E0. N7 = P1 x E0a.
- Company of n staff: SaaS = n x E1; replaceable = SaaS x A1; remaining costs = replaceable x (E2 + E3 / 3 + E4); net = replaceable x E0.

### Outputs (estimates)

#### Money

| Id | Output | Low | Central | High | Unit |
|---|---|---|---|---|---|
| P1 | SaaS rent in Sniper List categories, worldwide | 56.8 | 89.7 | 120 | US$ bn per year |
| P2 | of which on unused licences | 14.2 | 32.3 | 55 | US$ bn per year |

#### Compute and power

| Id | Output | Low | Central | High | Unit |
|---|---|---|---|---|---|
| P3 | Agent coding compute, all software | 3.6 | 30.7 | 165 | bn ACU per year |
| P4 | Agent coding compute on business-application features | 0.54 | 9.2 | 74.3 | bn ACU per year |
| P5 | of which duplicated | 0.108 | 3.68 | 44.6 | bn ACU per year |
| P6 | Electricity, agent coding, all software | 0.108 | 3.99 | 66.1 | TWh per year |
| P7 | Electricity, duplicated business-application work | 0.00324 | 0.478 | 17.8 | TWh per year |
| P8 | P6 as a share of global data-centre electricity (2025) | 0.0223 | 0.822 | 13.6 | percent |
| P9 | Electricity, agent coding, all software, 2030 scenario | 0.0162 | 4.78 | 661 | TWh per year |

#### Network-scale savings

| Id | Output | Low | Central | High | Unit |
|---|---|---|---|---|---|
| N1 | Net saving per unit of captured duplicated work | -0.4 | 0.7 | 0.885 | fraction (negative = loss) |
| N2 | Compute saved, net of overhead | -3.57 | 0.129 | 7.89 | bn ACU per year |
| N3 | Compute saved, net of overhead and rebound | -3.57 | 0.0644 | 7.89 | bn ACU per year |
| N4 | Electricity saved, net of overhead | -1.43 | 0.0167 | 3.16 | TWh per year |
| N5 | SaaS rent saved, net of hosting, migration and labour | -2.39 | 0.628 | 8.37 | US$ bn per year |
| N6 | SaaS rent saved if all in-scope rent moved (theoretical ceiling) | -23.9 | 31.4 | 83.7 | US$ bn per year |
| N7 | SaaS rent saved if all in-scope rent moved, after migration is paid off | 17 | 53.8 | 95.7 | US$ bn per year |

#### Enterprise

| Id | Output | Low | Central | High | Unit |
|---|---|---|---|---|---|
| E0 | Net saving ratio on replaced spend (first three years) | -0.2 | 0.35 | 0.7 | fraction (negative = loss) |
| E0a | Net saving ratio on replaced spend, after migration is paid off | 0.3 | 0.6 | 0.8 | fraction |
| E50-saas | 50 staff: SaaS spend today | 150 | 325 | 475 | US$ k per year |
| E50-ai | 50 staff: AI spend today (unchanged) | 15 | 50 | 150 | US$ k per year |
| E50-rep | 50 staff: spend a shared open suite could replace | 28.5 | 97.5 | 190 | US$ k per year |
| E50-cost | 50 staff: remaining costs (hosting, migration over 3 years, labour) | 8.55 | 63.4 | 228 | US$ k per year |
| E50-net | 50 staff: net saving, first three years | -38 | 34.1 | 133 | US$ k per year |
| E50-after | 50 staff: net saving after migration is paid off | 8.55 | 58.5 | 152 | US$ k per year |
| E500-saas | 500 staff: SaaS spend today | 1,500 | 3,250 | 4,750 | US$ k per year |
| E500-ai | 500 staff: AI spend today (unchanged) | 150 | 500 | 1,500 | US$ k per year |
| E500-rep | 500 staff: spend a shared open suite could replace | 285 | 975 | 1,900 | US$ k per year |
| E500-cost | 500 staff: remaining costs (hosting, migration over 3 years, labour) | 85.5 | 634 | 2,280 | US$ k per year |
| E500-net | 500 staff: net saving, first three years | -380 | 341 | 1,330 | US$ k per year |
| E500-after | 500 staff: net saving after migration is paid off | 85.5 | 585 | 1,520 | US$ k per year |
| E5000-saas | 5000 staff: SaaS spend today | 15,000 | 32,500 | 47,500 | US$ k per year |
| E5000-ai | 5000 staff: AI spend today (unchanged) | 1,500 | 5,000 | 15,000 | US$ k per year |
| E5000-rep | 5000 staff: spend a shared open suite could replace | 2,850 | 9,750 | 19,000 | US$ k per year |
| E5000-cost | 5000 staff: remaining costs (hosting, migration over 3 years, labour) | 855 | 6,338 | 22,800 | US$ k per year |
| E5000-net | 5000 staff: net saving, first three years | -3,800 | 3,413 | 13,300 | US$ k per year |
| E5000-after | 5000 staff: net saving after migration is paid off | 855 | 5,850 | 15,200 | US$ k per year |

### Capture scenarios: theoretical savings if a shared model captured X of the duplicated work and X of the in-scope rent

Scenarios, not forecasts. Each cell is low / central / high over the other assumptions, as above.

| X | Compute saved, net of overhead (bn ACU per year) | Same, after 50% rebound (C5 central) | Electricity saved (TWh per year) | SaaS rent saved, first three years (US$ bn per year) | SaaS rent saved after migration (US$ bn per year) |
|---|---|---|---|---|---|
| 5% | -0.892 / 0.129 / 1.97 | -0.446 / 0.0644 / 0.987 | -0.357 / 0.0167 / 0.789 | -1.2 / 1.57 / 4.19 | 0.852 / 2.69 / 4.79 |
| 25% | -4.46 / 0.644 / 9.87 | -2.23 / 0.322 / 4.93 | -1.78 / 0.0837 / 3.95 | -5.98 / 7.85 / 20.9 | 4.26 / 13.5 / 23.9 |
| 50% | -8.92 / 1.29 / 19.7 | -4.46 / 0.644 / 9.87 | -3.57 / 0.167 / 7.89 | -12 / 15.7 / 41.9 | 8.52 / 26.9 / 47.9 |
| 100% | -17.8 / 2.58 / 39.5 | -8.92 / 1.29 / 19.7 | -7.14 / 0.335 / 15.8 | -23.9 / 31.4 / 83.7 | 17 / 53.8 / 95.7 |

### Sensitivity: one assumption at a time from its low to its high, all others central

#### P1: SaaS rent in Sniper List categories, worldwide (US$ bn per year); central 89.7

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| A1 Share of SaaS spend in Sniper List categories | 56.8 | 120 | 62.8 |

#### P5: of which duplicated (bn ACU per year); central 3.68

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| A5 Agent compute per agent-using developer | 0.92 | 10.7 | 9.81 |
| A6 Share of agent coding on business-application features | 1.84 | 5.52 | 3.68 |
| A7 Duplicated share of that work | 1.84 | 5.52 | 3.68 |
| A4 Share of developers using coding agents regularly (2026) | 2.1 | 5.26 | 3.15 |
| A3 Professional developers worldwide | 3.02 | 4.76 | 1.73 |

#### P7: Electricity, duplicated business-application work (TWh per year); central 0.478

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| A8 Facility energy per ACU of agent inference | 0.11 | 1.47 | 1.36 |
| A5 Agent compute per agent-using developer | 0.12 | 1.4 | 1.28 |
| A6 Share of agent coding on business-application features | 0.239 | 0.717 | 0.478 |
| A7 Duplicated share of that work | 0.239 | 0.717 | 0.478 |
| A4 Share of developers using coding agents regularly (2026) | 0.273 | 0.683 | 0.41 |
| A3 Professional developers worldwide | 0.393 | 0.619 | 0.225 |

#### N2: Compute saved, net of overhead (bn ACU per year); central 0.129

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| C1 Capture: share of duplicated work built once in a shared catalog | 0.0258 | 0.515 | 0.489 |
| A5 Agent compute per agent-using developer | 0.0322 | 0.376 | 0.343 |
| A6 Share of agent coding on business-application features | 0.0644 | 0.193 | 0.129 |
| A7 Duplicated share of that work | 0.0644 | 0.193 | 0.129 |
| C2 Reuse: would-be builders per shared capability | 0.0245 | 0.143 | 0.119 |
| A4 Share of developers using coding agents regularly (2026) | 0.0736 | 0.184 | 0.11 |
| A3 Professional developers worldwide | 0.106 | 0.167 | 0.0607 |
| C3 Adoption cost per reuser, as a share of building it | 0.147 | 0.092 | 0.0552 |
| C4 Coordination and review overhead of a shared build | 0.133 | 0.12 | 0.0138 |

#### N4: Electricity saved, net of overhead (TWh per year); central 0.0167

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| C1 Capture: share of duplicated work built once in a shared catalog | 0.00335 | 0.067 | 0.0636 |
| A8 Facility energy per ACU of agent inference | 0.00386 | 0.0515 | 0.0476 |
| A5 Agent compute per agent-using developer | 0.00419 | 0.0488 | 0.0446 |
| A6 Share of agent coding on business-application features | 0.00837 | 0.0251 | 0.0167 |
| A7 Duplicated share of that work | 0.00837 | 0.0251 | 0.0167 |
| C2 Reuse: would-be builders per shared capability | 0.00319 | 0.0187 | 0.0155 |
| A4 Share of developers using coding agents regularly (2026) | 0.00957 | 0.0239 | 0.0143 |
| A3 Professional developers worldwide | 0.0138 | 0.0216 | 0.00789 |
| C3 Adoption cost per reuser, as a share of building it | 0.0191 | 0.012 | 0.00717 |
| C4 Coordination and review overhead of a shared build | 0.0173 | 0.0155 | 0.00179 |

#### N5: SaaS rent saved, net of hosting, migration and labour (US$ bn per year); central 0.628

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| C6 Adoption: share of in-scope SaaS rent moved to shared open software | 0.157 | 3.14 | 2.98 |
| E3 Migration, one-off | 0.897 | 0.179 | 0.718 |
| E2 Hosting, support and vendor margin for the open replacement | 0.897 | 0.269 | 0.628 |
| A1 Share of SaaS spend in Sniper List categories | 0.398 | 0.837 | 0.44 |
| E4 Extra internal labour | 0.718 | 0.449 | 0.269 |

#### E500-net: 500 staff: net saving, first three years (US$ k per year); central 341

| Assumption | At its low | At its high | Swing |
|---|---|---|---|
| E3 Migration, one-off | 488 | 97.5 | 390 |
| E2 Hosting, support and vendor margin for the open replacement | 488 | 146 | 341 |
| E1 SaaS spend per employee | 158 | 499 | 341 |
| A1 Share of SaaS spend in Sniper List categories | 216 | 455 | 239 |
| E4 Extra internal labour | 390 | 244 | 146 |

## 10. Keeping this file current

Every sourced figure above carries the date it was published and the date it was read (2026-09-30 for this version). When a newer edition of a source appears (a new Gartner forecast, a new IEA report, a new SaaS index, new fiscal-year results), the figure is updated in `tools/materiality/model.ts` and here, with the model re-run, the output copied, and a changelog line in the core naming the old and new figure. A figure is never changed silently; a source that can no longer be reached, or is older than eighteen months with a newer edition available, is flagged as stale rather than replaced by a guess.
