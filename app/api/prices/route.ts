import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [btc, eth] = await Promise.all([readPrice("BTC"), readPrice("ETH")]);
    return NextResponse.json({ BTC: btc, ETH: eth, source: "Coinbase Exchange", updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live prices are unavailable." }, { status: 503 });
  }
}

async function readPrice(asset: "BTC" | "ETH") {
  const response = await fetch(`https://api.exchange.coinbase.com/products/${asset}-USD/ticker`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("Coinbase live prices are temporarily unavailable.");
  const result = await response.json() as { price?: string };
  if (!result.price || !/^(0|[1-9]\d*)(\.\d+)?$/.test(result.price)) throw new Error("Coinbase returned an invalid live price.");
  return result.price;
}
