export const PROTOCOL_LIMITS = {
  maxQuestionBytes: 280,
  maxResolutionRulesBytes: 1_024,
  tradingFeeBps: 100,
  creatorFeeBps: 25,
  resolutionChallengeSeconds: 86_400
} as const;

export type MarketState = "draft" | "open" | "locked" | "proposed" | "resolved" | "invalid";
export type Resolution = "yes" | "no" | "invalid";

export type OnchainMarket = {
  authority: string;
  collateralMint: string;
  questionHash: string;
  rulesHash: string;
  closesAt: number;
  resolveAfter: number;
  state: MarketState;
  proposedResolution?: Resolution;
  finalResolution?: Resolution;
};

export function canTrade(market: OnchainMarket, unixTime: number) {
  return market.state === "open" && unixTime < market.closesAt;
}

export function canProposeResolution(market: OnchainMarket, unixTime: number) {
  return market.state === "locked" && unixTime >= market.resolveAfter;
}
