# warOnSaaS V1 — founder's specification (verbatim, 2026-09-29)

This is the founder's original brief. Decisions made after it are in `docs/DECISIONS.md` and take precedence where they differ.

---

# V1 IMPLEMENTATION MODE: MULTI-AGENT REQUIRED

This V1 itself MUST be built using a coordinated multi-agent workflow.

Do not assign the entire warOnSaaS V1 implementation to one coding agent sequentially.

The architecture of this development process should deliberately dogfood the system we are building: centralized architecture and contracts, isolated agent contexts, bounded write scopes, parallel implementation, independent verification, and controlled integration.

## PHASE 0 — LEAD ARCHITECT

Begin with ONE Opus agent acting as Lead Architect.

Do NOT launch implementation agents until the Lead Architect has established the shared foundation.

The Lead Architect owns:

- monorepo structure
- architectural boundaries
- PostgreSQL schema
- domain model
- shared TypeScript types
- API contracts
- event contracts
- roadmap schemas
- Feature Contract schemas
- Atomic Build Unit schemas
- agent-policy schemas
- context-manifest schemas
- contribution schemas
- reward/token ledger schemas
- GitHub integration contracts
- application boundaries
- security boundaries
- dependency rules

The Lead Architect must create:

`ARCHITECTURE.md`

`DOMAIN-MODEL.md`

`ROADMAP-PROTOCOL.md`

`FEATURE-CONTRACT.md`

`BUILD-PROTOCOL.md`

`CONTEXT-PROTOCOL.md`

`AGENT-POLICY.md`

`REVIEW-PROTOCOL.md`

`REWARD-PROTOCOL.md`

`SECURITY.md`

These become the initial architectural constitution for all implementation agents.

The Lead Architect must also scaffold the monorepo and establish shared interfaces before parallel implementation begins.

Do not overbuild implementations during this phase.

The objective is to create stable boundaries that allow multiple agents to work simultaneously without collisions.

---

# PHASE 1 — CREATE ISOLATED IMPLEMENTATION AGENTS

After the shared contracts exist, create separate implementation agents using Opus.

Each agent MUST:

- receive its own context package
- operate in its own Git worktree
- have explicit directory ownership
- have explicit read permissions
- have explicit forbidden paths
- consume frozen shared contracts
- avoid modifying another agent's owned area
- report architectural blockers rather than silently changing shared contracts

Recommended initial workstreams:

## AGENT 1 — CONTROL PLANE

Own:

`services/control-plane/`

Primary responsibilities:

- API
- authentication integration
- projects
- Sniper Targets
- application roadmaps
- features
- Feature Contracts
- Atomic Build Units
- dependency graphs
- leases
- state machines
- progress calculations
- contributor records
- application/feature progress events

May consume shared packages.

Must not redesign shared schemas without escalating to Lead Architect.

---

## AGENT 2 — DESKTOP

Own:

`apps/desktop/`

Build:

**wOS Desktop**

Technology:

- Electron
- React
- TypeScript

Responsibilities:

- authentication
- Sniper List browsing
- application drilldown
- feature drilldown
- build-unit browsing
- BUILD flow
- local Claude Code detection
- local agent status
- terminal/activity display
- contribution history
- contributor profile
- settings

The Electron privileged/main process handles:

- local processes
- Git
- worktrees
- Claude Code
- filesystem access
- verification commands

The renderer must NOT receive unrestricted Node access.

Use secure IPC/context isolation.

---

## AGENT 3 — PUBLIC WEB

Own:

`apps/web/`

Build:

**warOnSaaS public website**

The website is a major V1 product, NOT a placeholder marketing page.

Homepage centers on:

# THE SNIPER LIST

Display real targets and real progress.

Initial targets:

1. Salesforce
2. HubSpot
3. Slack
4. Zoom
5. Shopify
6. QuickBooks
7. Jira
8. Zendesk
9. DocuSign
10. NetSuite

NO MOCK PROGRESS DATA.

If something is 0%, display 0%.

Every application exposes independently:

- MAPPED %
- SPECIFIED %
- BUILT %

Users can drill:

Application
→ capability
→ feature
→ requirement
→ Atomic Build Unit
→ contribution/PR

Also build:

- public application pages
- feature pages
- roadmap views
- latest activity
- contributor profiles
- opt-in leaderboard
- token/reward history
- GitHub PR links
- self-hosted/hosted status

---

## AGENT 4 — GITHUB + LOCAL BUILD SYSTEM

Own the appropriate Git/GitHub packages.

Responsibilities:

- repository management
- worktrees
- branches
- immutable base commits
- task leases
- allowed/forbidden paths
- diff validation
- commit generation
- push
- GitHub App/API
- PR creation
- PR metadata
- merge webhooks
- branch protection/check integration
- contribution provenance

Implement the rule:

**LEASE → BUILD → VERIFY → REVIEW → QUALIFY → PR**

Do NOT create an official implementation PR before wOS qualification succeeds.

GitHub is the public/auditable record.

wOS is the coordination/control plane.

---

## AGENT 5 — CONTEXT ENGINE + AGENT POLICY

Own:

`packages/context-engine/`

and appropriate agent-policy packages.

This is a critical subsystem.

Build deterministic, role-specific context generation for:

- Application Roadmap Agent
- Application Roadmap Astra Reviewer
- Application Roadmap Fable Reviewer
- Feature Agent
- Feature Astra Reviewer
- Feature Fable Reviewer
- Builder
- Implementation Astra Reviewer
- Implementation Fable Reviewer
- Architecture Conflict Resolver

Every agent invocation must receive its OWN context.

Astra and Fable must independently review without seeing the other's current conclusion.

Every invocation generates an immutable Context Manifest containing:

- role
- model
- reasoning requirement
- target
- feature
- task
- source commit
- included artifacts
- artifact hashes
- excluded artifacts
- context version

Implement context budgets.

Atomic Build Units that cannot safely fit inside the permitted builder context budget must be rejected for further decomposition.

---

## AGENT 6 — ROADMAP AI + REVIEW ORCHESTRATION

Build the multi-agent planning/review system.

Application Roadmaps use ONE canonical active Roadmap PR per application.

Example:

`Zoom Replacement Roadmap`

Nobody creates competing canonical Zoom roadmaps.

Contributors propose changes into the canonical roadmap workflow.

Required independent reviewers:

**Astra — maximum available reasoning**

AND

**Fable — maximum available reasoning**

Both must independently attempt to prove the roadmap incomplete.

Continue review/revision rounds until both report:

`NO MATERIAL GAPS`

Then:

`ROADMAP CONSENSUS`

Do the same at Feature Contract level.

A merged Application Roadmap generates canonical Feature workflows.

A merged Feature Contract generates a Build Graph of Atomic Build Units.

Implementation contributions also require independent Astra + Fable review under their own implementation-review contexts.

Reviewer requirements must be represented as machine-readable Agent Policies rather than hard-coded prompt prose.

---

## AGENT 7 — REWARDS / TOKEN ACCOUNTING / LEADERBOARD

Build the V1 reward architecture.

Do NOT deploy or market a publicly transferable cryptocurrency in V1.

However, implement the complete internal WOS token/allocation ledger architecture so accepted contribution events can accrue allocations from day one.

Use append-only accounting.

Never mutate balances directly.

Contribution categories include:

- accepted Application Roadmap work
- accepted Feature Contract work
- accepted architecture issue resolution
- accepted implementation
- accepted review
- security work
- Feature reaching 100%
- Application reaching 100%

No reward merely for opening a PR.

Reward accepted useful output.

Support:

- contributor balances
- contribution points
- token allocations
- feature completion pools
- application completion pools
- reward history
- public opt-in leaderboard

Keep token transferability/redemption disabled behind explicit future governance/legal activation.

Document the proposed token distribution architecture separately from implementation.

---

## AGENT 8 — VERIFICATION / INTEGRATION / SECURITY

Own integration/evaluation infrastructure.

Responsibilities:

- deterministic verification
- typechecking
- linting
- unit tests
- integration tests
- task acceptance tests
- diff/scope validation
- security checks
- context tests
- roadmap-state tests
- concurrency tests
- lease tests
- integration-wave tests
- end-to-end tests

This agent should actively attempt to break the system.

It must test simultaneous independent builders.

---

# PHASE 2 — PARALLEL EXECUTION

Once the Lead Architect freezes initial shared contracts, implementation agents may work simultaneously.

Every agent operates in its own Git worktree.

Do not allow agents to casually modify shared contracts.

When an agent discovers a shared contract is insufficient, it must emit an:

`ARCHITECTURE_BLOCKER`

containing:

- affected contract
- reason
- evidence
- requested capability
- affected workstream
- suggested resolution if known

The Lead Architect evaluates blockers.

If a shared contract changes:

1. version it
2. identify affected agents
3. update their context
4. rebase/reconcile affected work
5. continue

Never silently change a shared interface underneath active agents.

---

# PHASE 3 — INTEGRATION WAVES

Do not wait until every agent finishes to integrate everything.

Use controlled integration waves.

Example:

WAVE 0
Architecture + contracts

WAVE 1
Control plane
Context engine
GitHub foundation
Database

INTEGRATE + TEST

WAVE 2
Desktop
Public web
Roadmap AI
Rewards

INTEGRATE + TEST

WAVE 3
End-to-end workflows
Real roadmap workflows
CRM first executable Build Graph

INTEGRATE + TEST

After every integration wave:

- run full tests
- inspect contract violations
- resolve merge conflicts intentionally
- test cross-workstream behavior
- update architecture documentation
- only then begin dependent work

---

# DOGFOOD THE wOS MODEL

The process used to build V1 should intentionally resemble the system wOS will later provide to contributors.

Track for every V1 implementation agent:

- context size
- task scope
- files owned
- files changed
- duration
- blockers
- merge conflicts
- repair loops
- verification failures
- integration failures

Document lessons learned.

Anything that makes this multi-agent V1 build difficult should be considered potential evidence of a missing wOS capability.

Examples:

If agents repeatedly need files omitted from their contexts:
→ improve Context Engine.

If agents collide despite different paths:
→ improve logical resource locking.

If tasks are too large:
→ improve Atomic Build Unit decomposition.

If interfaces change constantly:
→ improve Feature Contract/architecture phase.

If integration repeatedly fails:
→ improve integration-wave generation.

We are building the factory by using an early version of the factory's principles.

---

# IMPORTANT: MULTI-AGENT DOES NOT MEAN UNCONTROLLED SWARM

Do NOT simply launch many agents against the same repository.

The hierarchy is:

Lead Architect
→ shared contracts
→ isolated contexts
→ isolated worktrees
→ bounded ownership
→ parallel implementation
→ verification
→ controlled integration

Each implementation agent must know:

**WHAT IT OWNS**

**WHAT IT MAY READ**

**WHAT IT MAY NOT CHANGE**

**WHICH CONTRACTS IT MUST HONOR**

**WHAT CONSTITUTES DONE**

**WHEN IT MUST ESCALATE**

---

# V1 APPLICATION REQUIREMENTS

V1 includes BOTH major user-facing applications:

## 1. wOS Desktop

The contributor/build environment.

## 2. warOnSaaS Web

The public Sniper List / roadmap / progress / contribution / leaderboard experience.

Neither is optional.

Also include:

## 3. wOS CLI

The CLI and Desktop must use the same underlying orchestration logic.

Core commands should include:

`wos build`

`wos roadmap`

`wos propose`

`wos resolve`

`wos review`

`wos status`

The desktop is a graphical interface over the same protocol.

---

# FINAL V1 INTEGRATION TEST

V1 is successful when all of the following work together:

A real Sniper Target exists.

Its real Application Roadmap is visible publicly.

The roadmap was independently reviewed by Astra MAX and Fable MAX.

A Feature Contract has reached consensus.

That Feature Contract has been decomposed into a dependency-aware Build Graph.

The Build Graph contains Atomic Build Units sized for one Opus agent.

Multiple independent ABUs from the same feature can be leased simultaneously without overlapping write/logical ownership.

A contributor can:

1. install wOS Desktop
2. authenticate
3. select Salesforce
4. select CRM
5. select a feature
6. select an eligible Atomic Build Unit
7. press BUILD

OR run:

`wos build <task-id>`

wOS then:

8. verifies agent/model eligibility
9. issues a lease
10. creates an isolated worktree
11. assembles the correct Builder Context
12. launches local Claude Code/Opus
13. enforces scope
14. runs deterministic verification
15. creates independent Astra review context
16. creates independent Fable review context
17. runs both at maximum required reasoning
18. resolves failures/revisions
19. qualifies the contribution
20. creates the real GitHub PR
21. records provenance
22. merge updates Build progress
23. rewards are recorded
24. contributor leaderboard updates
25. dependent ABUs unlock
26. public Sniper List updates

At no point should fake progress or mock contribution data be required.

That is the V1.
