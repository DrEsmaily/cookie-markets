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

Rejected-instruction cases use signed simulation; successful lifecycle/custody cases are submitted and confirmed on the disposable validator. No test uses a real wallet or Cookie Chain funds.

## Product work still required

1. Select and implement a single-side execution venue (order book/matching or an AMM), then test matching, cancellation, liquidity, prices, and fees. Complete-set minting alone is not prediction-market trading.
2. Persist public question/rules text and evidence in a durable, independently readable registry. Hash mismatches must keep deposits disabled. Local drafts and manually supplied terms are not durable publication.
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
- Execution venue and liquidity model; approved fees and challenge duration. Configured fee fields do not currently collect trading fees.
- Hosting/public metadata persistence choice, operating cost approval, and custody/risk acceptance.

Any deployment signature, wallet transaction, secret entry, or credential grant remains a user-controlled step. Nothing in this checklist authorizes it automatically.
