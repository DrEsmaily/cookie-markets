const HIDDEN_LEGACY_MARKETS = new Set([
  "BRWymQcDgpUFNJpnwy7qAbCGtdaSj2DS4VkStZSt4N6H",
  "BJgYRF3gTxCWH2fSCJqkQFwSMwuSKvWHC5HQyo8UHSNt",
]);

export function hidesObsoletePosition(market: string) {
  return HIDDEN_LEGACY_MARKETS.has(market);
}
