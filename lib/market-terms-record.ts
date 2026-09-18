import { COOKIE_CHAIN } from "./cookie-chain-config";
import { COOKIE_MARKETS_PROGRAM_ID } from "./cookie-markets-program";
import { hashHex, hashMarketTerms, createPriceMarketTerms, selectPriceMarketEvidence, type MarketTerms, type PriceMarketSpec, type PriceObservation } from "./market-terms";
import { PublicKey } from "@solana/web3.js";

export type MarketTermsRecord = MarketTerms & {
  version: 1;
  genesisHash: string;
  program: string;
  market: string;
};

export async function createPriceEvidenceRecord(input: {
  market: { address: string; questionHash: string; rulesHash: string };
  spec: PriceMarketSpec;
  observations: readonly PriceObservation[];
  publishedAt: string;
  originalResponse: string;
}) {
  if (new PublicKey(input.market.address).toBase58() !== input.market.address) throw new Error("Invalid market address.");
  const terms = createPriceMarketTerms(input.spec);
  const termsRecord = await createMarketTermsRecord(input.market.address, terms);
  await verifyPublishedMarketTerms([termsRecord], input.market);
  const responseBytes = new TextEncoder().encode(input.originalResponse);
  if (!input.originalResponse.trim() || responseBytes.length > 1_048_576) throw new RangeError("Original evidence response must contain 1–1048576 bytes.");
  const decision = selectPriceMarketEvidence(input.spec, input.observations, input.publishedAt);
  const record = {
    version: 1 as const,
    genesisHash: termsRecord.genesisHash,
    program: termsRecord.program,
    market: termsRecord.market,
    questionHash: input.market.questionHash,
    rulesHash: input.market.rulesHash,
    publishedAt: input.publishedAt,
    spec: { ...input.spec, source: input.spec.source.trim() },
    observations: input.observations.map((observation) => ({ ...observation })),
    decision,
    originalResponse: input.originalResponse,
    originalResponseHash: hashHex(new Uint8Array(await crypto.subtle.digest("SHA-256", responseBytes))),
  };
  const serialized = JSON.stringify(record);
  const evidenceHash = hashHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized))));
  return { record, serialized, evidenceHash };
}

export async function createMarketTermsRecord(market: string, terms: MarketTerms): Promise<MarketTermsRecord> {
  const normalized = await hashMarketTerms(terms);
  return {
    version: 1,
    genesisHash: COOKIE_CHAIN.genesisHash,
    program: COOKIE_MARKETS_PROGRAM_ID.toBase58(),
    market,
    question: normalized.question,
    resolutionSource: normalized.resolutionSource,
    resolutionRules: normalized.resolutionRules,
  };
}

export async function verifyPublishedMarketTerms(
  records: readonly unknown[],
  market: { address: string; questionHash: string; rulesHash: string },
): Promise<MarketTermsRecord | undefined> {
  const matches = records.filter((record) => typeof record === "object" && record !== null && "market" in record && record.market === market.address);
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new Error("Multiple published terms records exist for this market.");
  const record = matches[0] as Record<string, unknown>;
  if (record.version !== 1 || record.genesisHash !== COOKIE_CHAIN.genesisHash || record.program !== COOKIE_MARKETS_PROGRAM_ID.toBase58()) {
    throw new Error("Published terms belong to an unsupported version, network, or program.");
  }
  if (typeof record.question !== "string" || typeof record.resolutionSource !== "string" || typeof record.resolutionRules !== "string") {
    throw new Error("Published market terms are incomplete.");
  }
  const terms = await hashMarketTerms({ question: record.question, resolutionSource: record.resolutionSource, resolutionRules: record.resolutionRules });
  if (hashHex(terms.questionHash) !== market.questionHash || hashHex(terms.rulesHash) !== market.rulesHash) {
    throw new Error("Published terms do not match the immutable on-chain hashes.");
  }
  return createMarketTermsRecord(market.address, terms);
}
