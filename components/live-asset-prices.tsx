"use client";

import { useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";

type Prices = { BTC: string; ETH: string; BTCChange24h?: number; ETHChange24h?: number; source: string; updatedAt: string };

export function LiveAssetPrices() {
  const [prices, setPrices] = useState<Prices>();
  const [unavailable, setUnavailable] = useState(false);
  const [, setClock] = useState(0);

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

  useEffect(() => {
    const interval = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return <div className="live-prices" aria-live="polite">
    <PriceCard asset="BTC" price={prices?.BTC} change24h={prices?.BTCChange24h} />
    <PriceCard asset="ETH" price={prices?.ETH} change24h={prices?.ETHChange24h} />
    <small>{unavailable ? "Live prices temporarily unavailable" : prices ? `Coinbase · updated ${formatAge(prices.updatedAt)}` : "Loading live Coinbase prices…"}</small>
  </div>;
}

function PriceCard({ asset, price, change24h }: { asset: "BTC" | "ETH"; price?: string; change24h?: number }) {
  return <div className="live-price-card">
    <AssetIcon asset={asset} />
    <span className="asset-pair">{asset} / USD</span>
    <strong>{price ? formatUsd(price) : "—"}</strong>
    <span className={`price-change ${change24h !== undefined && change24h < 0 ? "negative" : ""}`}>{change24h === undefined ? "Live Coinbase reference" : <><b>{change24h >= 0 ? "▲ +" : "▼ -"}{Math.abs(change24h).toFixed(2)}%</b> <em>(24h)</em></>}</span>
    <svg className="price-sparkline" viewBox="0 0 240 48" role="img" aria-label={`${asset} live price trend decoration`} preserveAspectRatio="none">
      <defs><linearGradient id={`spark-${asset}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8ff45" stopOpacity=".35"/><stop offset="1" stopColor="#d8ff45" stopOpacity="0"/></linearGradient></defs>
      <path className="spark-area" d="M0 43 C18 31 24 18 39 28 S64 40 79 26 S99 18 113 27 S137 33 151 20 S176 23 189 12 S214 18 240 5 L240 48 L0 48 Z" fill={`url(#spark-${asset})`}/>
      <path d="M0 43 C18 31 24 18 39 28 S64 40 79 26 S99 18 113 27 S137 33 151 20 S176 23 189 12 S214 18 240 5" fill="none" stroke="#d8ff45" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  </div>;
}

function AssetIcon({ asset }: { asset: "BTC" | "ETH" }) {
  return <span className={`asset-icon asset-icon-${asset.toLowerCase()}`} aria-hidden="true">
    {asset === "BTC" ? <svg viewBox="0 0 64 64"><text x="32" y="43" textAnchor="middle">₿</text></svg> : <svg viewBox="0 0 64 64"><path d="M32 7 16 32l16-9 16 9L32 7Z" fill="#f3f4ff"/><path d="m32 57-16-22 16 9 16-9-16 22Z" fill="#c9cdf1"/><path d="m32 23-16 9 16 9 16-9-16-9Z" fill="#e5e7fb"/></svg>}
  </span>;
}

function formatUsd(value: string) {
  return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))}`;
}

function formatAge(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
  return seconds < 2 ? "just now" : `${seconds}s ago`;
}
