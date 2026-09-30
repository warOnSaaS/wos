# TOKEN-AUTHORITIES (DRAFT) — who can change what

Rule from Part B: devnet may keep development authorities; mainnet must define every authority explicitly and never leave a unilateral unlimited mint. Rule from A5/A7: no company treasury, no sales, no liquidity. Rule from D35: the off-chain record survives any failure of the token.

## 1. Table

| Authority | Devnet rehearsal | Devnet steady state | Mainnet |
|---|---|---|---|
| **Mint** | a dev keypair on the founder's machine (CI key for the E2E test) | Squads 2-of-3 (founder + 2 seed contributors or advisors) | the emission escrow is funded once at launch (section 3), then mint authority is **revoked** (`None`); Genesis is minted into its vesting position in the same launch transaction set |
| **Freeze** | none | none | none |
| **Metadata update** | dev key | Squads | Squads 3-of-5, then optionally made immutable |
| **Program upgrade** | n/a (no custom programs) | n/a | any deployed distributor/escrow: `None` after a verifiable build |
| **Distribution (settlement worker key)** | dev key | a hot key funded per epoch with exactly the epoch's claimable total | same (push) or a distributor vault (pull) |
| **Treasury** | none | none | none — pools and the security reserve are off-chain balances; on-chain they exist only inside the emission escrow until settled |
| **Emergency** | founder | Squads 2-of-3 can pause the settlement worker | Squads 3-of-5 can pause the settlement adapter for ≤ 14 days (auto-expiring, governance must ratify); it cannot mint, freeze, move tokens or change policy |
| **Policy** | founder (AdminAction) | founder until the governance activation threshold | tiered dual-supermajority governance (GOVERNANCE.md) |

Signers of the mainnet multisig: at least 5 named people, the founder at most one of them, at least two not employed by wOS; keys on hardware wallets; the signer list is public.

## 2. What no one can do, by construction

- mint beyond max supply (escrowed supply + revoked mint authority);
- freeze or seize anyone's WOS (no freeze authority, no permanent delegate);
- change past allocations (append-only ledger, anchored roots, forward-only policy);
- move escrowed emission except on the escrow's schedule (section 3);
- vote with unemitted, pooled, multisig or wOS-controlled WOS (D37).

## 3. Mainnet emission custody — options

| Option | How | Unlimited mint? | Custom code | Verdict |
|---|---|---|---|---|
| **M1 Escrow + revoke (recommended)** | at launch mint the emission reserve into an audited time-lock/vesting escrow whose unlock schedule upper-bounds the emission curve (e.g. monthly tranches of the 4-year half-life curve) with the settlement multisig as beneficiary; revoke mint authority | no — supply fixed on chain | none | best available; unlocked-but-unemitted WOS sits in the multisig vault and is publicly reconciled each epoch (vault balance = cumulative unlocked − cumulative settled); unused emission (rate ceiling) accumulates there and is re-offered by the engine, never spent otherwise |
| M2 Emission controller program | a small program holds mint authority and mints per epoch at most `curve(e)` into the settlement vault, only with multisig approval | bounded by code | yes (audit required) | cleaner accounting; costs an audit |
| M3 Retained timelocked multisig mint authority | a governance-controlled multisig mints each epoch | yes, bounded only by signers | none | rejected: an unlimited mint held by people |

Devnet uses M3 with a dev key (worthless token, rehearsal only).

## 4. Off-ramp and authorities (D35)

A migration never needs a retained mint authority. Under M1 the migration path is: freeze accounting at a declared epoch (snapshot), stop settlement, and pay unclaimed entitlements under the new adapter: a **new mint** (a successor token or chain) minted 1:1 against the snapshot's unclaimed and outstanding balances, or in-app credits. Holders of settled WOS keep them; whether a successor mint also mirrors *settled* balances is a structural governance decision taken before the snapshot, published with the mapping rule. Retaining a mint authority "for migrations" would recreate exactly the unilateral unlimited mint Part B forbids, so it is rejected.

## 5. Change control

Changing any authority (adding a signer, rotating a key, making metadata immutable) is a structural governance change once governance is active, a two-person AdminAction before that, announced ≥ 72 h ahead, recorded in `admin_actions` with the transaction signature.
