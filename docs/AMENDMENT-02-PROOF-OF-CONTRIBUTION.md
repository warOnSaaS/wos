# Amendment 02: the contribution economy — Proof of Contribution (2026-09-29)

Part A is the founder's decisions from the discussion (authoritative). Part B is the proposal the founder brought (drafted with ChatGPT, verbatim in substance, lightly condensed where it repeats existing architecture). Where B conflicts with A, A wins. Where A or B conflicts with `docs/DECISIONS.md` D1–D17, A wins and the architect records the supersession.

## Part A — founder decisions

A1. **Proof of Contribution, not payment for work.** The protocol records verified contribution and allocates WOS by published rules. Language everywhere: "contribution", "receipt", "allocation" — never "payment", "earn money", "investment".

A2. **Execution work is rewarded by token usage.** Builders, agent reviewers and architecture resolvers — people running an agent on work wOS defined — are rewarded by their agent's token usage, normalised to a provider-independent unit (working name ACU, via a versioned ModelRateOracle), **only once the work is merged and accepted**, and **capped at the unit's authorised budget**. Failed, abandoned or rejected attempts receive nothing. Repair loops within the merged attempt count, inside the cap.

A3. **Planning and ideas have their own economics.** Roadmap and feature-contract authoring compute counts only if it lands in the accepted, merged version, plus a share of the pools of the features it defined. Feature requests / roadmap proposals / issues are never paid by tokens: they are rewarded by outcome (acceptance, and a finder's share when the feature is built; bugs by severity when confirmed and fixed; security by the severity ladder). The architect designs this model; the coordinator's draft is Part C.

A4. **Human review is required in V1** before any contribution becomes final: deterministic verification + Astra PASS + Fable PASS + 1 authorized human PASS, the human never the author. Flexible, versioned ReviewPolicy; admin-bootstrapped reviewers; human review is itself a contribution type; AI/human disagreements become permanent eval data.

A5. **WOS is a real Solana token; V1 runs on devnet.** It may become tradeable. **wOS (the company) never sells WOS**: no presale, ICO, investor allocation, treasury sales, liquidity provision or price promotion. The company is funded by wOS Cloud revenue (hosted entitlements, Amendment 01). Devnet WOS has no monetary value and the UI says so. Mainnet is a separate, deliberate milestone behind a readiness gate that includes one legal read.

A6. **Founder allocation: option 1 + 2.** (1) The founder earns WOS as contributor zero, under the same rules as everyone, from the first receipt. (2) A one-time, transparent, capped Genesis credit for the work done before the protocol existed (building V1 itself), computed from recorded evidence (git history, reports) by a published GenesisPolicy. **No premine / no discretionary founder allocation.**

A7. **Treasury only as a rules-bound protocol pool** (completion pools, security and bug bounties, proposal finder's shares, audit grants), controlled by multisig and, over time, contributor governance. Never a company treasury that sells.

A8. **Regulatory posture:** don't pre-optimise for regulators; keep a single legal checkpoint before a value-bearing mainnet token. Tax/contractor paperwork is deferred to that point.

A9. The founder will have the protocol reviewed by Astra (Codex) before implementation proceeds.

## Part B — the proposal (founder-supplied)

Objective: prove that **a person can contribute their own agentic compute to produce verified useful open-source software, and wOS can programmatically measure, attribute, review, and reward that contribution.** Prefer a simple, auditable protocol over clever tokenomics. Do not optimise for token price, speculation or artificial growth.

Flow: Contributor dedicates an approved agent → wOS controls the workload (context, instructions, boundaries, policy, token budget) → agent consumes model tokens → wOS measures usage → implementation → deterministic verification → Astra review → Fable review → required human review → qualified contribution → GitHub PR / merge → ContributionReceipt → reward accounting.

**Terminology.** Provider tokens (input, output, cached, reasoning, other) ≠ normalised agent compute (ACU; the architect may rename) ≠ WOS (the reward asset). Provider tokens are never permanently mapped to a fixed WOS amount.

**ModelRateOracle** (versioned): provider, model, effective_epoch, input/output/cached-input/reasoning reference rates, oracle_version, source. Historical runs permanently record the oracle version; changes never alter history. The architect must evaluate whether API pricing is the best normalisation.

**UsageProofProvider**: identify model/provider, verify the session where possible, collect authoritative telemetry where available, normalise, detect impossible/inconsistent claims, issue an immutable UsageReceipt. Verification levels VERIFIED / ATTESTED / ESTIMATED / UNVERIFIED — never pretend unverifiable usage is verified; RewardPolicy decides which levels qualify.

**AgentRun** (first-class, auditable): id, contributor, wallet, ABU, lease, provider, model, model version, context manifest id + hash, base commit, start/end, input/output/cached/other usage, verification level, token cap, normalised compute, verification / Astra / Fable / human review status, contribution status, PR, merge commit, reward policy version, oracle version.

**Compute caps**: every ABU defines a model requirement (capability class, e.g. WOS_BUILD_L4), a hard token cap and a repair policy (max loops) before execution. wOS controls context, instructions, tools, repair prompts, loops, termination; the contributor cannot tell the agent to "keep thinking". Usage beyond the cap is not reward-eligible. Units that consistently need excess compute go back for decomposition (DECOMPOSITION_REQUIRED).

**Exclusive leases** (non-negotiable): one active BuildLease per ABU, atomic, server-authoritative heartbeats, expiry recovery; the lease binds ABU, contributor, agent run, model policy, context manifest, base commit, token budget, write set, logical locks, issue/expiry, heartbeat. **Feature concurrency**: many contributors on one feature, never on one ABU, with write-set / schema / API / event / logical-resource compatibility checked (already built).

**Architecture conflicts**: builders emit structured blockers (e.g. CONTRACT_INSUFFICIENT) instead of expanding scope; accepted contracts and invariants are authoritative; implementation is disposable (already built).

**Human review**: HumanReviewContext (task contract, Feature Contract, architecture, invariants, diff, verification results, Astra findings, Fable findings, affected interfaces, risk classification). Versioned ReviewPolicy + ReviewerQualification; V1 = Astra PASS ∧ Fable PASS ∧ 1 authorized human PASS; the engine must be able to express future rules (e.g. low risk 0 humans; security 2 humans in the security domain; accounting 2 humans across domains; protocol 2 + admin quorum) without hard-coding them. Admin UI: authorize/revoke reviewers, domains, simple levels, which contribution classes they may review. No self-review; every review action permanently logged. Future reputation (domain reputation, accuracy, missed regressions, escalations, disagreement history): collect the data, don't invent the algorithm. HumanReviewContribution: assigned/authorized, independent, under active policy, tied to a real contribution, entered into the permanent record — never rewarded for merely clicking approve. Agent-vs-human disagreements (e.g. Astra PASS, Fable PASS, Human FAIL: authorization vulnerability) become reviewer-eval cases; human review is reduced only on measured outcomes.

**WOS on Solana devnet**: working target 1,000,000,000 maximum supply (not sacred). Working allocation for review — agent/contributor emissions 60%, completion pools 15%, protocol/community treasury 10%, founding/core contributors 7.5%, security/research/review 5%, reserve 2.5% — **superseded where it conflicts with A6/A7** (no premine; founder via contribution + Genesis). The architect produces TOKENOMICS-REVIEW.md.

**Emissions**: never fix "X provider tokens = Y WOS". Measure → normalise → accumulate qualifying contribution → split a predefined epoch emission pool proportionally (automatic difficulty adjustment; more contributors never cause unlimited issuance). Compare (1) fixed max supply with asymptotic emissions, (2) fixed bootstrap pool + later fee economy, (3) bootstrap + low perpetual tail. Preference: strong early emissions, declining, no cliff, eventual support from real network usage, possible low tail if justified. **Simulations reproducible from code** at 1k / 10k / 100k / 1M contributors, with inference-cost declines, provider price changes, extreme growth, low participation and completion rewards → TOKENOMICS-SIMULATION.md.

**Epochs** (configurable, V1 default 7 days): epoch_id, start, end, reward policy version, oracle version, emission budget, total qualified compute, contributor allocations, status OPEN → CALCULATING → FINALIZED → DISTRIBUTABLE → CLOSED.

**Devnet pipeline**: AgentRun → UsageReceipt → ContributionReceipt → normalised compute → epoch → allocation → devnet WOS → contributor wallet.

**Genesis**: record verified GenesisContributions from the first real qualifying contribution; 1 devnet WOS ≠ 1 mainnet WOS; a capped Genesis Contributor Pool at mainnet is computed from receipts, never devnet balances; no promised conversion ratio.

**Solana architecture**: minimal on-chain footprint (no code/diffs/logs/contexts/reviews on chain). Consider mint, authorities, multisig, epoch roots, receipt hashes, claims, vesting, completion pools; evaluate a Merkle-distribution model (compute allocations off-chain → publish epoch root → contributors claim with proofs). Devnet may keep development authorities; mainnet must explicitly define mint / freeze / upgrade / treasury / emergency authorities and never leave unilateral unlimited mint → TOKEN-AUTHORITIES.md.

**Not in V1**: mainnet, presale/ICO, investment dashboard, price talk, exchange integration, liquidity pools, promised conversion, revenue-sharing rights.

**Reward eligibility** (full): valid lease, authorized model, valid context manifest, usage accepted under UsageProofPolicy, within cap, deterministic verification PASS, Astra PASS, Fable PASS, required human PASS, merged/accepted, no policy violation. Partial rewards for valid failed attempts: maybe later; V1 prefers simplicity.

**Abuse**: track suspicious token consumption, repeated cap saturation, abnormal usage vs comparable ABUs, repeated failures, collusive reviews, Sybil behaviour, model spoofing, fabricated usage, manipulated telemetry, duplicate attempts, coordinated farming, intentional looping, context inflation, compromised reviewer accounts. Build AbuseSignal and ContributionRiskFlag (auditable); no perfect fraud algorithm in V1. Admins can inspect flagged runs, suspend reward eligibility / contributor / reviewer privileges, invalidate fraudulent receipts **before epoch finalization**, document reasons, restore. No silent confiscation; every admin action is an immutable AdminAction (actor, target, action, reason, timestamp, affected contribution/reward, previous state, resulting state).

**Finality**: AgentRun → qualifies → PENDING_REWARD → epoch closes → abuse/risk checks → finalized → allocation fixed → devnet distribution/claim → FINAL; bounded window defined by RewardPolicy, no indefinite discretionary hold.

**Reproducibility**: given AgentRun, UsageReceipt, oracle version, RewardPolicy version, ContributionReceipt and epoch state, anyone can reproduce the allocation. A deterministic reward-engine package with extensive tests; the site eventually explains each allocation.

**ContributionReceipt** (immutable, canonical serialisation + hash, may later be anchored on chain): receipt id, contributor, wallet, contribution type, target, feature, ABU, agent run, usage receipt, context manifest hash, base commit, merge commit, PR, verification result hash, Astra / Fable / human review hashes, qualified compute, reward policy version, oracle version, qualified_at.

**Contribution types**: APPLICATION_ROADMAP, FEATURE_SPECIFICATION, ARCHITECTURE_RESOLUTION, IMPLEMENTATION, AGENT_REVIEW, HUMAN_REVIEW, SECURITY, INTEGRATION, DOCUMENTATION, OTHER_PROTOCOL_APPROVED; RewardPolicy decides eligibility and treatment. Planning runs are reward-eligible only when attached to protocol-created canonical work objects (one active roadmap per target, one active contract per feature).

**Completion pools**: FeatureCompletionPool and ApplicationCompletionPool, separate from epoch emissions, unlocking only when the accepted definition of complete is met on every required surface (desktop, web, mobile, API) plus acceptance, security and self-host; distribution by CompletionRewardPolicy (weights not hard-coded yet).

**Progress**: MAPPED / SPECIFIED / BUILT per target, per surface where useful (desktop, web, mobile, API, self-host); zero is zero; unknown is shown as unknown.

**Collusion**: no self-review; one identity cannot fill multiple required reviewer slots; independent agent reviews use separate contexts/sessions and never see each other's current verdict; architect for future random reviewer assignment (V1 admin assignment).

**AgentPolicy** (versioned) by capability class, not brand: e.g. IMPLEMENTATION builder minimum BUILD_L4; required agent reviews REVIEW_A and REVIEW_B at maximum reasoning; human review per ReviewPolicy. Initial mapping Opus / Astra / Fable, open to future approved models. **ModelQualificationSuite**: models earn classes (BUILD_L1–L4, ARCHITECT_L1, SECURITY_REVIEW_L1…) by passing wOS evals; build interfaces and record model performance now.

**Contributor UX**: show what contributors understand — "DEDICATE OPUS / task / authorized token cap 400,000 / tokens consumed / estimated reward under Epoch #18 / [BUILD]"; live "tokens contributed 184,291 / 400,000"; after qualification "tokens (attested) … / normalised compute 3.82 ACU / epoch 18 / estimated WOS … / PENDING EPOCH FINALIZATION". Never promise a final amount before finalization. (Label usage honestly: attested unless truly verified.)

**Public transparency**: network stats (agent runs, tokens contributed, normalised compute, accepted compute, contributions merged, human reviews, applications, features, completed features, current epoch, emission budget); contributor profiles (tokens contributed, accepted compute, merged contributions, roadmap/feature contributions, reviews, WOS earned/pending, apps contributed to); opt-in leaderboard.

**Self-hosting and rewards are separate**; rewards are never DRM.

**Wallet UX**: evaluate embedded wallet vs external Solana wallet vs both; never expose seed phrases casually; don't custody production assets without explicit custody design; devnet may be simpler but must not create unsafe mainnet assumptions. The architect recommends the V1 wallet architecture.

**Devnet end-to-end proof** (automated, testable): devnet wallet → eligible ABU → lease → authorised Opus run → context → usage measured → cap enforced → implementation → verification → Astra (max) → Fable (max) → human review → qualifies → official PR → merge → ContributionReceipt → epoch → epoch closes → reward engine allocates → devnet distribution root/transaction → contributor claims/receives devnet WOS → profile updates → leaderboard (opt-in) → Sniper List progress → dependent ABUs unlock.

**MAINNET-READINESS.md** gate: tokenomics simulation, Solana program security, authorities, multisig, reward abuse, Sybil resistance, wallet security, epoch finality, oracle integrity, Genesis allocation, receipt integrity, economic attacks, upgrade authority, emergency procedures, applicable regulatory considerations. Mainnet is deliberate.

**Policy engine** (major principle): versioned ReviewPolicy, RewardPolicy, AgentPolicy, UsageProofPolicy, RiskPolicy, MergePolicy, CompletionRewardPolicy, GenesisAllocationPolicy; every contribution/reward records the versions in force; future changes never rewrite history.

**Admin V1**: manage reviewers and domains, suspend reviewer privileges, view suspicious runs and AbuseSignals, suspend reward eligibility, inspect receipts and epoch calculations, manage model eligibility and oracle versions, view policy versions — all audited; no big governance system yet.

**Required architect outputs before coding the economic layer**: TOKENOMICS-REVIEW.md, TOKENOMICS-SIMULATION.md, SOLANA-ARCHITECTURE.md, REWARD-PROTOCOL.md, USAGE-PROOF.md, HUMAN-REVIEW.md, ABUSE-MODEL.md, TOKEN-AUTHORITIES.md, GENESIS-POLICY.md, and an ADR on implementing as written vs modified. The architect is explicitly authorised to challenge the specification and must not silently deviate.

**Foundational rule**: agents provide scale; humans provide judgment; the protocol provides coordination; contributors provide compute; the commons receives the software; wOS records and rewards the contribution.

## Part C — coordinator's draft economic model (input for the architect, not binding)

- ACU = reference API cost of the run's usage under the oracle version in force (1 ACU ≈ $1 reference compute).
- Execution (builders, agent reviewers, resolvers): accepted ACU of the merged attempt's runs, capped at the unit/review budget; outliers vs peers raise AbuseSignals; ~5% random audit re-runs by a second contributor; agent reviewers also get a bonus for upheld material findings.
- Planning authoring: accepted-revision ACU + a share of the pools of features the accepted document defined.
- Proposals: small acceptance bounty + finder's share (starting ~2%) of that feature's completion pool; first valid proposal wins, duplicates linked; rate limits; triage by agents + human under ReviewPolicy. Bugs: severity ladder, paid when confirmed and fixed. Security: 25 / 100 / 300 / 1000 ladder (existing).
- Completion pools: ~15% of each epoch budget accrues to feature and app pools, paid at full completion across required surfaces to ACU contributors, authors and the finder.
- Epoch split placeholders (to be set by simulation): ~70% execution, 15% completion pools, 10% planning, 5% proposals/bugs.
- Human reviewers: ACU-equivalent by risk class (e.g. 10% of the unit's accepted ACU) + upheld-finding bonus; never for clicking approve.
- Every usage figure is labelled ATTESTED unless genuinely verified.
