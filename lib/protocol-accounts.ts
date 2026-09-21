import { createHash } from "node:crypto";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { COOKIE_MARKETS_PROGRAM_ID, deriveAskAddresses, deriveBidAddresses, deriveConfigAddress, deriveMarketAddresses } from "./cookie-markets-program";

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
  if (account.data.length !== 147 && account.data.length !== 149) throw new Error("ProtocolConfig has an unexpected size.");
  const data = verifiedData(account, "ProtocolConfig", account.data.length);
  const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], COOKIE_MARKETS_PROGRAM_ID);
  if (!expected.equals(address) || data[146] !== bump) throw new Error("Protocol config PDA is invalid.");
  const liquidityProviderFeeBps = data.readUInt16LE(136);
  const ownerFeeBps = data.length === 149 ? data.readUInt16LE(147) : 0;
  const challengePeriod = data.readBigInt64LE(138);
  if (liquidityProviderFeeBps > 1000 || ownerFeeBps > 1000 || challengePeriod < BigInt(0)) throw new Error("Protocol limits are invalid.");
  return { configAddress: deriveConfigAddress().toBase58(), admin: keyAt(data, 8), ownerFeeRecipient: keyAt(data, 40), feeRecipient: keyAt(data, 40), resolver: keyAt(data, 72), collateralMint: keyAt(data, 104), liquidityProviderFeeBps, ownerFeeBps, feeBps: liquidityProviderFeeBps, challengePeriod: challengePeriod.toString(), migrated: data.length === 149 };
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

export function decodeAskOrder(address: PublicKey, account: ProgramAccount, market: VerifiedMarket) {
  const data = verifiedData(account, "AskOrder", 181);
  const maker = new PublicKey(data.subarray(40, 72));
  const nonce = data.readBigUInt64LE(136);
  const addresses = deriveAskAddresses(new PublicKey(market.address), maker, nonce);
  if (keyAt(data, 8) !== market.address || !addresses.order.equals(address)
    || data[179] !== addresses.bump || data[180] !== addresses.escrowBump) {
    throw new Error("Ask order PDA or market is invalid.");
  }
  const shareMint = keyAt(data, 72);
  if (shareMint !== market.yesMint && shareMint !== market.noMint) throw new Error("Ask outcome mint is invalid.");
  const totalShares = data.readBigUInt64LE(144);
  const filledShares = data.readBigUInt64LE(152);
  const price = data.readBigUInt64LE(160);
  const expiresAt = data.readBigInt64LE(168);
  const feeBps = data.readUInt16LE(176);
  if (totalShares === BigInt(0) || filledShares > totalShares || price === BigInt(0)
    || price > BigInt(1_000_000) || feeBps > 1000 || data[178] > 1
    || expiresAt <= BigInt(0) || expiresAt > BigInt(market.closesAt)) {
    throw new Error("Ask order limits are invalid.");
  }
  return {
    address: address.toBase58(), market: market.address, maker: maker.toBase58(),
    shareMint, side: shareMint === market.yesMint ? "yes" as const : "no" as const,
    escrow: addresses.escrow.toBase58(), feeRecipient: keyAt(data, 104), feeBps,
    nonce: nonce.toString(), totalShares: totalShares.toString(), filledShares: filledShares.toString(),
    remainingShares: (totalShares - filledShares).toString(), price: price.toString(),
    expiresAt: expiresAt.toString(), cancelled: data[178] === 1,
  };
}

export type VerifiedAsk = ReturnType<typeof decodeAskOrder>;

export function decodeBidOrder(address: PublicKey, account: ProgramAccount, market: VerifiedMarket) {
  const data = verifiedData(account, "BidOrder", 213);
  const maker = new PublicKey(data.subarray(40, 72));
  const nonce = data.readBigUInt64LE(168);
  const addresses = deriveBidAddresses(new PublicKey(market.address), maker, nonce);
  if (keyAt(data, 8) !== market.address || !addresses.order.equals(address)
    || data[211] !== addresses.bump || data[212] !== addresses.escrowBump) {
    throw new Error("Bid order PDA or market is invalid.");
  }
  const shareMint = keyAt(data, 72);
  if (shareMint !== market.yesMint && shareMint !== market.noMint) throw new Error("Bid outcome mint is invalid.");
  if (keyAt(data, 104) !== market.collateralMint) throw new Error("Bid collateral mint is invalid.");
  const totalShares = data.readBigUInt64LE(176);
  const filledShares = data.readBigUInt64LE(184);
  const price = data.readBigUInt64LE(192);
  const expiresAt = data.readBigInt64LE(200);
  const feeBps = data.readUInt16LE(208);
  const maximum = BigInt("18446744073709551615");
  const collateral = (totalShares * price + BigInt(999999)) / BigInt(1_000_000);
  const fee = (collateral * BigInt(feeBps) + BigInt(9999)) / BigInt(10000);
  if (totalShares === BigInt(0) || filledShares > totalShares || price === BigInt(0)
    || price > BigInt(1_000_000) || feeBps > 1000 || data[210] > 1
    || expiresAt <= BigInt(0) || expiresAt > BigInt(market.closesAt) || collateral + fee > maximum) {
    throw new Error("Bid order limits are invalid.");
  }
  return {
    address: address.toBase58(), market: market.address, maker: maker.toBase58(),
    collateralMint: market.collateralMint, shareMint,
    side: shareMint === market.yesMint ? "yes" as const : "no" as const,
    escrow: addresses.escrow.toBase58(), feeRecipient: keyAt(data, 136), feeBps,
    nonce: nonce.toString(), totalShares: totalShares.toString(), filledShares: filledShares.toString(),
    remainingShares: (totalShares - filledShares).toString(), price: price.toString(),
    expiresAt: expiresAt.toString(), cancelled: data[210] === 1,
  };
}

export type VerifiedBid = ReturnType<typeof decodeBidOrder>;
