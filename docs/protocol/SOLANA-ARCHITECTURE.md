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
- **Not used, deliberately:** `NonTransferable` (permanent; would force a new mint if WOS becomes tradeable, A5), `PermanentDelegate` (a confiscation power; "no silent confiscation"), `TransferHook` (custom program, wallet/DEX incompatibility), `TransferFee`, `DefaultAccountState=frozen`, `ConfidentialTransfer`, `MintCloseAuthority`.
- **Freeze authority: none** (set to `None` at creation, devnet and mainnet).
- Devnet WOS is transferable and has no value; every UI surface that shows it says "Devnet WOS has no monetary value."

## 3. Epoch roots and anchoring

At PROPOSED the engine publishes three roots (sha256, `protocol/receipts.ts` P-3/P-4): the receipts root of the frozen manifest, the allocations root (Merkle tree over `ClaimLeaf`s, `leaf = sha256(0x00 || JCS(leaf))`, `node = sha256(0x01 || left || right)`), and the result hash. At FINALIZED → DISTRIBUTABLE one Memo transaction anchors them with the admin-actions head hash. Anyone can recompute the roots from public data and compare them with the Memo. Receipt hashes are anchored in aggregate (the receipts root), not one by one.

## 4. Devnet settlement: claim-triggered push transfers

1. The contributor runs `wos claim` or presses **Claim** (Desktop, web). The control plane returns duty audit tasks (0–3); the client runs them; the claim is then eligible (unmet duty withholds, not forfeits, for up to 8 epochs).
2. For each final leaf of the account (one per epoch, net of offsets), the settlement worker (holding the **devnet distribution key**, funded per epoch with exactly that epoch's claimable total) builds an SPL `transferChecked` (creating the recipient's ATA if needed; the worker pays fees and rent), with a Memo `wos-leaf:<epoch>:<index>`.
3. **Retry safety:** before sending, the worker records `(epoch, leafIndex, attempt, signature, lastValidBlockHeight)` as `pending`. On an uncertain outcome it polls the signature status; if the current block height exceeds `lastValidBlockHeight` and the signature is unknown, the transaction can no longer land (`expired_not_landed`) and a new attempt is made. A `confirmed` row is unique per leaf (DB `settlement_one_confirmed`), which is the duplicate-claim backstop.
4. Reconciliation: after DISTRIBUTABLE, the worker sums confirmed transfers per epoch and compares them with the leaves and the distribution wallet balance; mismatches block CLOSED.

Why push, not a Merkle distributor, on devnet: tens to hundreds of claimants, no third-party program, no proofs in clients, simpler UX (the contributor needs no SOL), and Astra-01 called Merkle distribution optional. The allocation Merkle root still exists for verification.

## 5. Mainnet settlement (decided at the readiness gate, F7)

| Option | For | Against |
|---|---|---|
| Push transfers from a per-epoch funded hot wallet (as devnet) | simplest; exposure limited to one epoch's total | one transaction per claimant per claim; hot key |
| Audited Merkle distributor, one per epoch (e.g. Jito's `distributor` supports unlocked + linearly vesting amounts and a clawback time; the Solana Foundation `rewards` program advertises Token-2022 and vesting) | scales; no hot key holding funds beyond the vault | Token-2022 support, audits and upgrade authority UNVERIFIED; claimants need a fee payer (wOS can sponsor fees as fee payer); proofs in clients |

Either way: deploy any distributor **from its audited commit with a verifiable build**, upgrade authority set to `None` after deployment (a third party's upgradeable deployment is not acceptable: its upgrade authority could drain vaults).

## 5b. Genesis vesting (mainnet only)

Genesis credit is issued at mainnet launch as a linear 2-year vesting position with no cliff, via the chosen audited distributor's vesting fields or an audited vesting program. No custom vesting code (Astra-01: defer custom vesting).

## 6. Authorities

Summarised here; normative in TOKEN-AUTHORITIES.md: mint (devnet dev key → Squads; mainnet: emission escrow then revoke), freeze (none), metadata update (Squads), distributor upgrade (none), treasury (none: no treasury; the security reserve and pools are off-chain balances funded as emitted), emergency (Squads 3-of-5 pause of the *settlement worker* — never of tokens), governance (off chain in V1).

## 7. Wallets (Desktop, Web, CLI)

**Recommendation for V1: external wallets only, no custody, no seed phrases in any wOS surface.**

| Surface | How a contributor binds and claims |
|---|---|
| Web (`app.waronsaas.com/wallet`) | Wallet Standard adapter (Phantom, Solflare, Backpack…): sign the `walletBindingMessage` (account id, wallet, cluster, nonce, issued-at, "moves no funds"); claims need no signature (push) |
| Desktop | never loads a Solana key; the main process opens the web wallet page in the system browser (`openExternal` allowlist gains `https://app.waronsaas.com/wallet`); Claim runs duty audits through the existing Build IPC, then calls `POST /v1/claims` |
| CLI | `wos wallet bind --address <pubkey>` prints the message; the user signs it with `solana sign-offchain-message` (their own Solana CLI keypair) and pastes the signature, or uses the web page; `wos claim` runs duty and requests settlement |
| Organizations (D38) | an org owner/admin binds the org's beneficiary wallet (recommended: a Squads multisig) the same way; the binding records `organization_id` |

Rules: one account (or organization) per wallet per cluster (DB `check_wallet_binding`); re-binding needs an e-mail confirmation plus a signature from the new wallet and has a 7-day cooldown; leaves use the wallet bound when the epoch finalizes; allocations without a wallet carry 52 epochs. **Embedded wallets** (MPC/custodial providers) are deferred: they bring a custody design and a third-party dependency; revisit if contributors without wallets are a real barrier. Devnet must not create mainnet assumptions: devnet bindings are per cluster and never carry over.

## 8. What stays off chain

Receipts, run logs, reviews, diffs, contexts, disputes, governance votes (V1), abuse signals, admin actions. The chain sees: the mint, transfers, Memo anchors, and (mainnet) escrow/vesting/distributor accounts.
