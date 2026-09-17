# Public market terms

The initial registry is curated in Git at `lib/published-market-terms.ts`. Its history and content are publicly readable on GitHub and bundled with each frontend build. It requires no storage service or private credential. It is not a permissionless publication service, evidence registry, or production hosting decision.

After preparing a market draft, select **Download public market terms**. Preserve the exported record alongside the unsigned instructions: its market address corresponds to that draft's nonce. Preparing a new draft generates a new address and requires a new record. A record does not create a market or authorize its creation.

An operator publishes the exported JSON object as an entry in the `publishedMarketTerms` array and commits it to Git. Do not alter its question, source, rules, network, program, or market address. Publish before enabling deposits, and retain copies independently of the app. The array is initially empty because no real markets have been deployed; demo questions are not registry entries.

Market discovery and detail pages check the record's version, network genesis, program address, market address, and both immutable account hashes. Duplicate records, malformed terms, wrong networks/programs, or changed text fail verification. A missing record is reported explicitly and permits the existing manual hash-verification flow. The preparation endpoint independently rechecks supplied terms before any deposit simulation.

Verified records appear with their market in `/api/protocol?markets=true`. Verification failures appear as `termsError` on the affected account; other verified accounts remain discoverable. The detail page disables deposits for conflicting records while retaining withdrawal/redemption simulation. It displays verified readable rules and fills them into preparation. Hash verification establishes that the text matches what the creator committed; it does not establish the truth of a prediction or the independence of its resolver.

The deployment program address is part of every record. Records prepared for the development placeholder must be regenerated when the final address is chosen. Durable resolution evidence, automated publication, and production storage availability remain separate release work.
