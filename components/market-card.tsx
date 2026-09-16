import type { PredictionMarket } from "@/lib/markets";
import { formatCook } from "@/lib/markets";
import Link from "next/link";

export function MarketCard({ market }: { market: PredictionMarket }) {
  return (
    <Link className="market-card" href={`/markets/${market.id}`}>
      <div className="market-meta">
        <span>{market.category}</span>
        <span>Closes {market.closesAt}</span>
      </div>
      <h2>{market.question}</h2>
      <div className="market-prices" aria-label={`Yes chance: ${market.yesPrice}%`}>
        <div className="price-track"><div className="price-fill" style={{ width: `${market.yesPrice}%` }} /></div>
        <strong>{market.yesPrice}% Yes</strong>
      </div>
      <div className="market-footer">
        <span>{formatCook(market.volumeCook)} COOK volume</span>
        <span className="status">Open</span>
      </div>
    </Link>
  );
}
