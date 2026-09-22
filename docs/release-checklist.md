# Production release checklist

CookieMarkets is live with real COOK. This checklist distinguishes implemented controls from additional work required for a hardened financial product. A green build is evidence of tested behavior, not proof that no defect exists.

## Implemented and continuously tested

- Rust state, fee, AMM quote, payout, cost-basis refund, and serialized-layout tests.
- Client discriminator, account-order, signer, integer-boundary, and decimal-precision tests.
- Strict owner, size, discriminator, PDA, bump, mint, authority, and protocol-config decoding.
- Disposable-validator lifecycle, custody, AMM trade, YES/NO settlement, Invalid refunds, challenges, deadlines, and negative cases.
- Native wrapping/unwrapping and eligible token-account cleanup flows.
- Frontend lint, type checking, production build, and HTTP preparation tests.
- On-chain split LP/platform fees, transferable administration, and configurable owner recipient.
- Persistent market terms and settlement evidence in the Docker deployment.
- Automatic locking, evidence collection, proposal, and finalization through the resolver worker.

## Operational release checks

- Confirm the deployed program address and executable status.
- Confirm admin, resolver, collateral mint, LP fee, owner fee, owner recipient, and challenge period directly from `ProtocolConfig`.
- Verify the resolver has sufficient native COOK for transaction fees.
- Verify terms/evidence storage is persistent, writable, monitored, and backed up.
- Confirm the resolver restarts automatically and alerts on repeated failures.
- Exercise create, buy YES, buy NO, valid settlement, Invalid refund, creator claim, user claim, unwrap, and account cleanup with limited funds.
- Verify desktop extension and Nightly mobile in-app-browser signing.
- Confirm HTTPS, reverse-proxy limits, RPC timeouts, application health checks, and log rotation.

## Security gates still required

- Independent contract and economic review, including account substitution, arithmetic limits, authority handling, vault solvency, fee settlement, and Invalid-refund reconciliation.
- Multisig or governed protocol administration and resolver policy.
- Reproducible deployed-binary provenance and documented upgrade-authority custody.
- Dependency advisory review without forced or untested breaking upgrades.
- Resolver redundancy, evidence replication, and incident-response procedures.
- Load, abuse, accessibility, and cross-device testing at production traffic levels.

## Secret handling

Only public addresses belong in issues, documentation, or support conversations. Never publish seed phrases, private keys, wallet exports, access tokens, resolver keypairs, or VPS passwords. Deployment and upgrade signatures remain user-controlled actions.
