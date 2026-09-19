import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_MARKETS_PROGRAM_ID, deriveConfigAddress } from "@/lib/cookie-markets-program";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedAsks, readVerifiedBids, readVerifiedProtocol, readVerifiedPosition } from "@/lib/protocol-reader";
import { verifyPublishedMarketTerms } from "@/lib/market-terms-record";
import { readPublishedMarketTerms, publishVerifiedMarketTerms } from "@/lib/published-market-terms";
import { createMarketTermsRecord, createPriceEvidenceRecord } from "@/lib/market-terms-record";
import { coinbasePriceMarketSpec, createPriceMarketTerms, collectCoinbasePriceEvidence } from "@/lib/market-terms";
import { readPreparationBody, RequestSizeError } from "@/lib/preparation-body";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = JSON.parse(await readPreparationBody(request));
    if (!body || typeof body.market !== "string") return NextResponse.json({ error: "Provide a market address and its exact readable terms." }, { status: 400 });
    if (body.action !== undefined && body.action !== "collect-price-evidence") return NextResponse.json({ error: "Unknown protocol action." }, { status: 400 });
    const collecting = body.action === "collect-price-evidence";
    let priceSpec;
    if (collecting) {
      if ((body.asset !== "BTC" && body.asset !== "ETH") || (body.direction !== "above" && body.direction !== "under") || typeof body.targetUsd !== "string" || typeof body.settlesAt !== "string") return NextResponse.json({ error: "Provide BTC or ETH, above or under, a decimal USD threshold and the exact UTC settlement minute." }, { status: 400 });
      priceSpec = coinbasePriceMarketSpec(body.asset, body.targetUsd, body.settlesAt, body.direction);
    } else if (typeof body.question !== "string" || typeof body.resolutionSource !== "string" || typeof body.resolutionRules !== "string") return NextResponse.json({ error: "Provide a market address and its exact readable terms." }, { status: 400 });
    let address: PublicKey;
    try { address = new PublicKey(body.market); }
    catch { return NextResponse.json({ error: "Provide a valid market address." }, { status: 400 }); }
    let record;
    try { record = await createMarketTermsRecord(address.toBase58(), priceSpec ? createPriceMarketTerms(priceSpec) : body); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid readable terms." }, { status: 400 }); }
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) return NextResponse.json({ error: "Protocol is not deployed." }, { status: 409 });
    const account = await cookieChainConnection.getAccountInfo(address, "confirmed");
    if (!account) return NextResponse.json({ error: "Market was not found." }, { status: 404 });
    const market = decodeMarketAccount(address, account);
    if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match protocol config.");
    try { await verifyPublishedMarketTerms([record], market); }
    catch { return NextResponse.json({ error: "Readable terms do not match the immutable on-chain hashes." }, { status: 409 }); }
    if (priceSpec) {
      const settlement = BigInt(Date.parse(priceSpec.settlesAt) / 1000);
      if (BigInt(market.closesAt) !== settlement || BigInt(market.resolveAfter) !== settlement) return NextResponse.json({ error: "Market schedule does not match the fixed price template." }, { status: 409 });
      const evidence = await collectCoinbasePriceEvidence(priceSpec);
      const artifact = await createPriceEvidenceRecord({ market, spec: priceSpec, observations: evidence.observations, publishedAt: evidence.collectedAt, originalResponse: evidence.originalResponse });
      return NextResponse.json({ ...artifact, providerUrl: evidence.url, note: "Evidence candidate only. The timestamp records collection, not certified public publication. No outcome proposal or signature was requested. Publish and independently verify this evidence before resolver submission." });
    }
    const result = await publishVerifiedMarketTerms(record, market);
    return NextResponse.json({ ...result, record, note: "Public immutable terms stored. No wallet signature or transaction was requested." }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Terms publication failed." }, { status: error instanceof RequestSizeError ? 413 : error instanceof SyntaxError || error instanceof RangeError ? 400 : 503 });
  }
}

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
          return { ...market, terms: await verifyPublishedMarketTerms(await readPublishedMarketTerms(market.address), market) };
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
