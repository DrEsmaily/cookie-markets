export const PROTOCOL_LIMITS = {
  maxQuestionBytes: 280,
  maxResolutionRulesBytes: 1_024,
  tradingFeeBps: 100,
  creatorFeeBps: 25,
  resolutionChallengeSeconds: 86_400
} as const;

export type MarketState = "draft" | "open" | "locked" | "proposed" | "resolved" | "invalid";
export type Resolution = "yes" | "no" | "invalid";

export type MarketDraft = {
  question: string;
  resolutionSource: string;
  resolutionRules: string;
  closesAt: string;
  resolvesAt: string;
};

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

export function validateMarketDraft(draft: MarketDraft) {
  const errors: Partial<Record<keyof MarketDraft, string>> = {};
  const questionBytes = new TextEncoder().encode(draft.question.trim()).length;
  const rulesBytes = new TextEncoder().encode(draft.resolutionRules.trim()).length;
  const closesAt = Date.parse(draft.closesAt);
  const resolvesAt = Date.parse(draft.resolvesAt);

  if (questionBytes < 10) errors.question = "Write a specific question of at least 10 bytes.";
  else if (questionBytes > PROTOCOL_LIMITS.maxQuestionBytes) errors.question = `Question must fit within ${PROTOCOL_LIMITS.maxQuestionBytes} bytes.`;
  if (!draft.resolutionSource.trim()) errors.resolutionSource = "Name the exact public source used for settlement.";
  if (rulesBytes < 30) errors.resolutionRules = "Describe objective Yes, No, and Invalid conditions.";
  else if (rulesBytes > PROTOCOL_LIMITS.maxResolutionRulesBytes) errors.resolutionRules = `Rules must fit within ${PROTOCOL_LIMITS.maxResolutionRulesBytes} bytes.`;
  if (!Number.isFinite(closesAt)) errors.closesAt = "Choose when trading closes.";
  if (!Number.isFinite(resolvesAt)) errors.resolvesAt = "Choose the earliest resolution time.";
  else if (Number.isFinite(closesAt) && resolvesAt <= closesAt) errors.resolvesAt = "Resolution must happen after trading closes.";

  return errors;
}
