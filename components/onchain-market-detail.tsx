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
import { formatMarketText, formatUtcTimestamp, marketLifecycle } from "@/lib/market-lifecycle";

export async function OnchainMarketDetail({ address }: { address: string }) {
  try {
    const publicKey = new PublicKey(address);
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) throw new Error("Protocol is not deployed.");
    const account = await cookieChainConnection.getAccountInfo(publicKey);
    if (!account) throw new Error("Market account was not found.");
    const market = decodeMarketAccount(publicKey, account);
    if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match protocol config.");
    const lifecycle = marketLifecycle(market);
    let terms: MarketTermsRecord | undefined;
    let termsError: string | undefined;
    try {
      terms = await verifyPublishedMarketTerms(await readPublishedMarketTerms(market.address), market);
    } catch (error) {
      termsError = error instanceof Error ? error.message : "Published terms verification failed.";
    }
    return (
      <section className="market-page">
        <p className="eyebrow">VERIFIED COOKIE CHAIN MARKET</p>
        <div className={`market-stage stage-${lifecycle.key}`}><strong>{lifecycle.label}</strong><span>{lifecycle.description}</span></div>
        <div className="market-page-grid"><div className="market-story">
          <h1>{terms ? formatMarketText(terms.question) : "On-chain market account"}</h1>
          <p className="market-trust">{terms ? "Question and settlement rules are verified against immutable on-chain hashes." : termsError ? `${termsError} Deposits are disabled.` : "Readable public terms are unavailable for this market."}</p>
          <div className="market-key-stats"><div><span>Trading deadline</span><strong>{formatUtcTimestamp(market.closesAt)}</strong></div><div><span>Current result</span><strong>{market.outcome === "unresolved" ? "Awaiting result" : market.outcome.toUpperCase()}</strong></div><div><span>Collateral locked</span><strong>{formatTokenAmount(BigInt(market.outstandingSets), protocol.collateralDecimals)} COOK</strong></div></div>
          {terms ? <div className="market-rules"><h2>How this market settles</h2><div><span>Price source</span><p>{formatMarketText(terms.resolutionSource)}</p></div><div><span>Exact rules</span><p>{formatMarketText(terms.resolutionRules)}</p></div></div> : null}
          <details className="technical-details"><summary>On-chain verification details</summary><dl>
            <div><dt>Market</dt><dd><a href={`${COOKIE_CHAIN.explorerUrl}/address/${market.address}`} target="_blank" rel="noreferrer">{market.address} ↗</a></dd></div>
            <div><dt>Creator</dt><dd>{market.creator}</dd></div><div><dt>Resolver</dt><dd>{market.resolver}</dd></div><div><dt>Collateral mint</dt><dd>{market.collateralMint}</dd></div><div><dt>Question hash</dt><dd>{market.questionHash}</dd></div><div><dt>Rules hash</dt><dd>{market.rulesHash}</dd></div><div><dt>Resolution begins</dt><dd>{formatUtcTimestamp(market.resolveAfter)}</dd></div>
          </dl></details>
          {!lifecycle.tradingOpen && market.status === "open" ? <p className="form-error" role="alert">Trading has closed. The verified result is being prepared.</p> : null}
        </div><aside className="market-trade-column">{!termsError ? <AmmTradePanel key={market.address} market={market.address} /> : <div className="amm-panel"><p role="alert">Trading is unavailable because the public terms could not be verified.</p></div>}</aside></div>
      </section>
    );
  } catch (error) {
    return <section className="resolution-card"><h2>Market verification unavailable</h2><p role="alert">{error instanceof Error ? error.message : "Could not verify this market."}</p><Link href="/">← All markets</Link></section>;
  }
}
