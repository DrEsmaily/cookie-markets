import { COOKIE_CHAIN } from "./cookie-chain-config";
import { COOKIE_MARKETS_PROGRAM_ID } from "./cookie-markets-program";
import { hashHex, hashMarketTerms, type MarketTerms } from "./market-terms";

export type MarketTermsRecord = MarketTerms & {
  version: 1;
  genesisHash: string;
  program: string;
  market: string;
};

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
