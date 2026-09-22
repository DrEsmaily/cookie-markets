export const HIDDEN_LEGACY_MARKETS = [
  "BRWymQcDgpUFNJpnwy7qAbCGtdaSj2DS4VkStZSt4N6H",
  "BJgYRF3gTxCWH2fSCJqkQFwSMwuSKvWHC5HQyo8UHSNt",
  "8dS6SdzPLtoKfL88CB3zEfnVRea68baQ9rYWzBnDWSEb",
] as const;

const hiddenLegacyMarkets = new Set<string>(HIDDEN_LEGACY_MARKETS);

export function hidesObsoletePosition(market: string) {
  return hiddenLegacyMarkets.has(market);
}
