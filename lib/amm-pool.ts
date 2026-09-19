import { createHash } from "node:crypto";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { COOKIE_MARKETS_PROGRAM_ID, deriveAmmAddresses as deriveProgramAmmAddresses } from "./cookie-markets-program";

export const AMM_FEE_BPS = BigInt("100");
export const AMM_TRADE_CAP_BPS = BigInt("100");
export const BPS_DENOMINATOR = BigInt("10000");

export function deriveAmmAddresses(market: PublicKey) {
  const derived = deriveProgramAmmAddresses(market);
  const pool = derived.pool;
  const yesVault = PublicKey.findProgramAddressSync([Buffer.from("amm_yes"), market.toBuffer()], COOKIE_MARKETS_PROGRAM_ID)[0];
  const noVault = PublicKey.findProgramAddressSync([Buffer.from("amm_no"), market.toBuffer()], COOKIE_MARKETS_PROGRAM_ID)[0];
  return { pool, yesVault, noVault };
}

export function decodeAmmPool(address: PublicKey, account: Pick<AccountInfo<Buffer>, "owner" | "data">) {
  if (!account.owner.equals(COOKIE_MARKETS_PROGRAM_ID) || account.data.length !== 106) throw new Error("AMM pool account is invalid.");
  const discriminator = createHash("sha256").update("account:AmmPool").digest().subarray(0, 8);
  if (!account.data.subarray(0, 8).equals(discriminator)) throw new Error("AMM pool discriminator is invalid.");
  const market = new PublicKey(account.data.subarray(8, 40));
  const expected = deriveAmmAddresses(market).pool;
  if (!expected.equals(address) || account.data[105] !== PublicKey.findProgramAddressSync([Buffer.from("amm_pool"), market.toBuffer()], COOKIE_MARKETS_PROGRAM_ID)[1]) throw new Error("AMM pool identity is invalid.");
  const yesReserve = account.data.readBigUInt64LE(80);
  const noReserve = account.data.readBigUInt64LE(88);
  if (yesReserve === BigInt("0") || noReserve === BigInt("0")) throw new Error("AMM pool has invalid reserves.");
  return { address: address.toBase58(), market: market.toBase58(), creator: new PublicKey(account.data.subarray(40, 72)).toBase58(), liquidity: account.data.readBigUInt64LE(72), yesReserve, noReserve, totalCreatorFees: account.data.readBigUInt64LE(96), settlementClaimed: account.data[104] === 1 };
}

export function maximumAmmTrade(liquidity: bigint) { return liquidity * AMM_TRADE_CAP_BPS / BPS_DENOMINATOR; }

export function ammProbabilityBps(yesReserve: bigint, noReserve: bigint) {
  return Number(noReserve * BPS_DENOMINATOR / (yesReserve + noReserve));
}

export function quoteAmmBuy(side: "yes" | "no", grossInput: bigint, liquidity: bigint, yesReserve: bigint, noReserve: bigint) {
  if (grossInput <= BigInt("0") || grossInput > maximumAmmTrade(liquidity)) throw new RangeError("Purchase exceeds the current 1% maximum.");
  const fee = (grossInput * AMM_FEE_BPS + BPS_DENOMINATOR - BigInt("1")) / BPS_DENOMINATOR;
  const netInput = grossInput - fee;
  if (netInput <= BigInt("0")) throw new RangeError("Purchase is too small after fees.");
  const invariant = yesReserve * noReserve;
  const bought = side === "yes" ? yesReserve : noReserve;
  const opposite = side === "yes" ? noReserve : yesReserve;
  const oppositeAfter = opposite + netInput;
  const boughtAfter = (invariant + oppositeAfter - BigInt("1")) / oppositeAfter;
  const sharesOut = bought + netInput - boughtAfter;
  const minimumSharesOut = sharesOut * BigInt("99") / BigInt("100");
  return { grossInput, fee, netInput, sharesOut, minimumSharesOut, liquidityAfter: liquidity + netInput, yesReserveAfter: side === "yes" ? boughtAfter : oppositeAfter, noReserveAfter: side === "yes" ? oppositeAfter : boughtAfter };
}

export function creatorClaimable(outcome: "yes" | "no" | "invalid" | "unresolved", yesReserve: bigint, noReserve: bigint) {
  if (outcome === "yes") return yesReserve;
  if (outcome === "no") return noReserve;
  if (outcome === "invalid") return (yesReserve + noReserve) / BigInt("2");
  return BigInt("0");
}
