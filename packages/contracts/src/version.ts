/**
 * Version of the frozen shared contracts.
 *
 * Semantic versioning, per docs/architecture/WORKSTREAMS.md "Contract versioning":
 * - PATCH: comments, docs, tightening a description. No type or schema change.
 * - MINOR: additive only (new optional field, new route, new event type, new enum member
 *   that consumers are required to treat as unknown-safe). Existing producers and consumers
 *   keep compiling and keep passing.
 * - MAJOR: anything else. Requires a Lead Architect decision recorded in
 *   docs/architecture/CHANGELOG-CONTRACTS.md and a rebase of every affected workstream.
 *
 * Every persisted record that embeds a contract shape (context manifests, events, ledger
 * entries, provenance) also stores the contracts version it was written under.
 */
export const CONTRACTS_VERSION = "5.11.0" as const;

/** Version of the deterministic context format. Bumped by the context-engine owner via blocker. */
export const CONTEXT_FORMAT_VERSION = "ctx-1" as const;

/** The public wording that must appear wherever WOS tokens are shown (D3). */
export const TOKEN_DISCLAIMER = "WOS tokens are in-app credits with no cash value." as const;
