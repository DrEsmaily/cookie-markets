import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { UI_LAUNCH_UNIX_SECONDS } from "@/lib/ui-launch";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const publicKey = new PublicKey(address);
    const signatures = (await cookieChainConnection.getSignaturesForAddress(publicKey, { limit: 20 }, "confirmed"))
      .filter(({ blockTime }) => blockTime != null && BigInt(blockTime) >= UI_LAUNCH_UNIX_SECONDS)
      .slice(0, 3);
    const transactions = await cookieChainConnection.getTransactions(signatures.map(({ signature }) => signature), { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

    return NextResponse.json({
      activity: signatures.map(({ signature, slot, blockTime, err }, index) => {
        const transaction = transactions[index];
        const walletIndex = transaction?.transaction.message.staticAccountKeys.findIndex((key) => key.equals(publicKey)) ?? -1;
        const change = walletIndex >= 0 && transaction?.meta ? BigInt(transaction.meta.postBalances[walletIndex]) - BigInt(transaction.meta.preBalances[walletIndex]) : BigInt(0);
        return {
        signature,
        slot,
        blockTime,
        status: err ? "failed" : "confirmed",
        amountBaseUnits: change.toString(),
      }; })
    });
  } catch {
    return NextResponse.json({ error: "Unable to read activity for this address." }, { status: 400 });
  }
}
