import Link from "next/link";
import { notFound } from "next/navigation";
import { featuredMarkets, formatCook, getMarket } from "@/lib/markets";
import { PROTOCOL_LIMITS } from "@/lib/protocol";

export function generateStaticParams() {
  return featuredMarkets.map(({ id }) => ({ id }));
}

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = getMarket(id);
  if (!market) notFound();

  return (
    <main>
      <nav><Link className="brand" href="/">cookie<span>markets</span></Link><Link className="back-link" href="/">← All markets</Link></nav>
      <section className="market-detail">
        <div className="detail-main">
          <p className="eyebrow">{market.category} · OPEN</p>
          <h1>{market.question}</h1>
          <p className="lede">{market.description}</p>
          <div className="probability"><strong>{market.yesPrice}%</strong><span>market probability</span></div>
          <div className="detail-stats"><div><span>Volume</span><strong>{formatCook(market.volumeCook)} COOK</strong></div><div><span>Trading closes</span><strong>{market.closesAt}</strong></div><div><span>Expected resolution</span><strong>{market.resolvesAt}</strong></div></div>
        </div>
        <aside className="trade-panel">
          <p className="eyebrow">TRADING PREVIEW</p><h2>Take a position</h2>
          <div className="outcome-buttons"><button type="button">Yes · {market.yesPrice}¢</button><button type="button">No · {100 - market.yesPrice}¢</button></div>
          <label>Amount in COOK<input type="text" placeholder="0.00" disabled /></label>
          <button className="disabled-action" type="button" disabled>Trading opens after program deployment</button>
          <p>No transaction or wallet signature is requested in this preview.</p>
        </aside>
      </section>
      <section className="resolution-card"><p className="eyebrow">RESOLUTION</p><h2>How this market settles</h2><dl><div><dt>Source</dt><dd>{market.resolutionSource}</dd></div><div><dt>Rules</dt><dd>{market.resolutionRules}</dd></div><div><dt>Challenge window</dt><dd>{PROTOCOL_LIMITS.resolutionChallengeSeconds / 3600} hours before final settlement</dd></div></dl></section>
    </main>
  );
}
