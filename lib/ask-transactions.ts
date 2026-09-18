import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { buildCancelAskInstruction, buildFillAskInstruction, buildPlaceAskInstruction, deriveAskAddresses, PositionSide } from "./cookie-markets-program";
import type { VerifiedAsk, VerifiedMarket } from "./protocol-accounts";
import { buildCreateAssociatedTokenInstruction, deriveAssociatedTokenAddress, NATIVE_MINT } from "./token-instructions";
import { buildWrapNativeInstructions } from "./position-transactions";
import { quoteOrderFill } from "./trading-math";
import { buildCancelBidInstruction, buildFillBidInstruction, buildPlaceBidInstruction, deriveBidAddresses } from "./cookie-markets-program";
import type { VerifiedBid } from "./protocol-accounts";

type BidAction = {
  action: "place"; nonce: bigint; side: PositionSide; shares: bigint; price: bigint;
  expiresAt: bigint; feeBps: number; wrapNative?: boolean;
} | {
  action: "fill"; order: VerifiedBid; shares: bigint; minimumProceeds: bigint;
} | {
  action: "cancel"; order: VerifiedBid;
};

export async function buildBidTransactionInstructions(market: VerifiedMarket, user: PublicKey, operation: BidAction) {
  if (!PublicKey.isOnCurve(user.toBytes())) throw new RangeError("A signing wallet must be an on-curve public key.");
  const collateralMint = new PublicKey(market.collateralMint);
  const instructions: TransactionInstruction[] = [];
  if (operation.action === "place") {
    const quote = quoteOrderFill({ totalShares: operation.shares, filledShares: BigInt(0), fillShares: operation.shares, price: operation.price, feeBps: operation.feeBps });
    if (operation.wrapNative && !collateralMint.equals(NATIVE_MINT)) throw new RangeError("Native wrapping requires native collateral.");
    instructions.push(buildCreateAssociatedTokenInstruction(user, collateralMint));
    if (operation.wrapNative) instructions.push(...buildWrapNativeInstructions(user, quote.buyerDebit).slice(1));
    instructions.push(await buildPlaceBidInstruction({
      creator: new PublicKey(market.creator), marketNonce: BigInt(market.nonce), maker: user,
      nonce: operation.nonce, collateralMint, makerCollateral: deriveAssociatedTokenAddress(collateralMint, user),
      side: operation.side, shares: operation.shares, price: operation.price, expiresAt: operation.expiresAt,
    }));
    return { instructions, order: deriveBidAddresses(new PublicKey(market.address), user, operation.nonce).order.toBase58(), quote };
  }
  const order = operation.order;
  if (order.market !== market.address || order.collateralMint !== market.collateralMint
    || (order.shareMint !== market.yesMint && order.shareMint !== market.noMint)) throw new Error("Order does not belong to this market.");
  const maker = new PublicKey(order.maker);
  const shareMint = new PublicKey(order.shareMint);
  const identity = { market: new PublicKey(market.address), maker, nonce: BigInt(order.nonce), collateralMint };
  if (deriveBidAddresses(identity.market, maker, identity.nonce).order.toBase58() !== order.address) throw new Error("Order identity is invalid.");
  if (order.cancelled) throw new RangeError("Order is already cancelled.");
  if (operation.action === "cancel") {
    if (!maker.equals(user)) throw new RangeError("Only the maker can cancel this order.");
    instructions.push(buildCreateAssociatedTokenInstruction(user, collateralMint));
    instructions.push(await buildCancelBidInstruction({ ...identity, makerCollateral: deriveAssociatedTokenAddress(collateralMint, user) }));
    return { instructions, order: order.address };
  }
  const quote = quoteOrderFill({ totalShares: BigInt(order.totalShares), filledShares: BigInt(order.filledShares), fillShares: operation.shares, price: BigInt(order.price), feeBps: order.feeBps });
  if (operation.minimumProceeds < BigInt(0) || operation.minimumProceeds > quote.collateral) throw new RangeError("Minimum proceeds exceed the current consideration.");
  const feeRecipient = new PublicKey(order.feeRecipient);
  instructions.push(
    buildCreateAssociatedTokenInstruction(user, collateralMint),
    buildCreateAssociatedTokenInstruction(maker, shareMint, user),
    buildCreateAssociatedTokenInstruction(feeRecipient, collateralMint, user, true),
  );
  instructions.push(await buildFillBidInstruction({
    ...identity, shareMint, taker: user, takerShares: deriveAssociatedTokenAddress(shareMint, user),
    makerShares: deriveAssociatedTokenAddress(shareMint, maker),
    takerCollateral: deriveAssociatedTokenAddress(collateralMint, user),
    feeCollateral: deriveAssociatedTokenAddress(collateralMint, feeRecipient, true),
    shares: operation.shares, minimumProceeds: operation.minimumProceeds,
  }));
  return { instructions, order: order.address, quote };
}

type AskAction = {
  action: "place"; nonce: bigint; side: PositionSide; shares: bigint; price: bigint; expiresAt: bigint;
} | {
  action: "fill"; order: VerifiedAsk; shares: bigint; maximumDebit: bigint; wrapNative?: boolean;
} | {
  action: "cancel"; order: VerifiedAsk;
};

export async function buildAskTransactionInstructions(market: VerifiedMarket, user: PublicKey, operation: AskAction) {
  if (!PublicKey.isOnCurve(user.toBytes())) throw new RangeError("A signing wallet must be an on-curve public key.");
  const collateralMint = new PublicKey(market.collateralMint);
  const instructions: TransactionInstruction[] = [];
  if (operation.action === "place") {
    const shareMint = new PublicKey(operation.side === "yes" ? market.yesMint : market.noMint);
    const makerShares = deriveAssociatedTokenAddress(shareMint, user);
    instructions.push(await buildPlaceAskInstruction({
      creator: new PublicKey(market.creator), marketNonce: BigInt(market.nonce),
      maker: user, nonce: operation.nonce, collateralMint, makerShares,
      side: operation.side, shares: operation.shares, price: operation.price, expiresAt: operation.expiresAt,
    }));
    return { instructions, order: deriveAskAddresses(new PublicKey(market.address), user, operation.nonce).order.toBase58(), shareMint: shareMint.toBase58() };
  }
  const order = operation.order;
  if (order.market !== market.address || (order.shareMint !== market.yesMint && order.shareMint !== market.noMint)) throw new Error("Order does not belong to this market.");
  const maker = new PublicKey(order.maker);
  const shareMint = new PublicKey(order.shareMint);
  const identity = { market: new PublicKey(market.address), maker, nonce: BigInt(order.nonce), shareMint };
  if (deriveAskAddresses(identity.market, maker, identity.nonce).order.toBase58() !== order.address) throw new Error("Order identity is invalid.");
  if (order.cancelled) throw new RangeError("Order is already cancelled.");
  if (operation.action === "cancel") {
    if (!maker.equals(user)) throw new RangeError("Only the maker can cancel this order.");
    instructions.push(buildCreateAssociatedTokenInstruction(user, shareMint));
    instructions.push(await buildCancelAskInstruction({ ...identity, makerShares: deriveAssociatedTokenAddress(shareMint, user) }));
    return { instructions, order: order.address, shareMint: order.shareMint };
  }
  const quote = quoteOrderFill({ totalShares: BigInt(order.totalShares), filledShares: BigInt(order.filledShares), fillShares: operation.shares, price: BigInt(order.price), feeBps: order.feeBps });
  if (operation.maximumDebit < quote.buyerDebit) throw new RangeError("Debit limit is below the current quote including trading fees.");
  if (operation.wrapNative && !collateralMint.equals(NATIVE_MINT)) throw new RangeError("Native wrapping requires native collateral.");
  const feeRecipient = new PublicKey(order.feeRecipient);
  instructions.push(
    buildCreateAssociatedTokenInstruction(user, collateralMint),
    buildCreateAssociatedTokenInstruction(user, shareMint),
    buildCreateAssociatedTokenInstruction(maker, collateralMint, user),
    buildCreateAssociatedTokenInstruction(feeRecipient, collateralMint, user, true),
  );
  if (operation.wrapNative) instructions.push(...buildWrapNativeInstructions(user, quote.buyerDebit).slice(1));
  instructions.push(await buildFillAskInstruction({
    ...identity, collateralMint, taker: user,
    takerCollateral: deriveAssociatedTokenAddress(collateralMint, user),
    makerCollateral: deriveAssociatedTokenAddress(collateralMint, maker),
    feeCollateral: deriveAssociatedTokenAddress(collateralMint, feeRecipient, true),
    takerShares: deriveAssociatedTokenAddress(shareMint, user), shares: operation.shares, maximumDebit: operation.maximumDebit,
  }));
  return { instructions, order: order.address, shareMint: order.shareMint, quote };
}
