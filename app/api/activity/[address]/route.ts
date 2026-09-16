import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const publicKey = new PublicKey(address);
    const signatures = await cookieChainConnection.getSignaturesForAddress(publicKey, { limit: 5 }, "confirmed");

    return NextResponse.json({
      activity: signatures.map(({ signature, slot, blockTime, err }) => ({
        signature,
        slot,
        blockTime,
        status: err ? "failed" : "confirmed"
      }))
    });
  } catch {
    return NextResponse.json({ error: "Unable to read activity for this address." }, { status: 400 });
  }
}
