# CookieMarkets

A prediction-market application for Cookie Chain, with a Next.js frontend and an Anchor on-chain program.

## Included today

- Next.js App Router + TypeScript frontend.
- Cookie Chain RPC, WebSocket, explorer and verified genesis hash configuration.
- Read-only live RPC health and slot reporting.
- Nightly Wallet Standard connection that only requests account access; it creates no transactions and requests no signatures.
- A warning when Nightly reports a genesis hash that does not match Cookie Chain.
- Read-only native COOK balance display for the connected address.
- Silent reconnection for previously authorized wallets, periodic balance refresh, and explicit disconnect.
- A read-only wallet panel with recent Cookie Chain transaction signatures and status.
- Direct Cookiescan links and local timestamps for wallet activity.
- Local domain models and a responsive market-discovery interface.
- Market detail pages with explicit resolution sources and rules.
- A local market-draft form with protocol-aware validation and no transaction flow.
- A conservative [protocol design](docs/protocol-design.md).
- An Anchor program covering market creation, collateralized shares, resolution challenges, finalization, and redemption.
- On-chain schedule, hash, fee, signer, PDA, and state-transition validation.
- Program-level enforcement of the single approved collateral mint.
- Read-only Cookie Chain protocol discovery with config owner and discriminator verification.
- Dynamic wrapped COOK discovery through Cookiescan's canonical asset registry.
- Frontend PDA derivation and unsigned instruction builders for every current protocol instruction.

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

## On-chain program

The contract lives in `programs/cookie_markets`. Its market PDA controls a collateral vault and the YES/NO share mints. Splitting one collateral unit produces one unit of each share; merging equal shares returns the collateral while the market remains unresolved. After closing, the designated resolver proposes an evidence-backed outcome, anyone can challenge during the configured window, and finalized winning shares can redeem collateral.

Run its unit tests with:

```bash
cargo test --workspace
```

GitHub Actions runs the Rust tests, formatting check, frontend lint, and production build for every push and pull request.

The checked-in program ID is a deterministic development placeholder, not a deployed address. Building and testing this milestone does not require a wallet, keypair, signature, or private credential.

The frontend builders in `lib/cookie-markets-program.ts` prepare deterministic addresses and transaction instructions, but they deliberately do not request wallet signatures or submit transactions.

The create-market form can validate a draft, hash its public rules, derive all market accounts, and display the resulting unsigned instruction data. It stops before transaction assembly, signing, or submission.

## Next protocol milestone

Add full integration tests against a local validator and connect the frontend transaction builders. Deployment still waits for confirmation of the canonical wrapped COOK mint on Cookie Chain.

No wallet secrets, private keys, or deployment configuration are included in this repository.
