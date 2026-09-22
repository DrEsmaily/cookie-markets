import Image from "next/image";
import { LiveMarketList } from "@/components/live-market-list";
import { LiveAssetPrices } from "@/components/live-asset-prices";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import settlementCookies from "@/public/images/settlement-cookies-v1.png";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <SiteHeader />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">CRYPTO PREDICTION MARKET</p>
          <h1>Predict Crypto Trends &amp; Power the Market</h1>
          <p className="lede">Turn your YES or NO predictions on BTC and ETH into profit, or supply liquidity to earn a continuous share of platform fees. Fast, transparent, and powered by Cookie Chain.</p>
        </div>
        <aside className="hero-board">
          <div className="board-heading"><span>Market prices</span><strong>Live</strong></div>
          <LiveAssetPrices />
          <div className="settlement-card">
            <div><span>Settlement</span><strong>1 winning share = 1 COOK</strong><small>Settle transparently on Cookie Chain.</small></div>
            <Image className="cookie-stack" src={settlementCookies} alt="" aria-hidden="true" priority />
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
        <p className="eyebrow">GET STARTED</p>
        <div className="steps">
          <div><span>01</span><h3>Take Your Position</h3><p>Select YES or NO on straightforward BTC and ETH price outcomes.</p></div>
          <div><span>02</span><h3>Execute Your Trade</h3><p>Review your exact odds and lock in your position seamlessly via your Nightly wallet.</p></div>
          <div><span>03</span><h3>Collect Your Winnings</h3><p>Markets settle instantly and automatically using verified, minute-by-minute Coinbase data.</p></div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
