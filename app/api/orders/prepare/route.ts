import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { TOKEN_PROGRAM_ID } from "@/lib/cookie-markets-program";
import { decodeAskOrder, decodeBidOrder, decodeMarketAccount, type VerifiedBid } from "@/lib/protocol-accounts";
import { readVerifiedProtocol } from "@/lib/protocol-reader";
import { buildAskTransactionInstructions, buildBidTransactionInstructions } from "@/lib/ask-transactions";
import { readPreparationBody, RequestSizeError } from "@/lib/preparation-body";
import { parseTokenAmount } from "@/lib/token-amounts";
import { hashHex, hashMarketTerms } from "@/lib/market-terms";

export const dynamic = "force-dynamic";

function amount(value: unknown, decimals: number) {
  try { return parseTokenAmount(value as string, decimals); }
  catch (error) { throw new RangeError(error instanceof Error ? error.message : "Invalid decimal amount."); }
}

export async function POST(request: Request) {
  try {
    const body = JSON.parse(await readPreparationBody(request)) as Record<string, unknown>;
    if (!body || typeof body !== "object" || typeof body.market !== "string" || typeof body.user !== "string") return NextResponse.json({ error: "Provide market and wallet addresses." }, { status: 400 });
    const action = body.action;
    const orderType = body.orderType ?? "ask";
    if (orderType !== "ask" && orderType !== "bid") return NextResponse.json({ error: "Choose ask or bid." }, { status: 400 });
    if (action !== "place" && action !== "fill" && action !== "cancel") return NextResponse.json({ error: "Choose place, fill, or cancel." }, { status: 400 });
    if (body.wrapNative !== undefined && typeof body.wrapNative !== "boolean") return NextResponse.json({ error: "wrapNative must be a boolean." }, { status: 400 });
    if (body.wrapNative === true && !(orderType === "ask" && action === "fill") && !(orderType === "bid" && action === "place")) return NextResponse.json({ error: "Native wrapping is only available when funding a purchase." }, { status: 400 });
    if (action !== "cancel" && typeof body.amount !== "string") return NextResponse.json({ error: "Provide a decimal share amount." }, { status: 400 });
    if (action === "place" && (typeof body.nonce !== "string" || !/^(0|[1-9]\d{0,19})$/.test(body.nonce)
      || (body.side !== "yes" && body.side !== "no") || typeof body.price !== "string"
      || typeof body.expiresAt !== "string" || !/^[1-9]\d{0,18}$/.test(body.expiresAt))) return NextResponse.json({ error: "Provide an unsigned nonce, YES/NO side, decimal price, and expiry in Unix seconds." }, { status: 400 });
    if (action === "fill" && typeof body[orderType === "bid" ? "minimumProceeds" : "maximumDebit"] !== "string") return NextResponse.json({ error: "Provide an explicit collateral protection limit." }, { status: 400 });
    if (action !== "place" && typeof body.order !== "string") return NextResponse.json({ error: "Provide an order address." }, { status: 400 });
    let address: PublicKey;
    let user: PublicKey;
    let orderAddress: PublicKey | undefined;
    try {
      address = new PublicKey(body.market);
      user = new PublicKey(body.user);
      if (!PublicKey.isOnCurve(user.toBytes())) throw new Error("Invalid signing wallet.");
      if (action !== "place") orderAddress = new PublicKey(body.order as string);
    } catch { return NextResponse.json({ error: "Provide valid market, signing wallet, and order public keys." }, { status: 400 }); }
    if (action !== "cancel" && (typeof body.question !== "string" || typeof body.resolutionSource !== "string" || typeof body.resolutionRules !== "string")) return NextResponse.json({ error: "Review the full question, resolution source, and rules before trading." }, { status: 400 });
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) return NextResponse.json({ error: "Protocol is not deployed. No trading transaction can be prepared." }, { status: 409 });
    const account = await cookieChainConnection.getAccountInfo(address, "confirmed");
    if (!account) return NextResponse.json({ error: "Market was not found." }, { status: 404 });
    const market = decodeMarketAccount(address, account);
    if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match protocol config.");
    if (action !== "cancel") {
      const terms = await hashMarketTerms({ question: body.question as string, resolutionSource: body.resolutionSource as string, resolutionRules: body.resolutionRules as string });
      if (hashHex(terms.questionHash) !== market.questionHash || hashHex(terms.rulesHash) !== market.rulesHash) return NextResponse.json({ error: "Readable terms do not match the market commitments. Trading refused." }, { status: 409 });
      if (market.status !== "open") return NextResponse.json({ error: "Market is not open for trading." }, { status: 409 });
    }
    let operation: Parameters<typeof buildAskTransactionInstructions>[2];
    let bidOrder: VerifiedBid | undefined;
    try {
      if (action === "place") {
        operation = { action, nonce: BigInt(body.nonce as string), side: body.side as "yes" | "no", shares: amount(body.amount, protocol.collateralDecimals), price: amount(body.price, 6), expiresAt: BigInt(body.expiresAt as string) };
        if (operation.expiresAt > BigInt(market.closesAt)) throw new RangeError("Order expiry cannot exceed market close.");
      } else {
        const orderAccount = await cookieChainConnection.getAccountInfo(orderAddress!, "confirmed");
        if (!orderAccount) return NextResponse.json({ error: "Order was not found." }, { status: 404 });
        const order = orderType === "bid" ? (bidOrder = decodeBidOrder(orderAddress!, orderAccount, market)) : decodeAskOrder(orderAddress!, orderAccount, market);
        operation = action === "cancel" ? { action, order } : { action, order, shares: amount(body.amount, protocol.collateralDecimals), maximumDebit: amount(orderType === "bid" ? body.minimumProceeds : body.maximumDebit, protocol.collateralDecimals), wrapNative: body.wrapNative === true };
      }
    } catch (error) {
      if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    const shareMintAddress = operation.action === "place" ? operation.side === "yes" ? market.yesMint : market.noMint : operation.order.shareMint;
    const shareMint = await cookieChainConnection.getAccountInfo(new PublicKey(shareMintAddress), "confirmed");
    if (!shareMint || !shareMint.owner.equals(TOKEN_PROGRAM_ID) || shareMint.data.length !== 82 || shareMint.data[45] !== 1 || shareMint.data[44] !== protocol.collateralDecimals) throw new Error("Outcome mint is not initialized with approved collateral decimals.");
    const prepared = orderType === "bid" ? await buildBidTransactionInstructions(market, user,
      operation.action === "place" ? { ...operation, feeBps: protocol.feeBps, wrapNative: body.wrapNative === true }
        : operation.action === "cancel" ? { action: "cancel", order: bidOrder! }
          : { action: "fill", order: bidOrder!, shares: operation.shares, minimumProceeds: operation.maximumDebit },
    ) : await buildAskTransactionInstructions(market, user, operation);
    const latest = await cookieChainConnection.getLatestBlockhashAndContext("confirmed");
    const transaction = new Transaction({ feePayer: user, ...latest.value }).add(...prepared.instructions);
    const message = transaction.compileMessage();
    const simulation = await cookieChainConnection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, commitment: "confirmed", minContextSlot: latest.context.slot });
    if (simulation.value.err) return NextResponse.json({ error: "Trading simulation failed. Nothing was signed or sent.", simulationError: simulation.value.err, logs: simulation.value.logs?.slice(-15) }, { status: 409 });
    const fee = await cookieChainConnection.getFeeForMessage(message, "confirmed");
    if (fee.value === null) throw new Error("Could not estimate the transaction fee. Prepare again.");
    return NextResponse.json({
      unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      genesisHash: COOKIE_CHAIN.genesisHash, feePayer: user.toBase58(), market: market.address, order: prepared.order,
      action, orderType, shareMint: shareMintAddress, collateralMint: market.collateralMint,
      sharesBaseUnits: operation.action === "cancel" ? operation.order.remainingShares : operation.shares.toString(),
      maximumDebitBaseUnits: operation.action === "fill" && orderType === "ask" ? operation.maximumDebit.toString() : undefined,
      minimumProceedsBaseUnits: operation.action === "fill" && orderType === "bid" ? operation.maximumDebit.toString() : undefined,
      quote: prepared.quote ? Object.fromEntries(Object.entries(prepared.quote).map(([key, value]) => [key, value.toString()])) : undefined,
      feeBaseUnits: fee.value.toString(), blockhash: latest.value.blockhash, lastValidBlockHeight: latest.value.lastValidBlockHeight, simulationSlot: simulation.context.slot,
      note: "Unsigned review only, not execution. Network fees exclude rent for order, escrow, and associated accounts. Native wrapping funds the quoted debit; receipts remain wrapped collateral. Re-prepare after any order change.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare trading transaction." }, { status: error instanceof RequestSizeError ? 413 : error instanceof SyntaxError || error instanceof RangeError ? 400 : 503 });
  }
}
