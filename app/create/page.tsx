import { MarketDraftForm } from "@/components/market-draft-form";
import { LiveAssetPrices } from "@/components/live-asset-prices";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const dynamic = "force-dynamic";

export default function CreateMarketPage() {
  return (
    <main>
      <SiteHeader backHref="/" />
      <section className="create-layout">
        <div className="create-intro"><p className="eyebrow">CREATE A PRICE MARKET</p><h1>Choose the price. Set the deadline.</h1><p className="lede">Launch a real BTC or ETH market with 100 COOK or more. CookieMarkets writes the question, verifies the price source, and handles settlement.</p><div className="create-steps"><span><b>01</b> Pick BTC or ETH</span><span><b>02</b> Set target and UTC deadline</span><span><b>03</b> Review once, approve in Nightly</span></div></div>
      <div><LiveAssetPrices /><MarketDraftForm /></div>
      </section>
      <SiteFooter />
    </main>
  );
}
