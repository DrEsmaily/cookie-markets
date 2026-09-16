# CookieMarkets protocol design v0.1

This document defines the first implementation target. It is deliberately conservative: binary markets, one collateral asset, explicit resolution rules, and no upgrade or deployment assumptions yet.

## Product choices

- Markets have `Yes`, `No`, and `Invalid` final outcomes.
- Collateral is an SPL token account selected by an allowlist. Native COOK should be wrapped before it enters program custody so all accounting uses token-program transfers.
- Complete sets are fully collateralized: one unit of collateral mints one Yes share and one No share. A complete Yes + No pair can be merged back into one unit before resolution.
- Trading is closed at a fixed timestamp. Shares remain redeemable after resolution.
- The market creator cannot unilaterally resolve a market.
- Every market commits to immutable question and rules hashes. Full text is stored in the app/indexer and displayed before trading.

## Accounts and PDA seeds

| Account | Seed | Purpose |
| --- | --- | --- |
| Protocol config | `config` | Admin, fee recipient, collateral allowlist authority, global limits |
| Market | `market`, creator, market nonce | Times, hashes, state, resolver, outcome mints, vault |
| Collateral vault | `vault`, market | Holds collateral backing complete sets |
| Resolution proposal | `resolution`, market | Proposed outcome, evidence hash, proposer, challenge deadline |
| User position | ATA for outcome mint | Standard transferable Yes or No share balance |

No seed should depend on question text. The client generates a market nonce so repeated questions remain possible.

## Instructions

1. `initialize_protocol` creates configuration and fee settings.
2. `create_market` validates timestamps and text hashes, creates the vault and outcome mints, and starts in `Draft`.
3. `open_market` permanently freezes market terms and enables complete-set minting.
4. `split_collateral` transfers collateral into the vault and mints equal Yes and No shares.
5. `merge_positions` burns equal shares and returns collateral while the market is unresolved.
6. `lock_market` moves an expired market from `Open` to `Locked` and disables new positions.
7. `propose_resolution` records Yes, No, or Invalid with an evidence hash.
8. `challenge_resolution` flags the proposal for the configured resolver/multisig during the challenge window.
9. `finalize_resolution` records the outcome after the challenge window.
10. `redeem` burns winning shares and transfers collateral pro rata. Invalid markets let either side redeem at half value per share, preserving one full unit per complete set.

## State machine

`Draft → Open → Locked → Proposed → Resolved`

A challenged proposal remains `Proposed` until the resolver replaces or confirms it. A cancelled draft may close only before collateral enters the vault. No instruction can move a resolved market backward.

## Resolution model

The MVP uses a designated resolver controlled by a multisig, plus a public challenge window. This is simpler to audit than pretending arbitrary real-world facts can be trustlessly derived on-chain. Each proposal includes an evidence hash; the indexer stores and displays the underlying source links and snapshots.

The resolver must follow the immutable rules hash. `Invalid` is used only when the source is unavailable, the question is ambiguous under its written rules, or the measured event cannot be determined. Future versions can replace the designated resolver with an oracle adapter without changing share custody.

## Invariants

- Vault collateral is never less than the unresolved complete-set liability, excluding explicitly accrued fees.
- Yes and No supply increase by exactly the same amount during a split.
- A merge burns exactly equal Yes and No amounts.
- Trading and minting stop at `closes_at`; resolution cannot be proposed before `resolve_after`.
- Question, rules, collateral mint, close time, and resolution source cannot change after opening.
- Fees are bounded in basis points and deducted only at documented transfer points.
- Every token transfer verifies the expected mint, token program, authority, and PDA derivation.

## Deferred decisions

- Exact resolver multisig and signer threshold.
- Allowed collateral mint for the first deployment.
- Whether v1 includes an AMM or starts with complete-set minting plus an external order book.
- Fee rates and fee split. Current frontend constants are placeholders, not deployed economics.
- Program upgrade authority and eventual immutability policy.

These choices require user approval before program code, program IDs, deployment commands, or wallet signatures are introduced.
