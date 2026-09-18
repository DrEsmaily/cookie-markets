# Verified buy-order discovery

`GET /api/protocol?bids=<market-address>` verifies Cookie Chain genesis, the executable protocol, configuration, and market before returning decoded bid orders. Requests containing both `asks` and `bids` are rejected. Invalid market addresses return 400 before contacting the RPC.

Every bid collateral escrow must be an initialized legacy SPL token account, use the market collateral mint, and be owned by the bid PDA. Its balance must cover the remaining cumulative consideration and fee budget. Cancelled and fully filled orders need no remaining budget but their custody bindings are still checked. Donations are allowed; a surplus does not increase order quantity.

Orders sort by descending price with address tie-breaking. Results include cancelled, filled, and expired orders, across YES and NO; clients must filter by outcome and trading state before presenting executable liquidity. Prices from different outcomes must not be treated as competing bids for the same asset. At most 1,000 orders are accepted, with escrow reads batched in groups of 100.

This is a confirmed-state snapshot, not a reservation or guaranteed atomic view across RPC calls. Contract checks remain authoritative for execution. Best-price matching, pagination/indexing, unsigned bid review, signing, and deployment are separate unfinished milestones. No real funds or wallet signatures are used by discovery.
