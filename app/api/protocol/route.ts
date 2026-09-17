import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { cookieChainConnection } from "@/lib/cookie-chain";
import {
  COOKIE_MARKETS_PROGRAM_ID,
  deriveConfigAddress,
} from "@/lib/cookie-markets-program";

export const dynamic = "force-dynamic";

const CONFIG_SIZE = 147;

export async function GET() {
  try {
    const configAddress = deriveConfigAddress();
    const account = await cookieChainConnection.getAccountInfo(configAddress);
    if (!account) {
      return NextResponse.json({ deployed: false, configAddress: configAddress.toBase58() });
    }
    if (!account.owner.equals(COOKIE_MARKETS_PROGRAM_ID)) {
      throw new Error("Protocol config has an unexpected owner.");
    }
    if (account.data.length < CONFIG_SIZE) {
      throw new Error("Protocol config is shorter than expected.");
    }

    const expectedDiscriminator = createHash("sha256")
      .update("account:ProtocolConfig")
      .digest()
      .subarray(0, 8);
    if (!account.data.subarray(0, 8).equals(expectedDiscriminator)) {
      throw new Error("Protocol config discriminator is invalid.");
    }

    return NextResponse.json({
      deployed: true,
      configAddress: configAddress.toBase58(),
      admin: publicKeyAt(account.data, 8),
      feeRecipient: publicKeyAt(account.data, 40),
      resolver: publicKeyAt(account.data, 72),
      collateralMint: publicKeyAt(account.data, 104),
      feeBps: account.data.readUInt16LE(136),
      challengePeriod: Number(account.data.readBigInt64LE(138)),
    });
  } catch (error) {
    return NextResponse.json(
      {
        deployed: false,
        error: error instanceof Error ? error.message : "Could not read protocol config.",
      },
      { status: 503 },
    );
  }
}

function publicKeyAt(data: Buffer, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}
