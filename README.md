# CookieMarkets

[![CI](https://github.com/DrEsmaily/cookie-markets/actions/workflows/ci.yml/badge.svg)](https://github.com/DrEsmaily/cookie-markets/actions/workflows/ci.yml)

CookieMarkets is a real, on-chain prediction market for Cookie Chain. It lets anyone create a simple Bitcoin or Ethereum price question, provide the starting liquidity in COOK, and let other users buy YES or NO shares with a Nightly wallet.

The goal is to make prediction markets feel understandable to ordinary users. People see the question, current odds, maximum trade, deadline, position, and possible payout without needing to understand the AMM calculations behind the market.

## Why CookieMarkets matters

CookieMarkets turns COOK from a token people can hold into an asset people can actively use. It is a working consumer application: a market creator supplies real liquidity, traders take clear YES or NO positions, the market updates its odds on-chain, and users can claim their outcome when the rule is resolved. There is no simulated balance and no hidden off-chain ledger.

For judges, the project demonstrates the complete journey from wallet to protocol:

- A clean, responsive product interface that makes an advanced financial primitive approachable.
- A deployed Cookie Chain program that controls collateral, share issuance, trading limits, settlement state, and claims.
- Real Nightly wallet connection and transaction approval, with every action inspectable on Cookiescan.
- Transparent rules, exact UTC deadlines, and a committed public price source for supported BTC and ETH markets.
- A focused economic design: creator-provided liquidity, a protected 1% maximum trade size, and deferred creator fees that preserve clear user-facing numbers.

The MVP is deliberately narrow so it can be tested honestly with real COOK today. Its long-term opportunity is much larger: a reusable market layer for the Cookie Chain ecosystem, covering community forecasts, ecosystem milestones, governance questions, creator markets, and other objectively verifiable events. CookieMarkets is designed to grow from a polished price-market MVP into an everyday prediction and coordination tool for the network.

## What the product does

- Creates BTC and ETH price markets with an exact UTC settlement time.
- Locks real COOK collateral in the CookieMarkets program on Cookie Chain.
- Lets a creator choose the starting YES and NO percentages and provide at least 100 COOK of liquidity.
- Lets traders buy whole YES or NO shares through Nightly.
- Limits each transaction to 1% of the current pool so a single trade cannot move the market too aggressively.
- Recalculates the displayed odds after every trade.
- Records a 1% creator fee and releases it as part of the creator’s final settlement instead of disturbing the pool after every purchase.
- Resolves supported price markets from the committed Coinbase one-minute candle source.
- Lets winning shares claim 1 COOK each after a verified result.
- Returns temporary wrapped native COOK to normal native COOK during claims.
- Shows connected-wallet positions, locked creator liquidity, claimable COOK, and the three latest transactions.
- Refunds supported positions when a market is finalized as Invalid instead of burning the remaining collateral.

The deployed program ID is:

```text
BNqof3tMVwNd7rthycJTtXkvbGtopihvL9gpeoSk8WaR
```

You can inspect it and every market transaction on [Cookiescan](https://cookiescan.io).

## Why this helps Cookie Chain

CookieMarkets gives COOK an additional native use beyond holding or transferring it. Markets create recurring on-chain activity through market creation, liquidity deposits, trades, settlement, and claims. They also demonstrate that Cookie Chain can support a complete consumer application with wallet signing, token custody, deterministic program accounts, public price evidence, and an interface that hides blockchain complexity from the user.

For the network, the project can become:

- A visible consumer use case for COOK.
- A source of repeat wallet and transaction activity.
- A reusable market primitive for communities, creators, and other Cookie Chain applications.
- A foundation for richer markets based on crypto, ecosystem milestones, governance, and verified external events.

## Run it locally

Requirements:

- Node.js 22 or newer.
- npm.
- The Nightly browser extension.
- A Nightly wallet funded with COOK on Cookie Chain.

Install and start the application:

```bash
git clone https://github.com/DrEsmaily/cookie-markets.git
cd cookie-markets
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

In Nightly, select or add Cookie Chain with:

```text
RPC: https://rpc.cookiescan.io
WebSocket: wss://wss.cookiescan.io
Genesis hash: 9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2
```

Connect Nightly from the top-right of CookieMarkets. The application checks the network before preparing a transaction, and Nightly shows the final transaction for approval.

## Using CookieMarkets

### Create a market

1. Select BTC or ETH.
2. Choose whether the question asks if the price will be above or under a target.
3. Enter the USD target and exact date and time.
4. Deposit at least 100 COOK as starting liquidity.
5. Choose the opening YES percentage; NO is calculated automatically.
6. Review the generated question and settlement rules.
7. Approve the real market transaction once in Nightly.

### Trade a market

1. Open a live market.
2. Choose YES or NO.
3. Enter a whole number of shares within the displayed per-trade limit.
4. Review the cost, creator fee, total payment, and winning payout.
5. Approve the transaction in Nightly.

One winning share claims 1 COOK. The amount paid for that share depends on the current market odds. For example, paying about 0.20 COOK for one YES share can return 1 COOK if YES wins. The claim transaction can make the wallet’s native balance rise by slightly more than the payout when Nightly also closes a temporary wrapped-COOK account and returns its rent deposit.

### Settlement and claims

Trading closes at the displayed UTC deadline. The resolver verifies the committed Coinbase price observation and finalizes YES, NO, or Invalid. Winning users can then claim, and the creator can claim the remaining settlement value and accumulated creator fees. No unresolved pool collateral is intentionally burned.

## Project structure

- `app/` — Next.js pages and server routes.
- `components/` — wallet, market, trading, creation, and status interfaces.
- `lib/` — Cookie Chain configuration, account decoding, instruction building, market terms, AMM math, and transaction preparation.
- `programs/cookie_markets/` — the Rust program deployed to Cookie Chain.
- `scripts/market-keeper.mjs` — automatic market settlement worker.
- `tests/` — client, pricing, transaction, and validator integration tests.
- `docs/` — protocol design, release, market terms, and operational notes.

## Validation

Run the frontend checks with:

```bash
npm run lint
npm test
npm run build
```

Run the Rust unit tests with:

```bash
cargo test --workspace
```

GitHub Actions repeats linting, TypeScript tests, the production build, Rust formatting and tests, the deployable SBF build, and transaction tests against a disposable local validator. Successful SBF jobs publish only the program binary—never a wallet keypair.

## Current status

The MVP uses a real deployed Cookie Chain program and real COOK collateral. It is suitable for controlled testing and demonstrations, but it has not received an independent external security audit. Users should test with limited amounts until an audit and longer production monitoring are complete.

The application is server-backed and cannot be hosted as a static GitHub Pages site. The complete source, build history, and usage instructions are live in this GitHub repository. A public web deployment should use a Node.js host with persistent storage for published market terms and a continuously running resolver worker.

## Planned improvements

Near-term work:

- Independent smart-contract and economic security review.
- Public production hosting with monitoring and backed-up persistent market-term storage.
- More robust resolver redundancy, retries, and operator alerts.
- Clearer portfolio performance, trade history, and settlement receipts.
- Accessibility testing across browsers and mobile devices.
- Better market discovery, search, and filters as activity grows.

Future possibilities:

- Additional trusted price sources and assets.
- Cookie Chain ecosystem and governance markets.
- Liquidity-management tools for market creators.
- Share selling and deeper secondary-market functionality.
- Public APIs and embeddable market cards for other applications.
- Community moderation and decentralized resolver designs.

## Safety

No private keys, seed phrases, wallet secrets, or funded deployment credentials belong in this repository. Never paste them into an issue, pull request, environment file, or support message.
