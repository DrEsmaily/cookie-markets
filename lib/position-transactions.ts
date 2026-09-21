import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, buildCreateAssociatedTokenInstruction, buildSyncNativeInstruction, buildUnwrapNativeInstruction, deriveAssociatedTokenAddress } from "./token-instructions";
import { PositionSide, buildMergePositionsInstruction, buildRedeemInstruction, buildRefundInvalidPositionInstruction, buildSplitCollateralInstruction, deriveMarketAddresses } from "./cookie-markets-program";

export function buildWrapNativeInstructions(user: PublicKey, amount: bigint): TransactionInstruction[] {
  if (amount <= BigInt(0) || amount > BigInt("18446744073709551615")) throw new RangeError("Native amount must be positive and fit in a u64.");
  const account = deriveAssociatedTokenAddress(NATIVE_MINT, user);
  return [
    buildCreateAssociatedTokenInstruction(user, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: user, toPubkey: account, lamports: amount }),
    buildSyncNativeInstruction(account),
  ];
}

export async function buildPositionTransactionInstructions(params: {
  creator: PublicKey;
  marketNonce: bigint;
  collateralMint: PublicKey;
  user: PublicKey;
  amount: bigint;
  action: "split" | "merge" | "redeem" | "refundInvalid";
  side?: PositionSide;
  wrapNative?: boolean;
}) {
  if (!["split", "merge", "redeem", "refundInvalid"].includes(params.action)) throw new RangeError("Unknown position action.");
  if (params.wrapNative && (params.action !== "split" || !params.collateralMint.equals(NATIVE_MINT))) {
    throw new Error("Native wrapping is only valid for a native-mint collateral deposit.");
  }
  if ((params.action === "redeem" || params.action === "refundInvalid") && params.side !== "yes" && params.side !== "no") throw new Error("Choose a redemption side.");
  const addresses = deriveMarketAddresses(params.creator, params.marketNonce);
  const userCollateral = deriveAssociatedTokenAddress(params.collateralMint, params.user);
  const userYes = deriveAssociatedTokenAddress(addresses.yesMint, params.user);
  const userNo = deriveAssociatedTokenAddress(addresses.noMint, params.user);
  const position = { ...params, userCollateral, userYes, userNo };
  const operation = params.action === "split"
    ? await buildSplitCollateralInstruction(position)
    : params.action === "merge"
      ? await buildMergePositionsInstruction(position)
      : params.action === "refundInvalid"
        ? await buildRefundInvalidPositionInstruction({ ...position, side: params.side! })
        : await buildRedeemInstruction({ ...position, side: params.side! });
  const instructions = [
    buildCreateAssociatedTokenInstruction(params.user, params.collateralMint),
    buildCreateAssociatedTokenInstruction(params.user, addresses.yesMint),
    buildCreateAssociatedTokenInstruction(params.user, addresses.noMint),
  ];
  if (params.wrapNative) instructions.push(...buildWrapNativeInstructions(params.user, params.amount).slice(1));
  instructions.push(operation);
  if ((params.action === "redeem" || params.action === "refundInvalid") && params.collateralMint.equals(NATIVE_MINT)) instructions.push(buildUnwrapNativeInstruction(params.user));
  return { instructions, userCollateral, userYes, userNo, ...addresses };
}
