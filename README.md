# CookieMarkets

An early, read-only frontend for prediction markets on Cookie Chain. It establishes the product language, Cookie Chain configuration, and a Nightly wallet connection before any market program or signing flow is introduced.

## Included today

- Next.js App Router + TypeScript frontend.
- Cookie Chain RPC, WebSocket, explorer and verified genesis hash configuration.
- Nightly Wallet Standard connection that only requests account access; it creates no transactions and requests no signatures.
- Local domain models and a responsive market-discovery interface.
- Market detail pages with explicit resolution sources and rules.
- A conservative [protocol design](docs/protocol-design.md) for a future Anchor implementation.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Cookie Chain setup

In Nightly, add a custom SVM network with:

- RPC: `https://rpc.cookiescan.io`
- WebSocket: `wss://wss.cookiescan.io`
- Genesis hash: `9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2`

The configuration is based on the current [Cookie Chain developer docs](https://docs.cookiechain.wtf/developer-guide) and [Nightly network-change docs](https://docs.nightly.app/docs/solana/solana/change_network/). Verify network details in Nightly before approving any future request.

## Next product decision

Before market trading can be implemented, decide the on-chain market protocol: deploy a purpose-built Anchor program or integrate an existing audited protocol that is confirmed to be deployed on Cookie Chain. That choice determines market creation, oracle/resolution rules, collateral custody, and transaction flows.

No program IDs, wallet secrets, private keys, or deployment configuration are included in this repository.
