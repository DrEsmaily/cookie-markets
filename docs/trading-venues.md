# Trading venues: live AMM and experimental order-book primitives

The deployed user experience uses the creator-funded AMM. It supports whole-share YES/NO purchases, a 1%-of-liquidity per-transaction cap, on-chain configurable LP and owner fees, position cost-basis tracking, settlement claims, and exact Invalid refunds.

The repository also contains escrowed ask and collateral-funded bid primitives. Those order-book components remain experimental and are not the primary live trading interface. Their discovery endpoints return verified confirmed-state snapshots, not reservations or guarantees against concurrent fills or cancellation.

The order preparation endpoint accepts `market`, `user`, and `action` (`place`, `fill`, or `cancel`). Placement needs decimal `amount`, decimal `price` (up to six fractional digits), string u64 `nonce`, `side`, and string Unix-second `expiresAt`. A fill needs `order`, decimal `amount`, decimal `maximumDebit` including trading fees, and optional boolean `wrapNative`. Both placement and fills require `question`, `resolutionSource`, and `resolutionRules` that reproduce the on-chain hashes. Cancellation needs only the order identity and maker wallet; it does not require readable terms or an open market. An unsuccessful simulation returns no unsigned transaction. Network-fee estimates exclude rent. Purchase proceeds remain wrapped collateral when the approved mint is wrapped native COOK. Concurrent changes can invalidate a prepared quote; re-prepare before eventual signing. Validator tests separately submit these assembled transactions using disposable generated wallets and prove actual token transfers, while confirming unsigned simulation alone changes no balances.

## Shared rules

The fee token account may intentionally be the same associated account as the seller's proceeds or the buyer's funding account when that wallet is the configured fee recipient. Only this SPL account opts into Anchor's duplicate-account allowance. Its collateral mint and snapshotted owner checks still apply; order state and other custody accounts retain duplicate protections. These token balances are changed by SPL CPIs, not serialized from modified Anchor-owned copies. Validator tests cover both recipient aliases and reject a substituted fee owner. Quotes show gross consideration plus fees; if the buyer is the fee recipient, the fee returns to the buyer's own account, so its net debit is lower than the conservative maximum.

Trade collateral against one market's YES or NO mint. Keep the existing complete-set backing vault separate from trading escrow and pool reserves. Never count liquidity as extra backing or let a trading authority mint outcome shares. Both venues must validate the market, mint, token-program authority, open state, and close timestamp on-chain, not merely in the interface. Cancellation and liquidity recovery must remain available after trading closes.

Amounts are unsigned 64-bit base units. Order intermediates fit unsigned 128-bit arithmetic; the pool's fee-weighted numerator can exceed 128 bits at full u64 reserves, so its Rust implementation requires checked wider arithmetic or explicit tested reserve caps. Never silently wrap or truncate an intermediate. The reference implementation uses bigint. Fixed order prices use a scale of 1,000,000 collateral units per share unit, assuming equal collateral/outcome mint decimals. An execution instruction must check that assumption. Price one represents a full collateral unit per share, not a guaranteed profit.

Fee parameters in quote tests are inputs, not approved live fees. Fee policy, liquidity funding, and authorities still require explicit decisions before deployment.

## First: escrowed limit orders

Maker-owned asks escrow existing shares, with a nonce-bound order PDA, checked market/side/mint, fixed price, total and filled quantity, and expiry no later than market close. Takers pay collateral, receive shares atomically, and enforce a maximum collateral debit. Only the maker can cancel and recover remaining shares. Anyone may fill an unexpired open order; no trusted matching server can withdraw escrow. Funded bids are described below. Indexing, best-price selection, application integration, and concurrency coverage remain necessary before claiming a full order book.

Charge each fill the difference between rounded cumulative consideration before and after the fill. Apply fee rounding to cumulative consideration too. This avoids charging repeated rounding premiums for fragmented fills. Reject any fill whose collateral transfer rounds to zero: no shares should leave escrow for free. Record progress only within the same atomic transfer transaction. Caller-supplied prior fills are not authoritative; read them from the order account.

`place_ask` snapshots the protocol fee rate and recipient. `fill_ask` enforces the taker's maximum debit and pays the maker and fee recipient before transferring escrowed shares, all within one atomic instruction. Self-trades are rejected. `cancel_ask` works independently of market state/expiry and returns the entire remaining escrow balance. Order and escrow accounts remain allocated, including after cancellation, to prevent nonce reuse and stale-order replay; rent recovery is not implemented. Unsolicited tokens sent after cancellation cannot be recovered through this version. No order authority has access to the market backing vault.

### Collateral-funded bid primitive

`place_bid` locks the entire rounded consideration and cumulative fee budget in a collateral token account controlled by the nonce-bound bid PDA. The order snapshots collateral/outcome mints and the configured fee rate/recipient. `fill_bid` transfers existing outcome shares from a seller to the buyer, pays the seller from escrow, and transfers the incremental fee atomically. The seller supplies a minimum consideration; self-trades, overfills, zero-consideration fills, and expired/closed trading are rejected. Fill progress and balances roll back together on a failed transfer. Fee proceeds may share the seller's collateral account only with the validated fee-recipient owner/mint constraints.

`cancel_bid` is maker-only and independent of the market's status or readable terms. It returns all remaining collateral, including the unused fee budget. Order and escrow accounts stay allocated to prevent nonce reuse; repeated cancellation is rejected and tokens donated after cancellation have no recovery instruction yet. Strict 213-byte bid decoding checks PDA/bump, market, both mints, price, expiry, quantities, fee limits, and the fee-inclusive u64 budget. Validator tests execute YES/NO partial fills, rounding, cancellation, substituted accounts, protection limits, duplicate placement, and failed-transfer rollback with disposable wallets. These are contract/client primitives: bid discovery, unsigned bid review, best-price matching, and signed application execution are still not available.

## Live venue: creator-funded AMM

The deployed AMM maintains market-specific YES and NO reserves and presents their relative balance as market odds. Quotes use actual on-chain liquidity and reserves together with the current protocol fee configuration. Purchases are whole-share transactions and are capped at 1% of pool liquidity per transaction.

Pool initialization binds one creator as that market's liquidity provider. Trading records user shares and cost basis, accrues separate LP and owner fees, and preserves collateral for settlement or exact Invalid refunds. Settlement and claim paths are covered by unit and disposable-validator transaction tests.

## Gate for expanding the experimental order book

Before the experimental order-book venue becomes a primary signed user flow, complete best-price routing, pagination/indexing, concurrency coverage, recovery behavior, interface integration, and a dedicated security review. Passing arithmetic tests alone is not completion of that venue.
