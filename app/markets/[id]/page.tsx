import Link from "next/link";
import { notFound } from "next/navigation";
import { featuredMarkets, formatCook, getMarket } from "@/lib/markets";
import { PublicKey } from "@solana/web3.js";
import { OnchainMarketDetail } from "@/components/onchain-market-detail";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return featuredMarkets.map(({ id }) => ({ id }));
}

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = getMarket(id);
  if (!market) {
    try { new PublicKey(id); } catch { notFound(); }
    return <main><nav><Link className="brand" href="/">cookie<span>markets</span></Link><Link className="back-link" href="/">← All markets</Link></nav><OnchainMarketDetail address={id} /></main>;
  }

  return (
    <main>
      <nav><Link className="brand" href="/">cookie<span>markets</span></Link><Link className="back-link" href="/">← All markets</Link></nav>
      <section className="market-detail">
        <div className="detail-main">
          <p className="eyebrow">{market.category} · RESOLVED EXAMPLE</p>
          <h1>{market.question}</h1>
          <p className="lede">{market.description}</p>
          <div className="probability"><strong>{market.yesPrice}%</strong><span>market probability</span></div>
          <div className="detail-stats"><div><span>Volume</span><strong>{formatCook(market.volumeCook)} COOK</strong></div><div><span>Trading closes</span><strong>{market.closesAt}</strong></div><div><span>Expected resolution</span><strong>{market.resolvesAt}</strong></div></div>
        </div>
        <aside className="trade-panel resolved-example">
          <p className="eyebrow">FINAL RESULT</p><h2>Resolved {market.outcome.toUpperCase()}</h2>
          <p>This example illustrates how a completed BTC or ETH market appears after Coinbase price verification.</p>
        </aside>
      </section>
      <section className="resolution-card"><p className="eyebrow">RESOLUTION</p><h2>How this market settled</h2><dl><div><dt>Source</dt><dd>{market.resolutionSource}</dd></div><div><dt>Rules</dt><dd>{market.resolutionRules}</dd></div><div><dt>Finalization</dt><dd>Finalized immediately after verified evidence was available.</dd></div></dl></section>
    </main>
  );
}
