import { Connection } from "@solana/web3.js";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";

export const cookieChainConnection = new Connection(COOKIE_CHAIN.rpcUrl, "confirmed");
