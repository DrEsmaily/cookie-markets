import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedProtocol } from "@/lib/protocol-reader";
import { formatTokenAmount } from "@/lib/token-amounts";
import { AmmTradePanel } from "@/components/amm-trade-panel";
import { verifyPublishedMarketTerms, type MarketTermsRecord } from "@/lib/market-terms-record";
import { readPublishedMarketTerms } from "@/lib/published-market-terms";
import { PriceEvidenceReview } from "@/components/price-evidence-review";

export async function OnchainMarketDetail({ address }: { address: string }) {
  try {
    const publicKey = new PublicKey(address);
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) throw new Error("Protocol is not deployed.");
    const account = await cookieChainConnection.getAccountInfo(publicKey);
    if (!account) throw new Error("Market account was not found.");
    const market = decodeMarketAccount(publicKey, account);
    if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match protocol config.");
    const tradingOpen = market.status === "open" && Number(market.closesAt) * 1_000 > Date.now();
    let terms: MarketTermsRecord | undefined;
    let termsError: string | undefined;
    try {
      terms = await verifyPublishedMarketTerms(await readPublishedMarketTerms(market.address), market);
    } catch (error) {
      termsError = error instanceof Error ? error.message : "Published terms verification failed.";
    }
    return (
      <section className="resolution-card">
        <p className="eyebrow">VERIFIED COOKIE CHAIN MARKET · {(tradingOpen ? market.status : market.status === "open" ? "closed" : market.status).toUpperCase()}</p>
        <h2>{terms?.question ?? "On-chain market account"}</h2>
        {terms ? <><p>Published question and rules match this market’s immutable on-chain hashes.</p><h3>Resolution source</h3><p>{terms.resolutionSource}</p><h3>Settlement rules</h3><p style={{ whiteSpace: "pre-wrap" }}>{terms.resolutionRules}</p></> : termsError ? <p role="alert">{termsError} Deposits are disabled. Withdrawals and redemption remain available for simulation.</p> : <p>No readable terms have been published in the registry. Supply the exact question and settlement rules below to verify them before preparing a deposit.</p>}
        <dl>
          <div><dt>Market</dt><dd><a href={`${COOKIE_CHAIN.explorerUrl}/address/${market.address}`} target="_blank" rel="noreferrer">{market.address} ↗</a></dd></div>
          <div><dt>Creator</dt><dd>{market.creator}</dd></div>
          <div><dt>Resolver</dt><dd>{market.resolver}</dd></div>
          <div><dt>Collateral mint</dt><dd>{market.collateralMint}</dd></div>
          <div><dt>Question hash</dt><dd>{market.questionHash}</dd></div>
          <div><dt>Rules hash</dt><dd>{market.rulesHash}</dd></div>
          <div><dt>Trading closes (Unix)</dt><dd>{market.closesAt}</dd></div>
          <div><dt>Resolution after (Unix)</dt><dd>{market.resolveAfter}</dd></div>
          <div><dt>Final outcome</dt><dd>{market.outcome}</dd></div>
          <div><dt>Outstanding collateral</dt><dd>{formatTokenAmount(BigInt(market.outstandingSets), protocol.collateralDecimals)} token units</dd></div>
        </dl>
        {!tradingOpen && market.status === "open" ? <p className="form-error" role="alert">Trading has closed. No new deposits or orders can be submitted for this market.</p> : null}
        {!termsError ? <AmmTradePanel key={market.address} market={market.address} /> : null}
        <PriceEvidenceReview key={`evidence-${market.address}`} market={market.address} settlesAt={new Date(Number(market.closesAt) * 1000).toISOString()} />
      </section>
    );
  } catch (error) {
    return <section className="resolution-card"><h2>Market verification unavailable</h2><p role="alert">{error instanceof Error ? error.message : "Could not verify this market."}</p><Link href="/">← All markets</Link></section>;
  }
}
