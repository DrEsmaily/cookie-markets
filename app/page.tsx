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
          <p className="eyebrow">THE CRYPTO PRICE DESK</p>
          <h1>Trade the next move.</h1>
          <p className="lede">Take a clear YES or NO position on where Bitcoin and Ethereum will be—then settle transparently on Cookie Chain.</p>
        </div>
        <aside className="hero-board">
          <div className="board-heading"><span>Market reference</span><strong>Live</strong></div>
          <LiveAssetPrices />
          <div className="board-facts"><div><strong>1 COOK</strong><span>per winning share</span></div><div><strong>1%</strong><span>creator fee</span></div><div><strong>24/7</strong><span>on-chain markets</span></div></div>
          <p>Coinbase reference prices update automatically. Market terms and settlement evidence remain verifiable on-chain.</p>
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
