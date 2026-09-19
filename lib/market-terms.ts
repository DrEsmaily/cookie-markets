export type MarketTerms = { question: string; resolutionSource: string; resolutionRules: string };

export type PriceMarketSpec = {
  asset: "BTC" | "ETH";
  direction?: "above" | "under";
  targetUsd: string;
  settlesAt: string;
  source: string;
};

export type PriceObservation = {
  asset: "BTC" | "ETH"; source: string; priceUsd: string; observedAt: string;
};

export function coinbasePriceMarketSpec(asset: "BTC" | "ETH", targetUsd: string, settlesAt: string, direction: "above" | "under" = "above"): PriceMarketSpec {
  const spec = { asset, direction, targetUsd, settlesAt, source: `Coinbase Exchange ${asset}-USD 60-second candle CLOSE for [settlement-60s, settlement); observation timestamp denotes bucket end, not last-trade time` };
  createPriceMarketTerms(spec);
  if (Date.parse(settlesAt) % 60_000 !== 0) throw new RangeError("Coinbase candle markets must settle at an exact UTC minute.");
  return spec;
}

export function parseCoinbasePriceEvidence(spec: PriceMarketSpec, originalResponse: string): PriceObservation[] {
  const expected = coinbasePriceMarketSpec(spec.asset, spec.targetUsd, spec.settlesAt, spec.direction);
  if (spec.source !== expected.source) throw new RangeError("Market does not use the approved Coinbase candle methodology.");
  if (new TextEncoder().encode(originalResponse).length > 65_536 || !/^[\[\],\s\d.eE+\-]+$/.test(originalResponse)) throw new RangeError("Invalid Coinbase candle response.");
  const rows: unknown = JSON.parse(originalResponse.replace(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (number) => JSON.stringify(number)));
  if (!Array.isArray(rows) || rows.length > 300) throw new RangeError("Invalid Coinbase candle response.");
  const bucketStart = BigInt(Date.parse(spec.settlesAt) / 1000) - BigInt(60);
  const observations: PriceObservation[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 6 || row.some((value) => typeof value !== "string") || !/^\d+$/.test(row[0])) throw new RangeError("Invalid Coinbase candle row.");
    if (BigInt(row[0]) !== bucketStart) continue;
    for (const index of [1, 2, 3, 4]) priceUsdUnits(row[index]);
    const low = priceUsdUnits(row[1]);
    const high = priceUsdUnits(row[2]);
    if (low > high || [3, 4].some((index) => priceUsdUnits(row[index]) < low || priceUsdUnits(row[index]) > high)) throw new RangeError("Inconsistent candle price bounds.");
    observations.push({ asset: spec.asset, source: spec.source, priceUsd: row[4], observedAt: spec.settlesAt });
  }
  return observations;
}

export async function collectCoinbasePriceEvidence(spec: PriceMarketSpec, now = Date.now()) {
  const expected = coinbasePriceMarketSpec(spec.asset, spec.targetUsd, spec.settlesAt, spec.direction);
  if (spec.source !== expected.source) throw new RangeError("Market does not use the approved Coinbase candle methodology.");
  const settlement = Date.parse(spec.settlesAt);
  if (!Number.isFinite(now) || now < settlement + 60_000 || now > settlement + 86_400_000) throw new RangeError("Collect evidence between one minute and 24 hours after settlement.");
  const url = new URL(`https://api.exchange.coinbase.com/products/${spec.asset}-USD/candles`);
  url.searchParams.set("granularity", "60");
  url.searchParams.set("start", new Date(settlement - 60_000).toISOString());
  url.searchParams.set("end", spec.settlesAt);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Coinbase evidence request failed (${response.status}). Retry later; do not substitute another source.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Coinbase evidence response is empty.");
  const decoder = new TextDecoder();
  let size = 0;
  let originalResponse = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new RangeError("Coinbase evidence response is too large."); }
      originalResponse += decoder.decode(value, { stream: true });
    }
    originalResponse += decoder.decode();
  } finally { reader.releaseLock(); }
  const observations = parseCoinbasePriceEvidence(spec, originalResponse);
  const collectedAt = new Date().toISOString();
  if (Date.parse(collectedAt) > settlement + 86_400_000) throw new RangeError("Evidence collection deadline passed during retrieval.");
  return { url: url.toString(), collectedAt, originalResponse, observations };
}

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
  const direction = spec.direction ?? "above";
  if (direction !== "above" && direction !== "under") throw new RangeError("Price direction must be above or under.");
  const comparison = direction === "above" ? `price > ${target} USD` : `price < ${target} USD`;
  return {
    question: `Will ${spec.asset}/USD be ${direction} $${target} at ${spec.settlesAt}?`,
    resolutionSource: source,
    resolutionRules: `Use the latest ${spec.asset}/USD observation from the named dataset at or before ${spec.settlesAt}, no more than 60 seconds old. YES if ${comparison}; otherwise NO. Use decimal precision up to eight places without rounding. Publish the observation timestamp, USD price, dataset identity, and original response as evidence within 24 hours after settlement. INVALID if no qualifying observation is available, the dataset is ambiguous, or timely verifiable evidence is unavailable. Never substitute another source or use a price observed after settlement. Trading closes at the settlement time. The named protocol resolver proposes the result; the protocol challenge period applies.`,
  };
}

export function evaluatePriceMarketObservation(spec: PriceMarketSpec, observation: PriceObservation) {
  createPriceMarketTerms(spec);
  const observedAt = Date.parse(observation.observedAt);
  const settlesAt = Date.parse(spec.settlesAt);
  if (observation.asset !== spec.asset || observation.source !== spec.source.trim()
    || !Number.isFinite(observedAt) || observedAt > settlesAt || settlesAt - observedAt > 60_000) {
    throw new RangeError("Price evidence does not match the market source, asset, or timestamp window.");
  }
  const price = priceUsdUnits(observation.priceUsd);
  const target = priceUsdUnits(spec.targetUsd);
  return (spec.direction ?? "above") === "above" ? (price > target ? "yes" as const : "no" as const) : (price < target ? "yes" as const : "no" as const);
}

export function selectPriceMarketEvidence(spec: PriceMarketSpec, observations: readonly PriceObservation[], publishedAt: string) {
  createPriceMarketTerms(spec);
  const publication = Date.parse(publishedAt);
  const settlement = Date.parse(spec.settlesAt);
  if (!Number.isFinite(publication) || new Date(publication).toISOString() !== publishedAt || publication < settlement) {
    throw new RangeError("Evidence publication must have a canonical UTC timestamp at or after settlement.");
  }
  if (observations.length > 10_000) throw new RangeError("Too many price observations.");
  let selected: PriceObservation | undefined;
  for (const observation of observations) {
    const timestamp = Date.parse(observation.observedAt);
    if (observation.asset !== spec.asset || observation.source !== spec.source.trim()
      || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== observation.observedAt) {
      throw new RangeError("Evidence contains a mismatched dataset or noncanonical observation timestamp.");
    }
    priceUsdUnits(observation.priceUsd);
    if (timestamp > settlement || settlement - timestamp > 60_000) continue;
    if (!selected || timestamp > Date.parse(selected.observedAt)) selected = observation;
  }
  if (publication > settlement + 86_400_000) return { outcome: "invalid" as const, reason: "Evidence publication deadline missed." };
  if (!selected) return { outcome: "invalid" as const, reason: "No observation within the settlement window." };
  const price = priceUsdUnits(selected.priceUsd);
  if (observations.some((observation) => observation.observedAt === selected.observedAt && priceUsdUnits(observation.priceUsd) !== price)) {
    return { outcome: "invalid" as const, reason: "Conflicting prices at the latest observation timestamp." };
  }
  return { outcome: evaluatePriceMarketObservation(spec, selected), observation: { ...selected } };
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
