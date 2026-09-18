export type MarketTerms = { question: string; resolutionSource: string; resolutionRules: string };

export type PriceMarketSpec = {
  asset: "BTC" | "ETH";
  targetUsd: string;
  settlesAt: string;
  source: string;
};

export function priceUsdUnits(value: string): bigint {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,8})?$/.test(value)) throw new RangeError("USD price must be a positive decimal with at most eight fractional digits.");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * BigInt(100_000_000) + BigInt(fraction.padEnd(8, "0"));
  if (units === BigInt(0)) throw new RangeError("USD price must be positive.");
  return units;
}

export function createPriceMarketTerms(spec: PriceMarketSpec): MarketTerms {
  if (spec.asset !== "BTC" && spec.asset !== "ETH") throw new RangeError("Only BTC and ETH price markets are supported.");
  priceUsdUnits(spec.targetUsd);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(spec.settlesAt)
    || !Number.isFinite(Date.parse(spec.settlesAt)) || new Date(spec.settlesAt).toISOString() !== spec.settlesAt) throw new RangeError("Settlement time must be an exact UTC second.");
  const source = spec.source.trim();
  if (!source || /[\r\n]/.test(source) || new TextEncoder().encode(source).length > 256) throw new RangeError("Specify an exact USD price dataset and methodology on one line.");
  const target = spec.targetUsd.includes(".") ? spec.targetUsd.replace(/0+$/, "").replace(/\.$/, "") : spec.targetUsd;
  return {
    question: `Will ${spec.asset}/USD be at least $${target} at ${spec.settlesAt}?`,
    resolutionSource: source,
    resolutionRules: `Use the latest ${spec.asset}/USD observation from the named dataset at or before ${spec.settlesAt}, no more than 60 seconds old. YES if price >= ${target} USD; otherwise NO. Use decimal precision up to eight places without rounding. Publish the observation timestamp, USD price, dataset identity, and original response as evidence within 24 hours after settlement. INVALID if no qualifying observation is available, the dataset is ambiguous, or timely verifiable evidence is unavailable. Never substitute another source or use a price observed after settlement. Trading closes at the settlement time. The named protocol resolver proposes the result; the protocol challenge period applies.`,
  };
}

export function evaluatePriceMarketObservation(spec: PriceMarketSpec, observation: {
  asset: "BTC" | "ETH"; source: string; priceUsd: string; observedAt: string;
}) {
  createPriceMarketTerms(spec);
  const observedAt = Date.parse(observation.observedAt);
  const settlesAt = Date.parse(spec.settlesAt);
  if (observation.asset !== spec.asset || observation.source !== spec.source.trim()
    || !Number.isFinite(observedAt) || observedAt > settlesAt || settlesAt - observedAt > 60_000) {
    throw new RangeError("Price evidence does not match the market source, asset, or timestamp window.");
  }
  return priceUsdUnits(observation.priceUsd) >= priceUsdUnits(spec.targetUsd) ? "yes" as const : "no" as const;
}

export async function hashMarketTerms(terms: MarketTerms) {
  const normalized = {
    question: terms.question.trim(),
    resolutionSource: terms.resolutionSource.trim(),
    resolutionRules: terms.resolutionRules.trim(),
  };
  const encoder = new TextEncoder();
  if (!normalized.question || encoder.encode(normalized.question).length > 280) throw new Error("Question must contain 1–280 bytes.");
  if (!normalized.resolutionSource || /[\r\n]/.test(normalized.resolutionSource) || encoder.encode(normalized.resolutionSource).length > 256) throw new Error("Resolution source must contain 1–256 bytes on a single line.");
  if (!normalized.resolutionRules || encoder.encode(normalized.resolutionRules).length > 1024) throw new Error("Rules must contain 1–1024 bytes.");
  const questionHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(normalized.question)));
  const rulesHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${normalized.resolutionSource}\n${normalized.resolutionRules}`)));
  return { ...normalized, questionHash, rulesHash };
}

export function hashHex(hash: Uint8Array): string {
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
