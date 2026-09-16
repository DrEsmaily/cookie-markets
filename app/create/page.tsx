import Link from "next/link";
import { MarketDraftForm } from "@/components/market-draft-form";

export default function CreateMarketPage() {
  return (
    <main>
      <nav><Link className="brand" href="/">cookie<span>markets</span></Link><Link className="back-link" href="/">← All markets</Link></nav>
      <section className="create-layout">
        <div className="create-intro"><p className="eyebrow">MARKET DRAFT</p><h1>Write the rules before anyone trades.</h1><p className="lede">A strong market has one measurable question, a public source, and rules that cover Yes, No, and Invalid outcomes.</p></div>
        <MarketDraftForm />
      </section>
    </main>
  );
}
