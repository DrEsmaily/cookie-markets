import { createHash } from "node:crypto";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { COOKIE_MARKETS_PROGRAM_ID, deriveConfigAddress, deriveMarketAddresses } from "./cookie-markets-program";

type ProgramAccount = Pick<AccountInfo<Buffer>, "owner" | "data">;

function verifiedData(account: ProgramAccount, name: string, size: number): Buffer {
  if (!account.owner.equals(COOKIE_MARKETS_PROGRAM_ID)) throw new Error(`${name} has an unexpected owner.`);
  if (account.data.length !== size) throw new Error(`${name} has an unexpected size.`);
  const discriminator = createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
  if (!account.data.subarray(0, 8).equals(discriminator)) throw new Error(`${name} discriminator is invalid.`);
  return account.data;
}

function keyAt(data: Buffer, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

export function decodeProtocolConfig(address: PublicKey, account: ProgramAccount) {
  const data = verifiedData(account, "ProtocolConfig", 147);
  const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], COOKIE_MARKETS_PROGRAM_ID);
  if (!expected.equals(address) || data[146] !== bump) throw new Error("Protocol config PDA is invalid.");
  const feeBps = data.readUInt16LE(136);
  const challengePeriod = data.readBigInt64LE(138);
  if (feeBps > 1000 || challengePeriod <= BigInt(0)) throw new Error("Protocol limits are invalid.");
  return { configAddress: deriveConfigAddress().toBase58(), admin: keyAt(data, 8), feeRecipient: keyAt(data, 40), resolver: keyAt(data, 72), collateralMint: keyAt(data, 104), feeBps, challengePeriod: challengePeriod.toString() };
}

export function decodeMarketAccount(address: PublicKey, account: ProgramAccount) {
  const data = verifiedData(account, "Market", 307);
  const creator = new PublicKey(data.subarray(8, 40));
  const nonce = data.readBigUInt64LE(40);
  const addresses = deriveMarketAddresses(creator, nonce);
  const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), data.subarray(40, 48)], COOKIE_MARKETS_PROGRAM_ID);
  if (!expected.equals(address) || data[306] !== bump) throw new Error("Market PDA is invalid.");
  for (const [key, offset] of [[addresses.yesMint, 80], [addresses.noMint, 112], [addresses.vault, 144]] as const) {
    if (!key.equals(new PublicKey(data.subarray(offset, offset + 32)))) throw new Error("Market custody address is invalid.");
  }
  const status = (["draft", "open", "locked", "proposed", "resolved"] as const)[data[296]];
  const outcome = (["unresolved", "yes", "no", "invalid"] as const)[data[297]];
  if (!status || !outcome || (status === "resolved") !== (outcome !== "unresolved")) throw new Error("Market state is invalid.");
  const closesAt = data.readBigInt64LE(272);
  const resolveAfter = data.readBigInt64LE(280);
  if (resolveAfter < closesAt) throw new Error("Market schedule is invalid.");
  return {
    address: address.toBase58(), creator: creator.toBase58(), nonce: nonce.toString(),
    collateralMint: keyAt(data, 48), yesMint: keyAt(data, 80), noMint: keyAt(data, 112), vault: keyAt(data, 144), resolver: keyAt(data, 176), resolution: addresses.resolution.toBase58(),
    questionHash: data.subarray(208, 240).toString("hex"), rulesHash: data.subarray(240, 272).toString("hex"),
    closesAt: closesAt.toString(), resolveAfter: resolveAfter.toString(), createdAt: data.readBigInt64LE(288).toString(),
    status, outcome, outstandingSets: data.readBigUInt64LE(298).toString(),
  };
}

export type VerifiedMarket = ReturnType<typeof decodeMarketAccount>;
