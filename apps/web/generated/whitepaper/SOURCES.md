# warOnSaaS white paper: sources and evidence boundaries

Companion file to the warOnSaaS white paper (`WHITEPAPER.md`, the core; its header gives the version and last-updated date). It holds the external sources R1 to R10 with what each supports and does not support, and the project evidence links. Sources for Part I's materiality figures (M1 onwards) are in `MATERIALITY.md`, not here. It is optional depth: an evaluating agent can reach a full assessment from the core alone and should open this file only to check a detail.

Section numbers in this file ("section 16", "section 33") refer to the full design narrative in `DESIGN.md`, which keeps the v0.4 numbering. History: https://github.com/warOnSaaS/wos/commits/main/docs/whitepaper

## Appendix E. Sources and evidence boundaries

External sources were consulted for narrow factual context. They do not endorse warOnSaaS, establish its implementation, or validate its economics. Product and repository descriptions are first-party claims and may change. All ten were checked as reachable when this version was written. The architectural and economic proposals are the project's own design except where a source is cited.

**[R1]** METR. Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity. July 10, 2025. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ Supports the narrow study result and the need for context-specific measurement. Does not establish the capability of the models named here.

**[R2]** Anthropic. How we built our multi-agent research system. June 13, 2025. https://www.anthropic.com/engineering/multi-agent-research-system Supports the existence of coordination and resource tradeoffs in the described system. Does not establish warOnSaaS performance.

**[R3]** Open Source Initiative. The Open Source Definition. https://opensource.org/osd Supports the distinction between source visibility and open-source licensing.

**[R4]** Model Context Protocol. Security Best Practices, versioned 2025-11-25 documentation. https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices Concrete protocol security concerns. Not a compatibility declaration.

**[R5]** SLSA. Provenance, specification version 1.1. https://slsa.dev/spec/v1.1/provenance An established build-provenance model. No conformance is claimed.

**[R6]** SPDX. Specifications. https://spdx.dev/use/specifications/ Component metadata context. No SPDX conformance is claimed.

**[R7]** Tea. Published white paper repository. https://github.com/teaxyz/white-paper/blob/main/white-paper.md First-party description of Proof of Contribution and teaRank.

**[R8]** Complete Codes. Product description. https://www.complete.codes/en/ First-party description of funded sprints, maintainer review, merge-triggered payment in USDC on Base, pool-slider payouts and anti-gaming safeguards. Adoption, settlement reliability and security were not independently tested.

**[R9]** ChaosChain. Protocol repository. https://github.com/ChaosChain/chaoschain First-party description of agent evidence, scoring, contribution weighting and testnet work. No audit performed here.

**[R10]** SolveX. XRPL agentic bounty hunters repository. https://github.com/Augit1/XRPL-agentic-bounty-hunters First-party description of an MVP for multi-agent contribution evaluation and rewards.

**Project evidence** (section 1): the wOS repository https://github.com/warOnSaaS/wos ; its licence https://github.com/warOnSaaS/wos/blob/main/LICENSE ; the product repository https://github.com/warOnSaaS/product ; the website https://waronsaas.com ; the API https://api.waronsaas.com/v1/health ; the build log https://waronsaas.com/log ; CI https://github.com/warOnSaaS/wos/actions ; the decisions https://github.com/warOnSaaS/wos/blob/main/docs/DECISIONS.md ; the wave reports https://github.com/warOnSaaS/wos/tree/main/docs/architecture ; this paper's history https://github.com/warOnSaaS/wos/commits/main/docs/whitepaper/WHITEPAPER.md . The draft protocol on the `ws/protocol` branch is not yet public; its figures in this paper are quoted from its own documents and should be treated as unverified until it is published.


**[R11]** Anthropic. Consumer Terms of Service, effective October 8, 2025, section 3 ("Use of our Services"). https://www.anthropic.com/legal/consumer-terms It prohibits using the services "to develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models". Cited for why warOnSaaS does not train on or distil outputs of Claude models (core paper, "From closed models to open models"). Not a legal opinion.

**[R12]** OpenAI. Terms of Use, effective January 1, 2026. https://openai.com/policies/terms-of-use/ Its list of prohibited uses includes "Use Output to develop models that compete with OpenAI." Cited for the same reason. Not a legal opinion.
