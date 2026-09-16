import { Connection } from "@solana/web3.js";

export const COOKIE_CHAIN = {
  name: "Cookie Chain",
  rpcUrl: "https://rpc.cookiescan.io",
  websocketUrl: "wss://wss.cookiescan.io",
  genesisHash: "9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2",
  explorerUrl: "https://cookiescan.io",
  currency: { symbol: "COOK", decimals: 9 }
} as const;

export const cookieChainConnection = new Connection(COOKIE_CHAIN.rpcUrl, "confirmed");
