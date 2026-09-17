import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedProtocol } from "@/lib/protocol-reader";
import { formatTokenAmount } from "@/lib/token-amounts";
import { PositionPreparationForm } from "@/components/position-preparation-form";

export async function OnchainMarketDetail({ address }: { address: string }) {
  try {
    const publicKey = new PublicKey(address);
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) throw new Error("Protocol is not deployed.");
    const account = await cookieChainConnection.getAccountInfo(publicKey);
    if (!account) throw new Error("Market account was not found.");
    const market = decodeMarketAccount(publicKey, account);
    if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match protocol config.");
    return (
      <section className="resolution-card">
        <p className="eyebrow">VERIFIED COOKIE CHAIN MARKET · {market.status.toUpperCase()}</p>
        <h2>On-chain market account</h2>
        <p>Deposits remain disabled until readable question text and settlement rules are verified against these immutable hashes.</p>
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
        <PositionPreparationForm market={market.address} />
      </section>
    );
  } catch (error) {
    return <section className="resolution-card"><h2>Market verification unavailable</h2><p role="alert">{error instanceof Error ? error.message : "Could not verify this market."}</p><Link href="/">← All markets</Link></section>;
  }
}
