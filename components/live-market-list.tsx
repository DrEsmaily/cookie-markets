"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VerifiedMarket } from "@/lib/protocol-accounts";
import { formatTokenAmount } from "@/lib/token-amounts";
import type { MarketTerms } from "@/lib/market-terms";

type MarketResponse = { deployed: boolean; markets?: (VerifiedMarket & { terms?: MarketTerms; termsError?: string; yesPercent?: number; liquidity?: string })[]; collateralDecimals?: number; error?: string };

export function LiveMarketList() {
  const [result, setResult] = useState<MarketResponse>();
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/protocol?markets=true", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as MarketResponse;
        if (!controller.signal.aborted) setResult(response.ok ? data : { deployed: false, error: data.error ?? "Market verification failed." });
      } catch {
        if (!controller.signal.aborted) setResult({ deployed: false, error: "Live markets are unavailable. No cached markets are shown." });
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, []);

  return (
    <section className="market-section" id="live-markets">
      <div className="section-heading"><div><p className="eyebrow">VERIFIED ON-CHAIN ACCOUNTS</p><h2>Live markets</h2></div></div>
      {!result ? <p role="status">Checking Cookie Chain…</p> : result.error ? <p role="alert">{result.error}</p> : !result.deployed ? <p>The protocol has not been deployed. No real markets or prices are available yet.</p> : !result.markets?.length ? <p>No markets have been created on this protocol yet.</p> : (
        <div className="market-grid">{[...result.markets].sort((first, second) => BigInt(first.createdAt) > BigInt(second.createdAt) ? -1 : 1).map((market) => (
          <Link className="market-card" href={`/markets/${market.address}`} key={market.address}>
            <div className="market-meta"><span>Crypto · {market.status}</span><span>Closes {new Date(Number(market.closesAt) * 1_000).toLocaleDateString()}</span></div>
            <h2>{market.terms?.question ?? `Market ${market.address.slice(0, 6)}…${market.address.slice(-4)}`}</h2>
            <div className="market-prices" aria-label={`Yes chance: ${market.yesPercent ?? 50}%`}>
              <div className="price-track"><div className="price-fill" style={{ width: `${market.yesPercent ?? 50}%` }} /></div>
              <strong>{(market.yesPercent ?? 50).toFixed(1)}% Yes</strong>
            </div>
            <div className="market-footer"><span>{formatTokenAmount(BigInt(market.liquidity ?? market.outstandingSets), result.collateralDecimals ?? 9)} COOK liquidity</span><span className="status">{market.status === "open" ? "Open" : market.outcome}</span></div>
          </Link>
        ))}</div>
      )}
    </section>
  );
}
