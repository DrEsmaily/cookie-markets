import Link from "next/link";
import { MarketCard } from "@/components/market-card";
import { WalletButton } from "@/components/wallet-button";
import { NetworkStatus } from "@/components/network-status";
import { LiveMarketList } from "@/components/live-market-list";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { featuredMarkets } from "@/lib/markets";

export default function Home() {
  return (
    <main>
      <nav>
        <Link className="brand" href="/">cookie<span>markets</span></Link>
        <Link className="create-link" href="/create">＋ Create market</Link>
        <div className="header-actions"><NetworkStatus /><WalletButton /></div>
      </nav>

      <section className="hero">
        <p className="eyebrow">PREDICTION MARKETS ON COOKIE CHAIN</p>
        <h1>Trade what the internet<br />thinks happens next.</h1>
        <p className="lede">Simple, transparent markets settled in COOK. Connect your Nightly wallet to follow the action.</p>
        <div className="hero-actions">
          <a className="primary-action" href="#markets">Explore markets <span>↓</span></a>
          <a className="text-action" href={COOKIE_CHAIN.explorerUrl} target="_blank" rel="noreferrer">Explore Cookie Chain ↗</a>
        </div>
      </section>

      <div id="markets"><LiveMarketList /></div>
      <section className="market-section">
        <div className="section-heading">
          <div><p className="eyebrow">RESOLVED PRICE MARKETS</p><h2>Recent BTC and ETH outcomes</h2></div>
        </div>
        <div className="market-grid">{featuredMarkets.map((market) => <MarketCard key={market.id} market={market} />)}</div>
      </section>

      <section className="how-it-works">
        <p className="eyebrow">HOW IT WORKS</p>
        <div className="steps">
          <div><span>01</span><h3>Pick a market</h3><p>Find a question with an outcome you have a view on.</p></div>
          <div><span>02</span><h3>Take a position</h3><p>When trading opens, buy Yes or No shares with COOK.</p></div>
          <div><span>03</span><h3>Settle transparently</h3><p>Resolved markets pay winning shares according to their rules.</p></div>
        </div>
      </section>
    </main>
  );
}
