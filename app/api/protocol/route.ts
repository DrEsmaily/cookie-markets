import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { cookieChainConnection } from "@/lib/cookie-chain";
import {
  COOKIE_MARKETS_PROGRAM_ID,
  deriveConfigAddress,
  deriveMarketAddresses,
} from "@/lib/cookie-markets-program";

export const dynamic = "force-dynamic";

const CONFIG_SIZE = 147;

export async function GET(request: Request) {
  try {
    const configAddress = deriveConfigAddress();
    if (new URL(request.url).searchParams.get("markets") === "true") {
      const discriminator = createHash("sha256").update("account:Market").digest().subarray(0, 8);
      const accounts = await cookieChainConnection.getProgramAccounts(COOKIE_MARKETS_PROGRAM_ID, {
        filters: [{ dataSize: 307 }],
      });
      const markets = accounts.flatMap(({ pubkey, account }) => {
        const data = account.data;
        if (!account.owner.equals(COOKIE_MARKETS_PROGRAM_ID) || !data.subarray(0, 8).equals(discriminator)) return [];
        const creator = new PublicKey(data.subarray(8, 40));
        const nonce = data.readBigUInt64LE(40);
        const addresses = deriveMarketAddresses(creator, nonce);
        if (!addresses.market.equals(pubkey)) return [];
        const status = ["draft", "open", "locked", "proposed", "resolved"][data[296]];
        const outcome = ["unresolved", "yes", "no", "invalid"][data[297]];
        if (!status || !outcome) return [];
        return [{
          address: pubkey.toBase58(),
          creator: creator.toBase58(),
          nonce: nonce.toString(),
          collateralMint: publicKeyAt(data, 48),
          yesMint: publicKeyAt(data, 80),
          noMint: publicKeyAt(data, 112),
          vault: publicKeyAt(data, 144),
          resolver: publicKeyAt(data, 176),
          questionHash: data.subarray(208, 240).toString("hex"),
          rulesHash: data.subarray(240, 272).toString("hex"),
          closesAt: data.readBigInt64LE(272).toString(),
          resolveAfter: data.readBigInt64LE(280).toString(),
          createdAt: data.readBigInt64LE(288).toString(),
          status,
          outcome,
          outstandingSets: data.readBigUInt64LE(298).toString(),
        }];
      });
      return NextResponse.json({ markets });
    }
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
