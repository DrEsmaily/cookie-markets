import { Connection, PublicKey } from "@solana/web3.js";
import { COOKIE_CHAIN } from "./cookie-chain-config";
import { COOKIE_MARKETS_PROGRAM_ID, TOKEN_PROGRAM_ID, deriveConfigAddress } from "./cookie-markets-program";
import { decodeProtocolConfig } from "./protocol-accounts";

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
