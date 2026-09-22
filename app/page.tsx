import { LiveMarketList } from "@/components/live-market-list";
import { LiveAssetPrices } from "@/components/live-asset-prices";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <SiteHeader />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">LIVE PREDICTION MARKETS</p>
          <h1>Bitcoin and Ethereum settle transparently on Cookie Chain.</h1>
          <p className="lede">Take a clear YES or NO position on the next price move, with verifiable settlement and real COOK payouts.</p>
        </div>
        <aside className="hero-board">
          <div className="board-heading"><span>Market prices</span><strong>Live</strong></div>
          <LiveAssetPrices />
          <div className="settlement-card">
            <div><span>Settlement</span><strong>1 winning share = 1 COOK</strong><small>Settle transparently on Cookie Chain.</small></div>
            <div className="cookie-stack" aria-hidden="true"><i>🍪</i><i>🍪</i><i>🍪</i></div>
          </div>
          <div className="board-facts">
            <div><b aria-hidden="true">%</b><p><strong>1%</strong><span>creator fee</span></p></div>
            <div><b aria-hidden="true">◷</b><p><strong>24/7</strong><span>on-chain markets</span></p></div>
          </div>
          <p>Prices update automatically. Settlement is verifiable on Cookie Chain.</p>
        </aside>
      </section>

      <div id="markets"><LiveMarketList /></div>

      <section className="how-it-works">
        <p className="eyebrow">HOW IT WORKS</p>
        <div className="steps">
          <div><span>01</span><h3>Choose your view</h3><p>Pick YES or NO on a clearly defined BTC or ETH price question.</p></div>
          <div><span>02</span><h3>Trade with COOK</h3><p>See the exact price and maximum trade before approving in Nightly.</p></div>
          <div><span>03</span><h3>Claim the result</h3><p>Markets settle automatically from verified Coinbase minute data.</p></div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
