import { NextResponse } from "next/server";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { cookieChainConnection } from "@/lib/cookie-chain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [slot, genesisHash] = await Promise.all([
      cookieChainConnection.getSlot(),
      cookieChainConnection.getGenesisHash()
    ]);

    return NextResponse.json({
      healthy: genesisHash === COOKIE_CHAIN.genesisHash,
      slot,
      genesisHash,
      checkedAt: new Date().toISOString()
    });
  } catch {
    return NextResponse.json(
      { healthy: false, error: "Cookie Chain RPC is currently unavailable." },
      { status: 503 }
    );
  }
}
