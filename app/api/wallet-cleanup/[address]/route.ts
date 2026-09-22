import { NextResponse } from "next/server";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { decodeMarketAccount } from "@/lib/protocol-accounts";
import { hidesObsoletePosition } from "@/lib/legacy-market-visibility";
import { buildBurnCheckedInstruction, buildCloseTokenAccountInstruction, deriveAssociatedTokenAddress } from "@/lib/token-instructions";
import { COOKIE_MARKETS_PROGRAM_ID } from "@/lib/cookie-markets-program";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const user = new PublicKey((await params).address);
    if (!PublicKey.isOnCurve(user.toBytes())) throw new Error();
    const instructions = [];
    let accounts = 0;
    const markets = await cookieChainConnection.getProgramAccounts(COOKIE_MARKETS_PROGRAM_ID, { commitment: "confirmed", filters: [{ dataSize: 307 }] });
    for (const { pubkey, account } of markets) {
      if (accounts >= 6) break;
      const market = decodeMarketAccount(pubkey, account);
      if (market.status !== "resolved") continue;
      const sides = await Promise.all([market.yesMint, market.noMint].map(async (mintText) => {
        const mint = new PublicKey(mintText);
        const tokenAccount = deriveAssociatedTokenAddress(mint, user);
        try {
          const balance = await cookieChainConnection.getTokenAccountBalance(tokenAccount, "confirmed");
          return { mint, tokenAccount, amount: BigInt(balance.value.amount), decimals: balance.value.decimals };
        } catch { return undefined; }
      }));
      const yes = sides[0]?.amount ?? BigInt(0);
      const no = sides[1]?.amount ?? BigInt(0);
      const obsolete = hidesObsoletePosition(market.address);
      const safe = obsolete
        || (market.outcome === "yes" && yes === BigInt(0))
        || (market.outcome === "no" && no === BigInt(0))
        || (market.outcome === "invalid" && yes === BigInt(0) && no === BigInt(0));
      if (!safe) continue;
      for (const side of sides) {
        if (!side) continue;
        if (side.amount > BigInt(0)) instructions.push(buildBurnCheckedInstruction(side.tokenAccount, side.mint, user, side.amount, side.decimals));
        instructions.push(buildCloseTokenAccountInstruction(side.tokenAccount, user, user));
        accounts += 1;
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
