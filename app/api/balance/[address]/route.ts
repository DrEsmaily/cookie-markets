import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { deriveAssociatedTokenAddress, NATIVE_MINT } from "@/lib/token-instructions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const publicKey = new PublicKey(address);
    const baseUnits = await cookieChainConnection.getBalance(publicKey, "confirmed");
    const amount = baseUnits / 10 ** COOKIE_CHAIN.currency.decimals;
    let wrappedBaseUnits = BigInt(0);
    try {
      wrappedBaseUnits = BigInt((await cookieChainConnection.getTokenAccountBalance(deriveAssociatedTokenAddress(NATIVE_MINT, publicKey), "confirmed")).value.amount);
    } catch { /* the wallet has no wrapped COOK account */ }

    return NextResponse.json({ amount, wrappedBaseUnits: wrappedBaseUnits.toString(), symbol: COOKIE_CHAIN.currency.symbol });
  } catch {
    return NextResponse.json({ error: "Unable to read this Cookie Chain balance." }, { status: 400 });
  }
}
