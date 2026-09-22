import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { readVerifiedProtocol } from "@/lib/protocol-reader";
import { decodeAmmPool, decodeMarketAccounting, deriveAmmAddresses, ammProbabilityBps, creatorClaimable, maximumAmmTrade, quoteWholeShares } from "@/lib/amm-pool";
import { buildBuyFromAmmInstruction, buildClaimAmmSettlementInstruction, TOKEN_PROGRAM_ID } from "@/lib/cookie-markets-program";
import { buildCloseTokenAccountInstruction, buildCreateAssociatedTokenInstruction, buildInitializeTokenAccountInstruction, buildSyncNativeInstruction, buildTransferCheckedInstruction, buildUnwrapNativeInstruction, deriveAssociatedTokenAddress, NATIVE_MINT } from "@/lib/token-instructions";
import { parseTokenAmount } from "@/lib/token-amounts";
import { readPreparationBody, RequestSizeError } from "@/lib/preparation-body";

export const dynamic = "force-dynamic";

async function readState(marketAddress: PublicKey) {
  const protocol = await readVerifiedProtocol(cookieChainConnection);
  if (!protocol) throw new Error("Protocol is not deployed.");
  const marketInfo = await cookieChainConnection.getAccountInfo(marketAddress, "confirmed");
  if (!marketInfo) throw new Error("Market was not found.");
  const market = decodeMarketAccount(marketAddress, marketInfo);
  if (market.collateralMint !== protocol.collateralMint) throw new Error("Market collateral does not match the protocol.");
  const addresses = deriveAmmAddresses(marketAddress);
  const [poolInfo, accountingInfo] = await cookieChainConnection.getMultipleAccountsInfo([addresses.pool, addresses.accounting], "confirmed");
  if (!poolInfo || !accountingInfo) throw new Error("This market does not have complete AMM accounting yet.");
  const pool = decodeAmmPool(addresses.pool, poolInfo);
  const accounting = decodeMarketAccounting(addresses.accounting, marketAddress, accountingInfo);
  if (pool.market !== market.address || pool.creator !== market.creator) throw new Error("Pool identity does not match the market.");
  return { protocol, market, pool, accounting, addresses };
}

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get("market");
    if (!value) return NextResponse.json({ error: "Provide a market address." }, { status: 400 });
    const state = await readState(new PublicKey(value));
    const yesBps = ammProbabilityBps(state.pool.yesReserve, state.pool.noReserve);
    return NextResponse.json({
      market: state.market.address,
      creator: state.market.creator,
      collateralMint: state.market.collateralMint,
      yesMint: state.market.yesMint,
      noMint: state.market.noMint,
      vault: state.market.vault,
      status: state.market.status,
      outcome: state.market.outcome,
      closesAt: state.market.closesAt,
      decimals: state.protocol.collateralDecimals,
      liquidity: state.pool.liquidity.toString(),
      yesReserve: state.pool.yesReserve.toString(),
      noReserve: state.pool.noReserve.toString(),
      yesPercent: yesBps / 100,
      noPercent: (10_000 - yesBps) / 100,
      maximumTrade: maximumAmmTrade(state.pool.liquidity).toString(),
      liquidityProviderFeeBps: state.protocol.liquidityProviderFeeBps,
      ownerFeeBps: state.protocol.ownerFeeBps,
      ownerFeeRecipient: state.protocol.ownerFeeRecipient,
      totalCreatorFees: state.pool.totalCreatorFees.toString(),
      settlementClaimed: state.pool.settlementClaimed,
      creatorClaimable: (creatorClaimable(state.market.outcome, state.pool.yesReserve, state.pool.noReserve) + (state.pool.deferredFees ? state.pool.totalCreatorFees : BigInt(0))).toString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the pool." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  try {
    const body = JSON.parse(await readPreparationBody(request)) as Record<string, unknown>;
    if (typeof body.market !== "string" || typeof body.user !== "string") return NextResponse.json({ error: "Provide the market and wallet." }, { status: 400 });
    const marketAddress = new PublicKey(body.market);
    const user = new PublicKey(body.user);
    const state = await readState(marketAddress);
    const collateralMint = new PublicKey(state.market.collateralMint);
    const yesMint = new PublicKey(state.market.yesMint);
    const noMint = new PublicKey(state.market.noMint);
    const vault = new PublicKey(state.market.vault);
    const creator = new PublicKey(state.market.creator);
    const userCollateral = deriveAssociatedTokenAddress(collateralMint, user);
    const userYes = deriveAssociatedTokenAddress(yesMint, user);
    const userNo = deriveAssociatedTokenAddress(noMint, user);
    const creatorCollateral = deriveAssociatedTokenAddress(collateralMint, creator);
    const instructions = [];
    let quote;

    if (body.action === "buy") {
      if (state.market.status !== "open" || Number(state.market.closesAt) * 1_000 <= Date.now()) return NextResponse.json({ error: "Trading is closed." }, { status: 409 });
      if (body.side !== "yes" && body.side !== "no") return NextResponse.json({ error: "Choose YES or NO." }, { status: 400 });
      if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount) || body.amount === "0") return NextResponse.json({ error: "Enter a whole number of shares." }, { status: 400 });
      const sharesOut = parseTokenAmount(body.amount, state.protocol.collateralDecimals);
      quote = quoteWholeShares(body.side, sharesOut, state.pool.liquidity, state.pool.yesReserve, state.pool.noReserve, state.protocol.liquidityProviderFeeBps, state.protocol.ownerFeeBps);
      instructions.push(
        buildCreateAssociatedTokenInstruction(user, collateralMint),
        buildCreateAssociatedTokenInstruction(user, yesMint),
        buildCreateAssociatedTokenInstruction(user, noMint),
      );
      if (collateralMint.equals(NATIVE_MINT)) instructions.push(
        SystemProgram.transfer({ fromPubkey: user, toPubkey: userCollateral, lamports: quote.grossInput }),
        buildSyncNativeInstruction(userCollateral),
      );
      instructions.push(await buildBuyFromAmmInstruction({
        market: marketAddress, creator, collateralMint, yesMint, noMint, vault,
        buyerCollateral: userCollateral, buyerYes: userYes, buyerNo: userNo,
        buyer: user, side: body.side, sharesOut, maximumTotalInput: quote.maximumTotalInput,
      }));
    } else if (body.action === "claimCreator") {
      if (!user.equals(creator)) return NextResponse.json({ error: "Only this market’s creator can claim the remaining pool settlement." }, { status: 403 });
      if (state.market.status !== "resolved" || state.market.outcome === "unresolved") return NextResponse.json({ error: "Settlement is not final yet." }, { status: 409 });
      if (state.pool.settlementClaimed) return NextResponse.json({ error: "The creator settlement was already claimed." }, { status: 409 });
      instructions.push(buildCreateAssociatedTokenInstruction(creator, collateralMint));
      const ownerFeeRecipient = new PublicKey(state.protocol.ownerFeeRecipient);
      let ownerFeeCollateral = deriveAssociatedTokenAddress(collateralMint, ownerFeeRecipient);
      const combinedRecipient = ownerFeeRecipient.equals(creator);
      if (combinedRecipient) {
        const seed = `cm-owner-fee-${marketAddress.toBase58().slice(0, 19)}`;
        ownerFeeCollateral = await PublicKey.createWithSeed(creator, seed, TOKEN_PROGRAM_ID);
        if (await cookieChainConnection.getAccountInfo(ownerFeeCollateral, "confirmed")) throw new Error("Temporary owner-fee account is unexpectedly occupied.");
        instructions.push(
          SystemProgram.createAccountWithSeed({
            fromPubkey: user,
            newAccountPubkey: ownerFeeCollateral,
            basePubkey: creator,
            seed,
            lamports: await cookieChainConnection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
          }),
          buildInitializeTokenAccountInstruction(ownerFeeCollateral, collateralMint, creator),
        );
      } else {
        instructions.push(buildCreateAssociatedTokenInstruction(ownerFeeRecipient, collateralMint, user, true));
      }
      instructions.push(await buildClaimAmmSettlementInstruction({ market: marketAddress, collateralMint, yesMint, noMint, vault, creatorCollateral, ownerFeeCollateral, creator }));
      if (combinedRecipient) {
        if (state.accounting.accruedOwnerFees > BigInt(0)) instructions.push(buildTransferCheckedInstruction(ownerFeeCollateral, collateralMint, creatorCollateral, creator, state.accounting.accruedOwnerFees, state.protocol.collateralDecimals));
        instructions.push(buildCloseTokenAccountInstruction(ownerFeeCollateral, creator, creator));
      }
      if (collateralMint.equals(NATIVE_MINT)) instructions.push(buildUnwrapNativeInstruction(creator));
    } else {
      return NextResponse.json({ error: "Choose buy or creator settlement claim." }, { status: 400 });
    }

    const latest = await cookieChainConnection.getLatestBlockhashAndContext("confirmed");
    const transaction = new Transaction({ feePayer: user, ...latest.value }).add(...instructions);
    const message = transaction.compileMessage();
    const simulation = await cookieChainConnection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, commitment: "confirmed", minContextSlot: latest.context.slot });
    if (simulation.value.err) return NextResponse.json({ error: "Transaction simulation failed. Nothing was signed or sent.", simulationError: simulation.value.err, logs: simulation.value.logs?.slice(-15) }, { status: 409 });
    const fee = await cookieChainConnection.getFeeForMessage(message, "confirmed");
    return NextResponse.json({
      unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      genesisHash: COOKIE_CHAIN.genesisHash,
      feePayer: user.toBase58(),
      blockhash: latest.value.blockhash,
      lastValidBlockHeight: latest.value.lastValidBlockHeight,
      feeBaseUnits: fee.value?.toString() ?? "0",
      quote: quote ? Object.fromEntries(Object.entries(quote).map(([key, value]) => [key, value.toString()])) : undefined,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare this transaction." }, { status: error instanceof RequestSizeError ? 413 : error instanceof SyntaxError || error instanceof RangeError ? 400 : 503 });
  }
}
