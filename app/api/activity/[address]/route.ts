import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { UI_LAUNCH_UNIX_SECONDS } from "@/lib/ui-launch";
import { NATIVE_MINT } from "@/lib/token-instructions";

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
        const nativeChange = walletIndex >= 0 && transaction?.meta ? BigInt(transaction.meta.postBalances[walletIndex]) - BigInt(transaction.meta.preBalances[walletIndex]) : BigInt(0);
        const tokenAmount = (balance: { owner?: string; mint: string; uiTokenAmount: { amount: string } }) => balance.owner === address && balance.mint === NATIVE_MINT.toBase58() ? BigInt(balance.uiTokenAmount.amount) : BigInt(0);
        const wrappedBefore = transaction?.meta?.preTokenBalances?.reduce((total, balance) => total + tokenAmount(balance), BigInt(0)) ?? BigInt(0);
        const wrappedAfter = transaction?.meta?.postTokenBalances?.reduce((total, balance) => total + tokenAmount(balance), BigInt(0)) ?? BigInt(0);
        const wrappedChange = wrappedAfter - wrappedBefore;
        const settlement = transaction?.meta?.logMessages?.some((message) => message.includes("Instruction: ClaimAmmSettlement")) ?? false;
        const amount = nativeChange !== BigInt(0) ? nativeChange : wrappedChange;
        const label = err
          ? "Failed · no funds moved"
          : settlement && amount > BigInt(0)
            ? wrappedChange > BigInt(0) && nativeChange === BigInt(0) ? "Platform fee received" : "Market settlement claimed"
            : amount === BigInt(0) ? "Confirmed on-chain" : undefined;
        return {
        signature,
        slot,
        blockTime,
        status: err ? "failed" : "confirmed",
        amountBaseUnits: amount.toString(),
        asset: nativeChange === BigInt(0) && wrappedChange !== BigInt(0) ? "wrapped COOK" : "COOK",
        label,
      }; })
    });
  } catch {
    return NextResponse.json({ error: "Unable to read activity for this address." }, { status: 400 });
  }
}
