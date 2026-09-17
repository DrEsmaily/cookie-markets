"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VerifiedMarket } from "@/lib/protocol-accounts";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { formatTokenAmount } from "@/lib/token-amounts";

type MarketResponse = { deployed: boolean; markets?: VerifiedMarket[]; collateralDecimals?: number; error?: string };

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
        <div className="market-grid">{result.markets.map((market) => (
          <article className="market-card" key={market.address}>
            <div className="market-meta"><span>{market.status}</span><span>{market.outcome}</span></div>
            <h2><Link href={`/markets/${market.address}`}>Market {market.address.slice(0, 6)}…{market.address.slice(-4)}</Link></h2>
            <p>Question text has not been verified. A hash is not a substitute for readable settlement rules.</p>
            <p>Outstanding collateral: {formatTokenAmount(BigInt(market.outstandingSets), result.collateralDecimals ?? 9)} token units</p>
            <div className="market-footer"><Link href={`/markets/${market.address}`}>Inspect account →</Link><a href={`${COOKIE_CHAIN.explorerUrl}/address/${market.address}`} target="_blank" rel="noreferrer">Cookiescan ↗</a></div>
          </article>
        ))}</div>
      )}
    </section>
  );
}
