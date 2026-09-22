# Public market terms

The bundled registry in `lib/published-market-terms.ts` provides versioned fallback records that are publicly readable on GitHub. Live deployments additionally publish verified records through `POST /api/protocol` into the persistent directory configured by `COOKIE_MARKETS_TERMS_DIR`.

After preparing a market draft, select **Download public market terms**. Preserve the exported record alongside the unsigned instructions: its market address corresponds to that draft's nonce. Preparing a new draft generates a new address and requires a new record. A record does not create a market or authorize its creation.

The API verifies Cookie Chain genesis, the executable program, protocol config, market identity, collateral, and both immutable hashes before accepting a record. Publication is atomic and an existing record cannot be silently overwritten. Operators should retain independent backups of the persistent volume and can add curated fallback records to Git when appropriate.

Market discovery and detail pages check the record's version, network genesis, program address, market address, and both immutable account hashes. Duplicate records, malformed terms, wrong networks/programs, or changed text fail verification. A missing record is reported explicitly and permits the existing manual hash-verification flow. The preparation endpoint independently rechecks supplied terms before any deposit simulation.

Verified records appear with their market in `/api/protocol?markets=true`. Verification failures appear as `termsError` on the affected account; other verified accounts remain discoverable. The detail page disables deposits for conflicting records while retaining withdrawal/redemption simulation. It displays verified readable rules and fills them into preparation. Hash verification establishes that the text matches what the creator committed; it does not establish the truth of a prediction or the independence of its resolver.

The deployment program address is part of every record. Records prepared for another program or network are invalid. Resolution evidence is stored alongside the live registry by the automatic resolver and should be backed up and monitored as operational production data.
