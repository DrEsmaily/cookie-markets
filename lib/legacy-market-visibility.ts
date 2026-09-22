const HIDDEN_LEGACY_MARKETS = new Set([
  "BRWymQcDgpUFNJpnwy7qAbCGtdaSj2DS4VkStZSt4N6H",
  "BJgYRF3gTxCWH2fSCJqkQFwSMwuSKvWHC5HQyo8UHSNt",
  "8dS6SdzPLtoKfL88CB3zEfnVRea68baQ9rYWzBnDWSEb",
]);

export function hidesObsoletePosition(market: string) {
  return HIDDEN_LEGACY_MARKETS.has(market);
}
