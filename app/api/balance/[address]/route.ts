import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { cookieChainConnection } from "@/lib/cookie-chain";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const publicKey = new PublicKey(address);
    const baseUnits = await cookieChainConnection.getBalance(publicKey, "confirmed");
    const amount = baseUnits / 10 ** COOKIE_CHAIN.currency.decimals;

    return NextResponse.json({ amount, symbol: COOKIE_CHAIN.currency.symbol });
  } catch {
    return NextResponse.json({ error: "Unable to read this Cookie Chain balance." }, { status: 400 });
  }
}
