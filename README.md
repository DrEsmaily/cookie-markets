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
- Read-only market discovery at `/api/protocol?markets=true`, with account size, discriminator, and market PDA verification. Integer balances and timestamps are returned as decimal strings to preserve precision. Homepage examples are explicitly labeled as demos.
- Dynamic wrapped COOK discovery through Cookiescan's canonical asset registry.
- Registry outages are reported separately from RPC health. Unsigned preparation stays disabled when protocol or network verification fails.
- Frontend PDA derivation and unsigned instruction builders for every current protocol instruction.
- Verified live-market discovery and dynamic account detail pages, separate from demo prices. Unknown question text is never presented as verified.
- Exact decimal/base-unit parsing without floating-point rounding.
- Complete-set transaction assembly with idempotent associated-account setup and explicit native wrapping.
- Unsigned deposit, merge, and redemption simulation at `POST /api/positions/prepare`. Deposit terms must match the immutable on-chain hashes. No signing or broadcasting endpoint exists.
- A curated [public market terms registry](docs/market-terms-publication.md) stored in Git, with draft JSON export and verification of published text against the exact market, network, program, and immutable hashes.

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

GitHub Actions runs the Rust tests, formatting check, frontend instruction/account tests (`npm test`), lint, and production build for every push and pull request.

A separate Linux job uses Agave 4.2.2 to build the real SBF deploy target with locked dependencies. Successful runs publish only `cookie_markets.so` as the `cookie-markets-sbf` artifact, not keypairs. This job does not deploy to Cookie Chain or use a real funded wallet. A passing SBF build is necessary but does not establish production readiness; transaction-level tests and security review are still required.

After compilation, CI loads the program into a disposable local validator and runs `tests/program-transactions.cjs`. The harness uses generated in-memory test accounts and local airdrops, never a user wallet or Cookie Chain funds. It covers initialization, outcome mint/vault creation, signer and transition checks, collateral deposits, partial/full merges, YES/NO settlement, public challenges, challenged Invalid settlement, exact half refunds, losing shares, and repeated-redemption rejection. It also submits a deliberately failing merge after its first token burn and verifies that the entire transaction rolls back. The harness executes the frontend complete-set builders against the contract and tests native wrapping/unwrapping. These are integration tests, not an independent security audit.

The checked-in program ID is a deterministic development placeholder, not a deployed address. Building and testing this milestone does not require a wallet, keypair, signature, or private credential.

Invalid-market redemptions require an even number of share base units so half-value payouts are exact. Odd amounts are rejected before burning shares; a single leftover base unit cannot be redeemed alone. Contract tests also verify the serialized market layout used by discovery.

The frontend builders in `lib/cookie-markets-program.ts` prepare deterministic addresses and transaction instructions, but they deliberately do not request wallet signatures or submit transactions.

The create-market form validates a draft, hashes its public rules, derives all market accounts, and displays unsigned instruction data. Sources must be single-line text to keep the source/rules commitment unambiguous. It stops before signing or submission.

Live account pages allow simulation of unsigned position transactions. Nightly must report the exact Cookie Chain genesis hash; the backend separately verifies RPC genesis, executable program, config layout/PDA, collateral mint, and market custody PDAs. Simulations do not change balances. Withdrawals/redemptions return wrapped collateral; native unwrapping is always a separate explicit action. Network-fee estimates exclude account-creation rent.

## Next protocol milestone

See [release checklist](docs/release-checklist.md). Single-side purchases, executable price quotes, and liquidity are not implemented: complete-set minting is not an exchange. A matching/liquidity mechanism, durable public market/evidence metadata, independent security review, and explicit deployment approval remain necessary before calling this a live prediction-market product.

No wallet secrets, private keys, or deployment configuration are included in this repository.
