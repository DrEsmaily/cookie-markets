export type MarketOutcome = "yes" | "no";

export type PredictionMarket = {
  id: string;
  question: string;
  category: "Crypto" | "Culture" | "Sports";
  closesAt: string;
  yesPrice: number;
  volumeCook: number;
  status: "open" | "resolved";
};

export const featuredMarkets: PredictionMarket[] = [
  { id: "cook-above-1", question: "Will COOK close above 1.00 by month end?", category: "Crypto", closesAt: "Sep 30", yesPrice: 64, volumeCook: 48200, status: "open" },
  { id: "cookie-chain-programs", question: "Will Cookie Chain reach 100 deployed programs this quarter?", category: "Crypto", closesAt: "Sep 30", yesPrice: 41, volumeCook: 17600, status: "open" },
  { id: "meme-of-week", question: "Will the Cookie meme of the week exceed 1M views?", category: "Culture", closesAt: "Sep 22", yesPrice: 72, volumeCook: 9300, status: "open" }
];

export function formatCook(amount: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}
