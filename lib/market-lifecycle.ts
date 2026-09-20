import type { VerifiedMarket } from "./protocol-accounts";

type LifecycleMarket = Pick<VerifiedMarket, "status" | "outcome" | "closesAt" | "resolveAfter">;

export type MarketLifecycle = {
  key: "open" | "closed" | "resolving" | "proposed" | "resolved" | "refunding";
  label: string;
  description: string;
  tradingOpen: boolean;
  claimable: boolean;
};

export function marketLifecycle(market: LifecycleMarket, now = Date.now()): MarketLifecycle {
  if (market.status === "resolved") {
    if (market.outcome === "invalid") return { key: "refunding", label: "Invalid · refunds available", description: "The result could not be verified. Every remaining YES or NO share can claim 0.5 COOK; no pool collateral is burned.", tradingOpen: false, claimable: true };
    return { key: "resolved", label: `Resolved ${market.outcome.toUpperCase()}`, description: `The final result is ${market.outcome.toUpperCase()}. Winning shares can now claim 1 COOK each.`, tradingOpen: false, claimable: true };
  }
  if (market.status === "proposed") return { key: "proposed", label: "Result proposed", description: "Price evidence and a proposed result are on-chain. Claims unlock after the verification window finishes without a successful challenge.", tradingOpen: false, claimable: false };
  if (market.status === "locked") return { key: "resolving", label: "Resolving", description: "Trading is closed. The resolver is checking the completed UTC price observation and publishing evidence.", tradingOpen: false, claimable: false };
  if (market.status === "open" && Number(market.closesAt) * 1_000 <= now) return { key: "closed", label: "Closed · awaiting result", description: "The exact UTC deadline passed. Trading is disabled while the market moves into resolution.", tradingOpen: false, claimable: false };
  return { key: "open", label: "Open", description: "Trading is live until the exact UTC deadline shown on this market.", tradingOpen: true, claimable: false };
}

export function formatUtcTimestamp(unixSeconds: string) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(Number(unixSeconds) * 1_000));
}

export function formatMarketText(value: string) {
  return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z/g, (timestamp) => new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "UTC",
  }).format(new Date(timestamp)).replace(",", " ·") + " UTC");
}
