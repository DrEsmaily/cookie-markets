# Release checklist

The repository is not a production release. A green build proves compilation and the tested cases, not safety with real money.

## Automated verification

- Rust state, payout, and serialized-layout tests.
- Client discriminator, argument, account-order, signer, integer-boundary, and decimal-precision tests.
- Strict account decoding: owner, size, discriminator, PDA/bump, child custody addresses, config limits, and market state.
- RPC genesis, executable program, and approved initialized SPL mint verification.
- Disposable-validator initialization, custody, YES/NO/Invalid settlement, challenges, deadlines, and negative cases.
- Frontend-generated associated-account setup, complete-set deposit/withdrawal, and native wrapping/unwrapping on a local validator.
- Frontend lint, type check, and production build.

Most rejected-instruction cases use signed simulation; the atomic rollback test submits and confirms a deliberately failing transaction. Successful lifecycle/custody cases are also submitted and confirmed on the disposable validator. No test uses a real wallet or Cookie Chain funds.

## Product work still required

1. Implement both selected execution venues: [escrowed order book, then funded AMM pools](trading-venues.md). Reference pricing arithmetic is tested; custody, matching, cancellation, liquidity, prices, and fees still require execution implementation and validator tests. Complete-set minting alone is not prediction-market trading.
2. Use the initial [Git-backed public terms registry](market-terms-publication.md) for curated question/rules publication. Select production persistence and availability guarantees, and add durable resolution evidence and automated publication. Hash mismatches must keep deposits disabled; local exports alone are not publication.
3. Complete transaction review, wallet account/network-change handling, signing, submission, expiry, confirmation, and recovery flows. Current forms stop at unsigned instructions or simulation.
4. Specify supported creator/resolver policies, challenge evidence handling, and emergency/upgrade governance. Resolver trust is explicit; no independent oracle or working multisig is claimed.
5. Add service rate limits, request-size enforcement at the hosting boundary, RPC timeouts/monitoring, and HTTP-level integration tests for preparation failures.

## Security gates

- Obtain independent contract review, including malicious account substitution, arithmetic limits, token authority/delegate behavior, custody solvency, and resolver control.
- Review dependency audit findings before public hosting. Current legacy dependencies have outstanding advisories; they are not silently ignored or fixed with forced breaking upgrades.
- Verify wrapped COOK against the canonical registry and initialized native mint on the target network immediately before deployment.
- Validate final binaries, exact deployed address, upgrade authority, protocol config, and reproducible build provenance.
- Run a controlled end-to-end deployment without real user deposits before allowing funded markets.

## User decisions needed before any real deployment

Only public addresses and approvals belong in conversation. Do not share seed phrases, wallet exports, or private keys.

- Explicit deployment approval and the intended testing/live environment. Existing instructions prohibit deployment.
- Public program address, upgrade/governance authority, admin, and resolver addresses, with the intended separation of control and multisig threshold if applicable.
- Approved live fees, liquidity funding, and challenge duration. Ask fills collect the snapshotted configured fee; AMM fees and pool custody remain unimplemented.
- Hosting/public metadata persistence choice, operating cost approval, and custody/risk acceptance.

Any deployment signature, wallet transaction, secret entry, or credential grant remains a user-controlled step. Nothing in this checklist authorizes it automatically.
