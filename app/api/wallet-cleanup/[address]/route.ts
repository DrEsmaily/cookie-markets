import { NextResponse } from "next/server";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { HIDDEN_LEGACY_MARKETS } from "@/lib/legacy-market-visibility";
import { buildBurnCheckedInstruction, buildCloseTokenAccountInstruction, deriveAssociatedTokenAddress } from "@/lib/token-instructions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const user = new PublicKey((await params).address);
    if (!PublicKey.isOnCurve(user.toBytes())) throw new Error();
    const instructions = [];
    let accounts = 0;
    for (const marketText of HIDDEN_LEGACY_MARKETS) {
      const marketAddress = new PublicKey(marketText);
      const marketAccount = await cookieChainConnection.getAccountInfo(marketAddress, "confirmed");
      if (!marketAccount) continue;
      const market = decodeMarketAccount(marketAddress, marketAccount);
      for (const mintText of [market.yesMint, market.noMint]) {
        const mint = new PublicKey(mintText);
        const tokenAccount = deriveAssociatedTokenAddress(mint, user);
        try {
          const balance = await cookieChainConnection.getTokenAccountBalance(tokenAccount, "confirmed");
          const amount = BigInt(balance.value.amount);
          if (amount > BigInt(0)) instructions.push(buildBurnCheckedInstruction(tokenAccount, mint, user, amount, balance.value.decimals));
          instructions.push(buildCloseTokenAccountInstruction(tokenAccount, user, user));
          accounts += 1;
        } catch { /* this wallet has no token account for this legacy market side */ }
      }
    }
    if (accounts === 0) return NextResponse.json({ accounts: 0 });
    const latest = await cookieChainConnection.getLatestBlockhashAndContext("confirmed");
    const transaction = new Transaction({ feePayer: user, ...latest.value }).add(...instructions);
    const simulation = await cookieChainConnection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, commitment: "confirmed", minContextSlot: latest.context.slot });
    if (simulation.value.err) return NextResponse.json({ error: "Legacy-token cleanup simulation failed.", logs: simulation.value.logs?.slice(-12) }, { status: 409 });
    return NextResponse.json({
      accounts,
      unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      feePayer: user.toBase58(),
      blockhash: latest.value.blockhash,
      lastValidBlockHeight: latest.value.lastValidBlockHeight,
    });
  } catch {
    return NextResponse.json({ error: "Unable to prepare legacy-token cleanup." }, { status: 400 });
  }
}
