# Live price-market MVP

The current product supports real BTC/USD and ETH/USD threshold markets on Cookie Chain. A creator chooses an above/under condition, exact UTC deadline, starting probability, and initial COOK liquidity. Traders buy whole YES or NO shares through Nightly and the AMM updates its odds after each confirmed trade.

## Settlement template

New price markets commit to Coinbase Exchange's `BTC-USD` or `ETH-USD` 60-second candle CLOSE for the exact interval immediately preceding settlement. Settlement times must align to a UTC minute. The collector preserves the provider response and exact decimal token, verifies the market's immutable question and rules hashes, and creates evidence bound to the network, program, market, source, bucket, threshold, and outcome.

The resolver worker discovers expired markets, locks trading, loads published terms, requests the committed candle, stores evidence, proposes YES/NO/Invalid, and finalizes according to the on-chain challenge period. It does not substitute a current spot price or another provider when the committed candle is unavailable; such a failure can result in Invalid rather than an invented outcome.

## Trading safeguards

- Initial liquidity is at least 100 COOK in the application flow.
- Each purchase is capped at 1% of current pool liquidity.
- Outcome purchases use whole shares.
- Quotes include the configured LP and platform-owner fees.
- Maximum total input is enforced on-chain.
- The frontend simulates prepared transactions before requesting a signature.
- Market state and timestamps are rechecked by the program at execution.

## Invalid-market accounting

The AMM records each wallet's YES/NO share balance and collateral cost basis. If a market resolves Invalid, each side is refunded from its recorded cost basis rather than a fixed amount per share. Partial refunds are proportional to tracked shares and cost. The contract enforces both market-wide refund liability and available-vault checks, so total refunds cannot exceed reserved collateral.

Accrued LP and owner fees are not distributed for an Invalid result. The UI displays the position, attributable amount, refundable amount, and claimed state from verified on-chain accounting.

## Application services

- `POST /api/protocol` publishes verified terms and collects settlement evidence.
- `GET /api/protocol?markets=true` discovers verified on-chain markets.
- `GET /api/protocol?position=<market>&user=<wallet>` returns verified balances and tracked AMM position data.
- `scripts/market-keeper.mjs --watch` provides continuous automatic settlement.

Persistent terms and evidence storage must use a backed-up `COOKIE_MARKETS_TERMS_DIR`. The Docker deployment uses a named volume. The resolver keypair is an operational secret and is never part of the image or repository.

## Current boundaries

The MVP has a deployed program and uses real COOK. It still requires an independent security audit, continued production monitoring, resolver redundancy, and stronger governance before it should be treated as mature financial infrastructure. Coinbase data availability and the designated resolver remain explicit external dependencies.
