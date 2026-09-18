# Real-chain price-market MVP

First-release scope: BTC/USD and ETH/USD threshold markets, funded limit offers with direct fills, Nightly-controlled transactions, order/position management, collateral redemption, and evidence-backed resolver settlement. AMM pools and automatic matching are deferred, not required for this release.

The creation form now generates fixed price rules from an asset, positive USD threshold, future close time, and explicitly named dataset/methodology. Local browser time is converted to UTC. The threshold comparison is inclusive (price >= target means YES). Decimal prices use eight-place fixed precision without floating-point rounding. Generated text is hashed through the existing immutable market terms flow. These remain reviewed drafts; editing generated terms creates different hashes, and the contract does not enforce this template as a market type.

The evidence window accepts observations at or before settlement, at most 60 seconds old. The latest qualifying observation must be selected from the approved dataset; a late lookup's current price is not acceptable. Unavailable or ambiguous data and missing timely evidence require INVALID according to the published rules. Evidence is due within 24 hours. The comparison helper checks asset, source identity, timestamp window, and decimal threshold only: it cannot authenticate an API response, prove the observation is the latest, enforce evidence publication, or resolve the contract itself. Those responsibilities require a separately verified collector and named resolver.

Launch gates still open:

- Select and verify a data provider with suitable historical/timestamped access, licensing, and outage policy. CoinMarketCap is a candidate, not an already connected source.
- Bid API simulation/review is implemented through `POST /api/orders/prepare` with `orderType: "bid"` (omission retains existing asks). Placement quotes use the verified protocol fee rate and may explicitly wrap native collateral; fills require decimal `minimumProceeds` and cannot wrap native funds. Both placement/fills verify exact readable terms and simulate the unsigned transaction. Cancellation remains maker-only without a terms or open-market requirement. Buy/sell book selection is available on the market review screen. Signing/submission remains disabled.
- Complete explicit wallet signing/submission/confirmation, positions/open orders, and settlement controls.
- Publish user-created terms and settlement evidence durably; the current bundled terms registry is not a production publishing service.
- Execute full-flow validator and browser tests, security review, and production authority/operational safeguards.
- Obtain explicit deployment approval and user-controlled real-chain signatures. Passing local tests is not proof of deployment or live operation.

No provider credentials, real wallet signatures, deployment, or liquidity funding are used by the template implementation.
