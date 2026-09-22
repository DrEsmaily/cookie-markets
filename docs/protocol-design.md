# CookieMarkets protocol design

This document describes the deployed protocol. It is an implementation guide, not a substitute for an independent security audit.

## Product model

- Markets settle to `Yes`, `No`, or `Invalid`.
- Native COOK is represented by its native SPL mint while in token-program custody and is unwrapped in supported return flows.
- A market creator supplies the initial AMM liquidity and becomes that market's liquidity provider.
- Traders buy whole YES or NO shares. A per-transaction cap limits each AMM purchase to 1% of current pool liquidity.
- Market questions and resolution rules are immutable SHA-256 commitments, with readable copies published by the application.
- Supported BTC/ETH templates resolve from Coinbase Exchange's exact preceding completed one-minute candle.

## Principal accounts

| Account | Seed | Purpose |
| --- | --- | --- |
| Protocol config | `config` | Admin, resolver, collateral mint, LP fee, owner fee, owner-fee recipient, challenge period |
| Market | `market`, creator, nonce | Immutable terms, schedule, outcome mints, vault, state, result |
| Vault | `vault`, market | Holds collateral backing positions, refunds, and deferred fees |
| AMM pool | `amm_pool`, market | Market creator, liquidity, YES/NO reserves, accrued LP fee, settlement state |
| Market accounting | `accounting`, market | Invalid-refund liability and accrued owner fees |
| AMM position | `position`, market, user | Per-user YES/NO shares and exact collateral cost basis |
| Resolution proposal | `resolution`, market | Proposed outcome, evidence hash, proposer, and challenge data |

## Fee policy

The on-chain `ProtocolConfig` stores independent `liquidity_provider_fee_bps` and `owner_fee_bps` values plus `owner_fee_recipient`. Only the current admin can update those values. `update_protocol` can also transfer administration to a new nonzero public key.

Every trade quote reads the current configuration. The pool records the LP fee for that market's creator, while market accounting records the platform-owner fee. Fees remain in the market vault during trading. A valid final result releases them through creator settlement; an Invalid result reserves collateral for exact trader refunds and does not distribute the accrued fees.

## AMM trading and accounting

`buy_amm_shares` calculates a checked quote from pool liquidity, reserves, the desired side, and both configured fee rates. It transfers gross collateral to the vault, updates reserves and displayed odds, sends whole outcome shares to the buyer, and records shares held, gross collateral cost, Invalid refund liability, accrued LP fees, and accrued owner fees.

This data is authoritative for settlement and refunds. The UI formats values from verified accounts and matching quote logic.

## Resolution and claims

The lifecycle is `Draft → Open → Locked → Proposed → Resolved`.

The configured resolver proposes `Yes`, `No`, or `Invalid` with an evidence hash. The configured challenge period may be zero for immediate finalization or positive for delayed finalization. A resolved market cannot return to an earlier state.

For YES or NO, winning positions redeem according to the protocol payout and the creator settles the remaining AMM value, accrued LP fee, and platform-owner fee. For Invalid, `refund_invalid_position` burns the requested tracked shares and returns their proportional recorded cost basis. The instruction checks the user's tracked position, market refund liability, and available vault collateral before transferring funds.

## Security invariants

- All arithmetic is checked and amounts are unsigned base units.
- Every transfer binds the expected mint, authority, token program, PDA, and market.
- Market terms, schedule, collateral mint, and resolver cannot be changed after creation.
- Trading stops at the on-chain close timestamp.
- Aggregate Invalid refunds cannot exceed tracked liability or vault collateral.
- A user cannot refund more shares or cost basis than recorded for that position.
- LP fees belong to the creator recorded in that market's pool, not a global LP address.
- Only the current admin can change protocol configuration or transfer administration.
- Signing remains with the connected wallet or secured resolver process.

## Operational trust and future work

The current design uses a designated resolver and committed external evidence. That trust boundary is explicit. Production hardening should add independent review, multisig governance, redundant evidence collection, resolver monitoring, and eventually multi-oracle or decentralized resolution options.
