import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_MARKETS_PROGRAM_ID } from "@/lib/cookie-markets-program";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedPosition, readVerifiedProtocol } from "@/lib/protocol-reader";
import { creatorClaimable, decodeAmmPool, deriveAmmAddresses } from "@/lib/amm-pool";
import { readPublishedMarketTerms } from "@/lib/published-market-terms";
import { verifyPublishedMarketTerms } from "@/lib/market-terms-record";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const user = new PublicKey((await params).address);
    if (!PublicKey.isOnCurve(user.toBytes())) return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) return NextResponse.json({ error: "Protocol is not deployed." }, { status: 409 });
    const accounts = await cookieChainConnection.getProgramAccounts(COOKIE_MARKETS_PROGRAM_ID, { filters: [{ dataSize: 307 }] });
    const positions = await Promise.all(accounts.map(async ({ pubkey, account }) => {
      const market = decodeMarketAccount(pubkey, account);
      const [position, poolAccount] = await Promise.all([
        readVerifiedPosition(cookieChainConnection, market, user),
        cookieChainConnection.getAccountInfo(deriveAmmAddresses(pubkey).pool, "confirmed"),
      ]);
      const yes = BigInt(position.yes.amountBaseUnits);
      const no = BigInt(position.no.amountBaseUnits);
      let claimable = BigInt(0);
      if (market.status === "resolved") {
        if (market.outcome === "yes") claimable += yes;
        else if (market.outcome === "no") claimable += no;
        else if (market.outcome === "invalid") claimable += (yes + no) / BigInt(2);
      }
      let creatorLiquidity = BigInt(0);
      if (poolAccount) {
        const pool = decodeAmmPool(deriveAmmAddresses(pubkey).pool, poolAccount);
        if (pool.creator === user.toBase58() && !pool.settlementClaimed) {
          creatorLiquidity = market.status === "resolved" ? creatorClaimable(market.outcome, pool.yesReserve, pool.noReserve) : pool.liquidity;
          if (market.status === "resolved") claimable += creatorLiquidity;
        }
      }
      let question = `Market ${market.address.slice(0, 6)}…${market.address.slice(-4)}`;
      try {
        const terms = await verifyPublishedMarketTerms(await readPublishedMarketTerms(market.address), market);
        if (terms) question = terms.question;
      } catch { /* verified address remains usable */ }
      return { market: market.address, question, status: market.status, outcome: market.outcome, yes: yes.toString(), no: no.toString(), creatorLiquidity: creatorLiquidity.toString(), claimable: claimable.toString(), createdAt: market.createdAt };
    }));
    const visible = positions.filter((position) => BigInt(position.yes) > BigInt(0) || BigInt(position.no) > BigInt(0) || BigInt(position.creatorLiquidity) > BigInt(0) || BigInt(position.claimable) > BigInt(0));
    visible.sort((first, second) => Number(BigInt(second.createdAt) - BigInt(first.createdAt)));
    return NextResponse.json({ decimals: protocol.collateralDecimals, positions: visible });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Portfolio is unavailable." }, { status: 503 });
  }
}
