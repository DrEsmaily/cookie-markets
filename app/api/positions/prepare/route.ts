import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedProtocol } from "@/lib/protocol-reader";
import { buildPositionTransactionInstructions } from "@/lib/position-transactions";
import { parseTokenAmount } from "@/lib/token-amounts";
import { hashHex, hashMarketTerms } from "@/lib/market-terms";
import { readPreparationBody, RequestSizeError } from "@/lib/preparation-body";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const text = await readPreparationBody(request);
    const body = JSON.parse(text) as Record<string, unknown>;
    if (!body || typeof body !== "object" || typeof body.market !== "string" || typeof body.user !== "string" || typeof body.amount !== "string") {
      return NextResponse.json({ error: "Provide a market address, wallet address, and decimal amount." }, { status: 400 });
    }
    const action = body.action;
    if (action !== "split" && action !== "merge" && action !== "redeem") return NextResponse.json({ error: "Choose split, merge, or redeem." }, { status: 400 });
    const side = body.side;
    if (action === "redeem" && side !== "yes" && side !== "no") return NextResponse.json({ error: "Choose a redemption side." }, { status: 400 });
    if (body.wrapNative !== undefined && typeof body.wrapNative !== "boolean") return NextResponse.json({ error: "wrapNative must be a boolean." }, { status: 400 });
    let address: PublicKey;
    let user: PublicKey;
    try { address = new PublicKey(body.market); user = new PublicKey(body.user); }
    catch { return NextResponse.json({ error: "Market and wallet addresses must be valid public keys." }, { status: 400 }); }
    const protocol = await readVerifiedProtocol(cookieChainConnection);
    if (!protocol) return NextResponse.json({ error: "Protocol is not deployed. No transaction can be prepared." }, { status: 409 });
    const account = await cookieChainConnection.getAccountInfo(address);
    if (!account) return NextResponse.json({ error: "Market was not found." }, { status: 404 });
    const market = decodeMarketAccount(address, account);
    if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match protocol config.");
    if (action === "split") {
      if (typeof body.question !== "string" || typeof body.resolutionSource !== "string" || typeof body.resolutionRules !== "string") return NextResponse.json({ error: "Supply the full question, resolution source, and rules before depositing." }, { status: 400 });
      const terms = await hashMarketTerms({ question: body.question, resolutionSource: body.resolutionSource, resolutionRules: body.resolutionRules });
      if (hashHex(terms.questionHash) !== market.questionHash || hashHex(terms.rulesHash) !== market.rulesHash) return NextResponse.json({ error: "Readable terms do not match the immutable on-chain hashes. Deposit refused." }, { status: 409 });
    }
    const amount = parseTokenAmount(body.amount, protocol.collateralDecimals);
    if (action === "redeem" && market.outcome === "invalid" && amount % BigInt(2) !== BigInt(0)) return NextResponse.json({ error: "Invalid-market refunds require an even number of share base units." }, { status: 400 });
    const prepared = await buildPositionTransactionInstructions({ creator: new PublicKey(market.creator), marketNonce: BigInt(market.nonce), collateralMint: new PublicKey(market.collateralMint), user, amount, action, side: side === "yes" || side === "no" ? side : undefined, wrapNative: body.wrapNative === true });
    const latest = await cookieChainConnection.getLatestBlockhashAndContext("confirmed");
    const transaction = new Transaction({ feePayer: user, ...latest.value }).add(...prepared.instructions);
    const message = transaction.compileMessage();
    const simulation = await cookieChainConnection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, commitment: "confirmed", minContextSlot: latest.context.slot });
    if (simulation.value.err) {
      const logs = simulation.value.logs?.slice(-15);
      const closed = logs?.some((line) => line.includes("MarketAlreadyClosed"));
      return NextResponse.json({ error: closed ? "This market has already closed. Create or choose a future market before adding liquidity." : "Transaction simulation failed. No signature was requested and nothing was sent.", simulationError: simulation.value.err, logs }, { status: 409 });
    }
    const fee = await cookieChainConnection.getFeeForMessage(message, "confirmed");
    if (fee.value === null) throw new Error("Could not estimate the transaction fee. Prepare again with a fresh blockhash.");
    return NextResponse.json({
      unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      genesisHash: COOKIE_CHAIN.genesisHash, feePayer: user.toBase58(), market: market.address, action, amountBaseUnits: amount.toString(),
      collateralMint: market.collateralMint, userCollateral: prepared.userCollateral.toBase58(), userYes: prepared.userYes.toBase58(), userNo: prepared.userNo.toBase58(),
      feeBaseUnits: fee.value.toString(), blockhash: latest.value.blockhash, lastValidBlockHeight: latest.value.lastValidBlockHeight, simulationSlot: simulation.context.slot,
      note: "Unsigned simulation only. Fees exclude account-creation rent. Withdrawals and redemptions return wrapped collateral; unwrapping is a separate explicit action.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare this transaction." }, { status: error instanceof RequestSizeError ? 413 : error instanceof SyntaxError || error instanceof RangeError ? 400 : 503 });
  }
}
