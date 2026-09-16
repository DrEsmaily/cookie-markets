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
};

export const featuredMarkets: PredictionMarket[] = [
  { id: "cook-above-1", question: "Will COOK close above 1.00 by month end?", description: "A binary market on the month-end COOK reference price.", category: "Crypto", closesAt: "Sep 30", resolvesAt: "Oct 1, 00:15 UTC", resolutionSource: "Designated COOK/USD price feed", resolutionRules: "Resolves Yes when the designated feed reports a price strictly above 1.00 USD at 23:59 UTC on September 30. Otherwise resolves No.", yesPrice: 64, volumeCook: 48200, status: "open" },
  { id: "cookie-chain-programs", question: "Will Cookie Chain reach 100 deployed programs this quarter?", description: "Tracks verified executable programs deployed to Cookie Chain.", category: "Crypto", closesAt: "Sep 30", resolvesAt: "Oct 1, 12:00 UTC", resolutionSource: "Cookiescan program index", resolutionRules: "Resolves Yes if Cookiescan lists at least 100 unique executable programs before the quarter ends. Upgradeable program-data accounts are not counted separately.", yesPrice: 41, volumeCook: 17600, status: "open" },
  { id: "meme-of-week", question: "Will the Cookie meme of the week exceed 1M views?", description: "A culture market based on the selected post's public view count.", category: "Culture", closesAt: "Sep 22", resolvesAt: "Sep 23, 12:00 UTC", resolutionSource: "Public post analytics", resolutionRules: "Resolves Yes if the market-linked post displays at least 1,000,000 views at the observation time. Deleted or unavailable posts resolve Invalid.", yesPrice: 72, volumeCook: 9300, status: "open" }
];

export function getMarket(id: string) {
  return featuredMarkets.find((market) => market.id === id);
}

export function formatCook(amount: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}
