"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { VerifiedMarket } from "@/lib/protocol-accounts";
import { formatTokenAmount } from "@/lib/token-amounts";
import type { MarketTerms } from "@/lib/market-terms";
import { formatMarketText, formatUtcTimestamp, marketLifecycle } from "@/lib/market-lifecycle";
import { UI_LAUNCH_UNIX_SECONDS } from "@/lib/ui-launch";

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

  if (!result) return <section className="market-section"><p role="status">Checking Cookie Chain…</p></section>;
  if (result.error) return <section className="market-section"><p role="alert">{result.error}</p></section>;
  if (!result.deployed) return <section className="market-section"><p>The live protocol is unavailable.</p></section>;
  const markets = [...(result.markets ?? [])].filter((market) => BigInt(market.createdAt) >= UI_LAUNCH_UNIX_SECONDS).sort((first, second) => BigInt(first.createdAt) > BigInt(second.createdAt) ? -1 : 1);
  const open = markets.filter((market) => marketLifecycle(market).key === "open");
  const recent = markets.filter((market) => marketLifecycle(market).key !== "open").slice(0, 3);
  return <>
    <section className="market-section" id="live-markets">
      <div className="section-heading"><div><p className="eyebrow">OPEN NOW</p><h2>Live BTC &amp; ETH markets</h2><p>Trade verified price questions before their exact UTC deadline.</p></div><span className="section-count">{open.length} live</span></div>
      {open.length ? <div className="market-grid">{open.map((market) => <OnchainMarketCard key={market.address} market={market} decimals={result.collateralDecimals ?? 9} />)}</div> : <div className="empty-market-state"><strong>No market is open right now.</strong><span>Create a BTC or ETH market and become its first liquidity provider.</span><Link className="primary-action" href="/create">Create a market</Link></div>}
    </section>
    <section className="market-section resolved-section">
      <div className="section-heading"><div><p className="eyebrow">RECENTLY SETTLED</p><h2>Results and settlement</h2><p>Final outcomes appear here with markets that are actively completing verification.</p></div><span className="section-count">Latest {Math.min(recent.length, 3)}</span></div>
      {recent.length ? <div className="market-grid">{recent.map((market) => <OnchainMarketCard key={market.address} market={market} decimals={result.collateralDecimals ?? 9} />)}</div> : <div className="empty-market-state compact"><strong>No recent settlement activity.</strong><span>Closed markets will move here while awaiting their final result.</span></div>}
    </section>
  </>;
}

function OnchainMarketCard({ market, decimals }: { market: VerifiedMarket & { terms?: MarketTerms; yesPercent?: number; liquidity?: string }; decimals: number }) {
  const lifecycle = marketLifecycle(market);
  const yes = market.yesPercent ?? 50;
  const no = 100 - yes;
  const highlighted = market.status === "resolved" && market.outcome !== "invalid" ? market.outcome : yes >= no ? "yes" : "no";
  return <Link className={`market-card stage-${lifecycle.key}`} href={`/markets/${market.address}`}>
    <div className="market-meta"><span className="asset-badge">{market.terms?.question.includes("ETH") ? "ETH" : "BTC"}</span><span>{formatUtcTimestamp(market.closesAt)}</span></div>
    <h2>{market.terms ? formatMarketText(market.terms.question) : "Verified crypto price market"}</h2>
    <div className="market-prices" aria-label={`Yes chance: ${yes}%`}><div className="odds-row"><span className={highlighted === "yes" ? "leading" : ""}>{yes.toFixed(1)}% YES</span><span className={highlighted === "no" ? "leading" : ""}>{no.toFixed(1)}% NO</span></div><div className="price-track"><div className="price-fill" style={{ width: `${yes}%` }} /></div></div>
    <p className="stage-description">{lifecycle.description}</p>
    <div className="market-footer"><span>{formatTokenAmount(BigInt(market.liquidity ?? market.outstandingSets), decimals)} COOK</span><span className={`status status-${lifecycle.key}`}>{lifecycle.label}</span></div>
  </Link>;
}
