import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { cookieChainConnection } from "@/lib/cookie-chain";

export const dynamic = "force-dynamic";

const COOK_REGISTRY_URL = "https://api.cookiescan.io/v1/assets/resolve?ref=COOK";

export async function GET() {
  try {
    const [slot, genesisHash, wrappedCookMint] = await Promise.all([
      cookieChainConnection.getSlot(),
      cookieChainConnection.getGenesisHash(),
      resolveWrappedCookMint(),
    ]);

    return NextResponse.json({
      healthy: genesisHash === COOKIE_CHAIN.genesisHash,
      slot,
      genesisHash,
      wrappedCookMint,
      checkedAt: new Date().toISOString()
    });
  } catch {
    return NextResponse.json(
      { healthy: false, error: "Cookie Chain RPC is currently unavailable." },
      { status: 503 }
    );
  }
}

async function resolveWrappedCookMint(): Promise<string> {
  const response = await fetch(COOK_REGISTRY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Cookiescan asset registry is unavailable.");
  const registry = await response.json() as {
    asset?: { variants?: Array<{ mint?: string; symbol?: string; kind?: string }> };
  };
  const wrapped = registry.asset?.variants?.find(
    (variant) => variant.kind === "wrapped" && variant.symbol === "wCOOK",
  );
  if (!wrapped?.mint) throw new Error("Canonical wrapped COOK was not found.");
  return new PublicKey(wrapped.mint).toBase58();
}
