import { Connection, PublicKey } from "@solana/web3.js";
import { COOKIE_CHAIN } from "./cookie-chain-config";
import { COOKIE_MARKETS_PROGRAM_ID, TOKEN_PROGRAM_ID, deriveConfigAddress } from "./cookie-markets-program";
import { decodeAskOrder, decodeBidOrder, decodeProtocolConfig, VerifiedMarket } from "./protocol-accounts";
import { quoteOrderFill } from "./trading-math";

export async function readVerifiedProtocol(connection: Pick<Connection, "getGenesisHash" | "getAccountInfo">) {
  const configAddress = deriveConfigAddress();
  const [genesisHash, program, account] = await Promise.all([
    connection.getGenesisHash(),
    connection.getAccountInfo(COOKIE_MARKETS_PROGRAM_ID),
    connection.getAccountInfo(configAddress),
  ]);
  if (genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("RPC genesis hash does not match Cookie Chain.");
  if (!account) return null;
  if (!program?.executable) throw new Error("Protocol program is not executable.");
  const config = decodeProtocolConfig(configAddress, account);
  const mint = await connection.getAccountInfo(new PublicKey(config.collateralMint));
  if (!mint || !mint.owner.equals(TOKEN_PROGRAM_ID) || mint.data.length !== 82 || mint.data[45] !== 1) {
    throw new Error("Approved collateral is not an initialized SPL mint.");
  }
  return { ...config, collateralDecimals: mint.data[44] };
}

export async function readVerifiedAsks(
  connection: Pick<Connection, "getProgramAccounts" | "getMultipleAccountsInfo">,
  market: VerifiedMarket,
) {
  const accounts = await connection.getProgramAccounts(COOKIE_MARKETS_PROGRAM_ID, {
    commitment: "confirmed", filters: [{ dataSize: 181 }, { memcmp: { offset: 8, bytes: market.address } }],
  });
  if (accounts.length > 1000) throw new Error("Too many ask orders for this discovery endpoint.");
  const orders = accounts.map(({ pubkey, account }) => decodeAskOrder(pubkey, account, market));
  for (let offset = 0; offset < orders.length; offset += 100) {
    const batch = orders.slice(offset, offset + 100);
    const escrows = await connection.getMultipleAccountsInfo(batch.map((order) => new PublicKey(order.escrow)), "confirmed");
    if (escrows.length !== batch.length) throw new Error("Incomplete escrow response.");
    for (const [index, order] of batch.entries()) {
      const escrow = escrows[index];
      if (!escrow || !escrow.owner.equals(TOKEN_PROGRAM_ID) || escrow.data.length !== 165
        || escrow.data[108] !== 1
        || !new PublicKey(escrow.data.subarray(0, 32)).equals(new PublicKey(order.shareMint))
        || !new PublicKey(escrow.data.subarray(32, 64)).equals(new PublicKey(order.address))
        || (!order.cancelled && escrow.data.readBigUInt64LE(64) < BigInt(order.remainingShares))) {
        throw new Error("Ask escrow custody or balance is invalid.");
      }
    }
  }
  return orders.sort((first, second) => {
    const firstPrice = BigInt(first.price);
    const secondPrice = BigInt(second.price);
    return firstPrice < secondPrice ? -1 : firstPrice > secondPrice ? 1 : first.address.localeCompare(second.address);
  });
}

export async function readVerifiedBids(
  connection: Pick<Connection, "getProgramAccounts" | "getMultipleAccountsInfo">,
  market: VerifiedMarket,
) {
  const accounts = await connection.getProgramAccounts(COOKIE_MARKETS_PROGRAM_ID, {
    commitment: "confirmed", filters: [{ dataSize: 213 }, { memcmp: { offset: 8, bytes: market.address } }],
  });
  if (accounts.length > 1000) throw new Error("Too many bid orders for this discovery endpoint.");
  const orders = accounts.map(({ pubkey, account }) => decodeBidOrder(pubkey, account, market));
  for (let offset = 0; offset < orders.length; offset += 100) {
    const batch = orders.slice(offset, offset + 100);
    const escrows = await connection.getMultipleAccountsInfo(batch.map((order) => new PublicKey(order.escrow)), "confirmed");
    if (escrows.length !== batch.length) throw new Error("Incomplete escrow response.");
    for (const [index, order] of batch.entries()) {
      const remaining = BigInt(order.remainingShares);
      const quote = (shares: bigint) => shares === BigInt(0) ? BigInt(0) : quoteOrderFill({
        totalShares: BigInt(order.totalShares), filledShares: BigInt(0),
        fillShares: shares, price: BigInt(order.price), feeBps: order.feeBps,
      }).buyerDebit;
      const required = order.cancelled || remaining === BigInt(0) ? BigInt(0)
        : quote(BigInt(order.totalShares)) - quote(BigInt(order.filledShares));
      const escrow = escrows[index];
      if (!escrow || !escrow.owner.equals(TOKEN_PROGRAM_ID) || escrow.data.length !== 165
        || escrow.data[108] !== 1
        || !new PublicKey(escrow.data.subarray(0, 32)).equals(new PublicKey(order.collateralMint))
        || !new PublicKey(escrow.data.subarray(32, 64)).equals(new PublicKey(order.address))
        || escrow.data.readBigUInt64LE(64) < required) {
        throw new Error("Bid escrow custody or balance is invalid.");
      }
    }
  }
  return orders.sort((first, second) => {
    const firstPrice = BigInt(first.price);
    const secondPrice = BigInt(second.price);
    return firstPrice > secondPrice ? -1 : firstPrice < secondPrice ? 1 : first.address.localeCompare(second.address);
  });
}
