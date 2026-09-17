import { NextResponse } from "next/server";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_MARKETS_PROGRAM_ID, deriveConfigAddress } from "@/lib/cookie-markets-program";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedProtocol } from "@/lib/protocol-reader";
import { verifyPublishedMarketTerms } from "@/lib/market-terms-record";
import { publishedMarketTerms } from "@/lib/published-market-terms";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const configAddress = deriveConfigAddress();
    const config = await readVerifiedProtocol(cookieChainConnection);
    if (!config) return NextResponse.json({ deployed: false, configAddress: configAddress.toBase58(), markets: [] });
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
