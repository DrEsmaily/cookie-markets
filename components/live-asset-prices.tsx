"use client";

import { useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";

type Prices = { BTC: string; ETH: string; source: string; updatedAt: string };

export function LiveAssetPrices() {
  const [prices, setPrices] = useState<Prices>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/prices", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const result = await readApiResponse<Prices>(response, "Live prices returned an unreadable response.");
        if (!response.ok) throw new Error();
        if (active) { setPrices(result); setUnavailable(false); }
      } catch { if (active) setUnavailable(true); }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  return <div className="live-prices" aria-live="polite">
    <div><span>BTC / USD</span><strong>{prices ? formatUsd(prices.BTC) : "—"}</strong></div>
    <div><span>ETH / USD</span><strong>{prices ? formatUsd(prices.ETH) : "—"}</strong></div>
    <small>{unavailable ? "Live prices temporarily unavailable" : prices ? `Coinbase · updated ${new Date(prices.updatedAt).toLocaleTimeString()}` : "Loading live Coinbase prices…"}</small>
  </div>;
}

function formatUsd(value: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
}
