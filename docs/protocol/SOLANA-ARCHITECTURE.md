# SOLANA-ARCHITECTURE (DRAFT)

Principle: **minimal on-chain footprint, existing programs only.** Code, diffs, logs, contexts, reviews and receipts stay off chain; the chain holds the token, the settlement transfers, and a Memo anchor of each epoch's roots. No custom Rust program in V1. The off-chain ledger is canonical; Solana is a settlement adapter (OFF-RAMP.md).

## 1. Programs used

| Program | Use | Why this one |
|---|---|---|
| SPL Token-2022 | the WOS mint and token accounts | audited SPL program; native metadata extension (no Metaplex dependency) |
| Associated Token Account program | contributors' WOS accounts | standard |
| SPL Memo | epoch anchor: `wos-epoch:<n>:<receiptsRoot>:<allocationsRoot>:<resultSha256>:<adminActionsHead>` | free, standard, no custom code |
| Squads v4 multisig | mint authority (devnet after rehearsal, mainnet until revoked), emergency pause signer, metadata authority | widely used multisig; its own upgrade authority and audit status must be checked at the gate (UNVERIFIED here) |
| (mainnet option) an audited Merkle distributor | pull claims at scale | only if push transfers are too costly at mainnet scale (section 5) |
| (governance, later) SPL Governance + VSR, or a vesting/escrow program | ≥ 12-month locks | TOKENOMICS-REVIEW §6 |

## 2. The mint

- **Token-2022**, 6 decimals, extensions: `MetadataPointer` + `TokenMetadata` only (name "WOS", symbol "WOS", URI to a static JSON on waronsaas.com with the disclosure text).
- **Not used, deliberately:** `NonTransferable` (permanent; would force a new mint if WOS becomes tradeable, A5), `PermanentDelegate` (an on-chain seizure power: a master key over every holder is the largest attack target and contradicts a neutral proof of contribution; confiscation after proven cheating is off chain, over protocol-held amounts only, D39), `TransferHook` (custom program, wallet/DEX incompatibility), `TransferFee`, `DefaultAccountState=frozen`, `ConfidentialTransfer`, `MintCloseAuthority`.
- **Freeze authority: none** (set to `None` at creation, devnet and mainnet).
- Devnet WOS is transferable and has no value; every UI surface that shows it says "Devnet WOS has no monetary value."

## 3. Epoch roots and anchoring

At PROPOSED the engine publishes three roots (sha256, `protocol/receipts.ts` P-3/P-4): the receipts root of the frozen manifest, the allocations root (Merkle tree over `ClaimLeaf`s, `leaf = sha256(0x00 || JCS(leaf))`, `node = sha256(0x01 || left || right)`), and the result hash. At FINALIZED → DISTRIBUTABLE one Memo transaction anchors them with the admin-actions head hash. Anyone can recompute the roots from public data and compare them with the Memo. Receipt hashes are anchored in aggregate (the receipts root), not one by one.

## 4. Devnet settlement: claim-triggered push transfers (v2, Astra-02 H3)

1. The contributor runs `wos claim` or presses **Claim**. The control plane offers duty audits (0–3); the client runs them; if no eligible audit can be offered by the deadline the claim proceeds flagged `unaudited` (D42). Unmet offered duty withholds, never forfeits, for up to 8 epochs.
2. The claimable entitlements of the beneficiary (released-now amounts, matured holdback, bounties, withheld releases) become ONE leaf to the beneficiary's currently bound wallet (organizations: their registered wallet). v3 (Astra-03 H2): each claim locks its entitlement and takes the entitlement's whole REMAINING balance (after confiscation holds), so an entitlement is in at most one live leaf even under concurrent claims; a leaf is frozen once its first attempt is signed; a leaf is voided only by its own `void_leaf` action, never once confirmed, and only when every attempt is proven expired — only then are its entitlements claimable again. Mainnet leaves are refused outright in this draft (default-deny at the settlement boundary).
3. **Persist before broadcast:** the worker builds and signs the `transferChecked` (+ ATA creation, fee paid by wOS, Memo `wos-leaf:<leaf id>`) and records the signed bytes, their hash, the signature and `lastValidBlockHeight` as attempt n BEFORE sending. The DB allows one unresolved attempt per leaf; a retry REBROADCASTS THE SAME BYTES.
4. **Resolve ambiguity before replacing:** a new attempt (n + 1) is allowed only after attempt n has the outcome `expired_not_landed`, which requires (a) an OBSERVED block height above `lastValidBlockHeight`, stored with the outcome and checked by the DB, and (b) a HISTORICAL signature search (`getSignatureStatuses` with `searchTransactionHistory`, or `getTransaction`) that does not find it, stored verbatim — the default status cache is not proof of non-payment. Every signed attempt is ambiguous until then: there is no "failed before broadcast" outcome for signed bytes (v3, Astra-03 H9). **Confirmation** is recorded only at `finalized` commitment with its slot (NULL is refused), once per leaf (DB unique).
5. **Fencing:** leaves and attempts carry the settlement adapter generation; a paused or superseded generation accepts no attempt; migrations drain first (OFF-RAMP §3). v3: leaf and attempt writes take a SHARED fence lock that pauses, adapter switches and migration snapshots take EXCLUSIVELY, so a snapshot can never be written beside an attempt that was mid-insert; the broadcaster calls `wos.may_broadcast(leaf, attempt)` in the transaction that logs each (re)broadcast and sends only on true. None of this has run against a real cluster yet (no Solana toolchain here, G-74, G-89): "exactly once" is claimed only after the devnet end-to-end test.
6. **Reconciliation:** per epoch and historically, finalized transfers are matched to leaves and entitlements, and the distribution wallet's balance to the unsettled total; any mismatch blocks CLOSED and raises an incident.

Why push, not a Merkle distributor, on devnet: tens to hundreds of claimants, no third-party program, no proofs in clients, simpler UX (the contributor needs no SOL), and Astra-01 called Merkle distribution optional. The allocation Merkle root still exists for verification.

## 5. Mainnet settlement (decided at the readiness gate, F7)

| Option | For | Against |
|---|---|---|
| Push transfers from a per-epoch funded hot wallet (as devnet) | simplest; exposure limited to one epoch's total | one transaction per claimant per claim; hot key |
| Audited Merkle distributor, one per epoch (e.g. Jito's `distributor` supports unlocked + linearly vesting amounts and a clawback time; the Solana Foundation `rewards` program advertises Token-2022 and vesting) | scales; no hot key holding funds beyond the vault | Token-2022 support, audits and upgrade authority UNVERIFIED; claimants need a fee payer (wOS can sponsor fees as fee payer); proofs in clients |

Either way: deploy any distributor **from its audited commit with a verifiable build**, upgrade authority set to `None` after deployment (a third party's upgradeable deployment is not acceptable: its upgrade authority could drain vaults).

## 5b. Genesis vesting (mainnet only)

Genesis credit vests linearly over 2 years from mainnet launch with no cliff, released by the PROTOCOL as scheduled `genesis_vesting` entitlements each epoch (settled like any other leaf) rather than by an on-chain vesting program, so unreleased Genesis stays confiscatable after proven cheating (D39) and no custom vesting code is needed.

## 6. Authorities

Summarised here; normative in TOKEN-AUTHORITIES.md: mint (devnet dev key → Squads; mainnet: emission escrow then revoke), freeze (none), metadata update (Squads), distributor upgrade (none), treasury (none: no treasury; the security reserve and pools are off-chain balances funded as emitted), emergency (Squads 3-of-5 pause of the *settlement worker* — never of tokens), governance (off chain in V1).

## 7. Wallets (Desktop, Web, CLI)

**Recommendation for V1: external wallets only, no custody, no seed phrases in any wOS surface.**

| Surface | How a contributor binds and claims |
|---|---|
| Web (`app.waronsaas.com/wallet`) | Wallet Standard adapter (Phantom, Solflare, Backpack…): sign the `walletBindingMessage` (account id, wallet, cluster, nonce, issued-at, "moves no funds"); claims need no signature (push) |
| Desktop | never loads a Solana key; the main process opens the web wallet page in the system browser (`openExternal` allowlist gains `https://app.waronsaas.com/wallet`); Claim runs duty audits through the existing Build IPC, then calls `POST /v1/claims` |
| CLI | `wos wallet bind --address <pubkey>` prints the message; the user signs it with `solana sign-offchain-message` (their own Solana CLI keypair) and pastes the signature, or uses the web page; `wos claim` runs duty and requests settlement |
| Organizations (D38, D45) | an org owner/admin binds the org's beneficiary wallet. A Squads vault is a PDA and cannot sign a message (H9): it proves control by EXECUTING an approved multisig transaction that posts the binding message (naming the account, organization and wallet) as an SPL Memo; the binding records that transaction signature and the authorized controllers |

Rules: one beneficiary per wallet and one wallet per beneficiary per cluster, enforced by a privileged registry that RLS cannot hide (H9, repro D); re-binding needs an e-mail confirmation plus a signature from the new wallet and has a 7-day cooldown; leaves use the wallet bound when the epoch finalizes; allocations without a wallet carry 52 epochs. **Embedded wallets** (MPC/custodial providers) are deferred: they bring a custody design and a third-party dependency; revisit if contributors without wallets are a real barrier. Devnet must not create mainnet assumptions: devnet bindings are per cluster and never carry over.

## 8. What stays off chain

Receipts, run logs, reviews, diffs, contexts, disputes, governance votes (V1), abuse signals, admin actions. The chain sees: the mint, transfers, Memo anchors, and (mainnet) escrow/vesting/distributor accounts.
