# Astra review 01 — of AMENDMENT-02 (before the protocol design)

Reviewer: Astra (gpt-6-astra via Codex), run by the founder, 2026-09-29. Scope: `docs/AMENDMENT-02-PROOF-OF-CONTRIBUTION.md` plus the repository's decision, review, build, agent-policy and reward documents. Verbatim.

---

**The amendment captures most of the intended design, but I would not approve economic-layer implementation yet.** The main problems are unresolved trust assumptions, conflicting reward rules, and migration from the existing protocol—not missing headline features.

**Critical changes**

1. **Define what usage evidence actually qualifies for rewards and Genesis.**
   UsageProofProvider (line 35) correctly distinguishes VERIFIED from ATTESTED, but leaves eligibility open. Existing D1 explicitly says the server cannot prove which model ran on a contributor's machine.

   A modified client can submit useful code alongside fabricated token consumption. Independent code review establishes output quality; it does not establish inference consumption. Signing or hashing client telemetry preserves the claim without proving it true.

   **Edit:** require a provider-by-provider evidence matrix before implementation: evidence source, trust boundary, independently verifiable fields, replay protection, and eligible reward classes. Unsupported proof must fail closed. Attested usage may support explicitly experimental devnet allocations, but must not silently become verified Genesis compute. Store its confidence permanently. Also replace line 110's blanket "ATTESTED unless genuinely verified": estimates and unsupported claims must retain ESTIMATED and UNVERIFIED labels.

2. **Explicitly replace the existing bootstrap self-review exception.**
   A4 (line 13) and line 77 require independent reviews and a non-author human. However, REVIEW-PROTOCOL line 119 permits the author to review, including one account filling both agent slots during bootstrap.

   Holding rewards afterward does not satisfy the new approval requirement.

   **Edit:** explicitly supersede that exception for V1 qualification and merge. When independent reviewers are unavailable, work remains pending. Any demonstration mode must be separately marked and unable to produce qualifying contribution receipts. Bind human approval to the reviewed revision, diff, and policy; invalidate approval after material changes.

3. **Resolve "maximum available" versus the repository's permitted maximum.**
   AgentPolicy (line 79) preserves maximum-setting Astra and Fable reviews. But the existing agent policy (AGENT-POLICY.md line 58) lists Astra `ultra` above `max`, forbids it because of delegation, and defines `max` as wOS's maximum. It also says Claude's per-model support was not exercised.

   **Edit:** define this as "maximum reasoning permitted by the pinned AgentPolicy," document the deliberate exception to the conversation's wording, and record requested and observed settings plus evidence confidence. Unsupported settings must block the run rather than silently downgrade. Separate, sealed review contexts are already specified correctly.

4. **Create one conserved reward budget. Part C currently leaves competing interpretations.**
   Lines 47–51 propose lifetime allocations and proportional epoch emissions. Line 73 calls completion pools separate from epoch emissions. Lines 106–109 then fund completion pools from epochs, add fixed bounties, and introduce synthetic ACU for humans.

   Separate accounting pools can share a funding source, but the document must say whether these amounts are deducted, reserved, or additional. Otherwise implementations can double-count issuance.

   **Edit:** specify one funding equation covering execution, planning, reviews, bounties, completion reserves, and unused balances. Every allocation must debit an identified budget. Define rounding, empty epochs, unclaimed allocations, canceled pools, and total-supply treatment. Remove the old fixed bounty ladder as an executable default until its funding is reconciled.

5. **A token cap limits abuse; it does not remove the incentive to waste tokens.**
   A2 (line 9) rewards consumption, including repairs. A contributor who reaches the cap receives more weight than an efficient contributor producing equivalent accepted work. Part C's human reward of approximately 10% of the builder's ACU also gives reviewers an interest in inflated builder usage.

   **Edit:** retain the requested usage-based model, but require simulations of cap saturation, context inflation, expensive-model selection, unnecessary repairs, task splitting, and coordinated builder/reviewer behavior. Separate human-review reward weights from measured compute and cap their budget independently. A random rerun can assess output or plausibility; it cannot prove historical token consumption.

**Other high-priority edits**

6. **Specify canonical usage accounting and enforceable caps.**
   Lines 31–39 name the right fields but do not define whether categories overlap, how cumulative reports are deduplicated, or how retries, tools, and child-agent calls count.

   Add mutually exclusive accounting categories, explicit units, integer precision, unique usage-event identities, and provider adapter fixtures. Freeze rates before execution. Define budget reservation for concurrent requests, treatment of in-flight overshoot, and aggregate repair budgets. Distinguish **execution stopping** from **reward clipping**—the latter is enforceable even when a contributor modifies their local runner.

7. **Strengthen lease expiry and submission semantics.**
   Exclusive leases (line 41) preserve atomic exclusivity, but omit the conversation's explicit prohibition on holding an ABU indefinitely without an active run.

   Add a hard lease lifetime and a monotonically increasing lease generation checked on submissions and state changes. Once reassigned, the previous worker must be unable to submit, release the new worker's locks, or earn another receipt. Clarify that the lease must be valid **when submission is accepted**, rather than remain alive through review and epoch settlement.

8. **Define epoch admission, policy snapshots, and settlement finality.**
   Lines 51–69 do not settle which epoch receives work started under one oracle version and merged during another. The receipt's field list also omits several policy versions required by line 93.

   Add immutable run-policy snapshots, an explicit epoch admission rule, a frozen receipt manifest, deterministic rounding, and exactly-once allocation. Fraud invalidation should append a revocation record, not mutate an immutable receipt.

   Require retry-safe devnet settlement, wallet-ownership binding, duplicate-claim prevention, and reconciliation after uncertain transaction outcomes. The old protocol's post-release clawbacks and adjustments (REWARD-PROTOCOL line 93) need an explicit replacement: changing an internal balance does not itself reverse a distributed token.

9. **Separate historical founder credit from verified protocol contributions.**
   A6 (line 17) introduces retrospective credit based on git history and reports. That is materially different evidence from line 55's verified contribution receipts.

   Git history can support authorship and accepted output; it cannot establish provider-token consumption.

   **Edit:** use a distinct historical-credit category with evidence hashes, a published cap, independent approval, and deduplication against later receipts. Never reconstruct "verified tokens" from commits. Clarify the terminology: "no discretionary founder allocation" is compatible with a published historical-credit rule, but "no premine" does not explain when or how its eventual tokens are issued.

10. **Freeze completion criteria and define acceptance by contribution type.**
    Completion pools (line 73) correctly include required surfaces, security, and self-hosting. Add a versioned completion definition, committed funding, beneficiary rules, and handling for scope changes and shared features across applications.

    Also narrow line 61's universal eligibility checklist. Human reviews do not consume provider tokens or hold BuildLeases. Security findings and architecture rulings have different acceptance events. Define those events explicitly, including who accepts review contributions, to avoid an endless requirement to review each review.

**What to keep—and simplify**

The document correctly preserves Proof of Contribution, Claude/Codex normalization, bounded epoch emissions, exclusive ABU leases, independent agent review, required but configurable human review, audited fraud controls, receipt-based Genesis accounting, devnet-first delivery, and no initial mainnet/ICO. These requirements were not lost in condensation.

Keep V1 to versioned policy records and deterministic evaluators. Defer a general policy language, reputation scoring, model certification machinery, embedded custody, on-chain governance, and custom vesting unless the reviewed architecture demonstrates a concrete need. Merkle distribution is an option to evaluate, not a V1 requirement.

Finally, add a **supersession and migration table**. The existing reward protocol still specifies nontransferable credits, fixed awards, per-app pools, and clawbacks. The amendment changes those foundations. An implementation should not have to guess which old rules survive.
