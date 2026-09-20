export type MarketOutcome = "yes" | "no";

export type PredictionMarket = {
  id: string;
  question: string;
  description: string;
  category: "Crypto" | "Culture" | "Sports";
  closesAt: string;
  resolvesAt: string;
  resolutionSource: string;
  resolutionRules: string;
  yesPrice: number;
  volumeCook: number;
  status: "open" | "resolved";
  outcome: MarketOutcome;
};

export const featuredMarkets: PredictionMarket[] = [
  { id: "btc-resolved-example", question: "Was BTC above $82,000 at settlement?", description: "Example of a completed BTC price market.", category: "Crypto", closesAt: "19 Sep 2026 · 16:46 UTC", resolvesAt: "19 Sep 2026 · 16:46 UTC", resolutionSource: "Coinbase Exchange BTC-USD", resolutionRules: "Resolved No from the preceding completed Coinbase one-minute candle.", yesPrice: 20, volumeCook: 1001, status: "resolved", outcome: "no" },
  { id: "eth-resolved-example", question: "Was ETH under $4,500 at settlement?", description: "Example of a completed ETH price market.", category: "Crypto", closesAt: "19 Sep 2026 · 18:00 UTC", resolvesAt: "19 Sep 2026 · 18:00 UTC", resolutionSource: "Coinbase Exchange ETH-USD", resolutionRules: "Resolved Yes from the preceding completed Coinbase one-minute candle.", yesPrice: 73, volumeCook: 820, status: "resolved", outcome: "yes" }
];

export function getMarket(id: string) {
  return featuredMarkets.find((market) => market.id === id);
}

export function formatCook(amount: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}
