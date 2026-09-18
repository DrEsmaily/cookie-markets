import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_MARKETS_PROGRAM_ID, deriveConfigAddress } from "@/lib/cookie-markets-program";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedAsks, readVerifiedBids, readVerifiedProtocol, readVerifiedPosition } from "@/lib/protocol-reader";
import { verifyPublishedMarketTerms } from "@/lib/market-terms-record";
import { publishedMarketTerms } from "@/lib/published-market-terms";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    let positionUser: PublicKey | undefined;
    let positionMarket: PublicKey | undefined;
    if (parameters.has("position") || parameters.has("user")) {
      try {
        if (!parameters.get("position") || !parameters.get("user") || parameters.has("asks") || parameters.has("bids") || parameters.has("markets")) throw new Error();
        positionUser = new PublicKey(parameters.get("user")!);
        positionMarket = new PublicKey(parameters.get("position")!);
        if (!PublicKey.isOnCurve(positionUser.toBytes())) throw new Error();
      } catch { return NextResponse.json({ error: "Provide a valid position market and on-curve wallet address without other discovery filters." }, { status: 400 }); }
    }
    if (parameters.has("asks") && parameters.has("bids")) {
      return NextResponse.json({ error: "Request one order side at a time." }, { status: 400 });
    }
    const bidsRequested = parameters.has("bids");
    const asksAddress = parameters.get(bidsRequested ? "bids" : "asks");
    let asksMarket: PublicKey | undefined;
    if (asksAddress !== null) {
      try { asksMarket = new PublicKey(asksAddress); }
      catch { return NextResponse.json({ error: "Provide a valid market address." }, { status: 400 }); }
    }
    const configAddress = deriveConfigAddress();
    const config = await readVerifiedProtocol(cookieChainConnection);
    if (!config) return NextResponse.json({ deployed: false, configAddress: configAddress.toBase58(), markets: [] });
    if (positionUser && positionMarket) {
      const account = await cookieChainConnection.getAccountInfo(positionMarket, "confirmed");
      if (!account) return NextResponse.json({ error: "Market was not found." }, { status: 404 });
      const market = decodeMarketAccount(positionMarket, account);
      if (market.collateralMint !== config.collateralMint) throw new Error("Market collateral does not match protocol config.");
      return NextResponse.json({ deployed: true, collateralDecimals: config.collateralDecimals, position: await readVerifiedPosition(cookieChainConnection, market, positionUser), note: "Associated token account balances only. Native COOK, other token accounts and escrowed orders are excluded. This is not a payout quote." });
    }
    if (asksMarket) {
      const account = await cookieChainConnection.getAccountInfo(asksMarket, "confirmed");
      if (!account) return NextResponse.json({ error: "Market was not found." }, { status: 404 });
      const market = decodeMarketAccount(asksMarket, account);
      if (market.collateralMint !== config.collateralMint) throw new Error("Market collateral does not match protocol config.");
      if (bidsRequested) {
        const bids = await readVerifiedBids(cookieChainConnection, market);
        return NextResponse.json({ deployed: true, market, bids });
      }
      const asks = await readVerifiedAsks(cookieChainConnection, market);
      return NextResponse.json({ deployed: true, market, asks });
    }
    if (new URL(request.url).searchParams.get("markets") === "true") {
      const accounts = await cookieChainConnection.getProgramAccounts(COOKIE_MARKETS_PROGRAM_ID, { filters: [{ dataSize: 307 }] });
      const markets = await Promise.all(accounts.map(async ({ pubkey, account }) => {
        const market = decodeMarketAccount(pubkey, account);
        if (market.collateralMint !== config.collateralMint) throw new Error("Market collateral does not match protocol config.");
        try {
          return { ...market, terms: await verifyPublishedMarketTerms(publishedMarketTerms, market) };
        } catch (error) {
          return { ...market, termsError: error instanceof Error ? error.message : "Published terms verification failed." };
        }
      }));
      return NextResponse.json({ deployed: true, ...config, markets });
    }
    return NextResponse.json({ deployed: true, ...config });
  } catch (error) {
    return NextResponse.json({ deployed: false, error: error instanceof Error ? error.message : "Could not verify protocol accounts." }, { status: 503 });
  }
}
