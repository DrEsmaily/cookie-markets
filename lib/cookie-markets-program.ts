import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export const COOKIE_MARKETS_PROGRAM_ID = new PublicKey(
  "BNqof3tMVwNd7rthycJTtXkvbGtopihvL9gpeoSk8WaR",
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

const textEncoder = new TextEncoder();

export type MarketAddresses = {
  market: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  resolution: PublicKey;
};

export type CreateMarketInstructionParams = {
  creator: PublicKey;
  collateralMint: PublicKey;
  marketNonce: bigint;
  questionHash: Uint8Array;
  rulesHash: Uint8Array;
  closesAt: bigint;
  resolveAfter: bigint;
};

export type PositionInstructionParams = {
  creator: PublicKey;
  marketNonce: bigint;
  collateralMint: PublicKey;
  user: PublicKey;
  userCollateral: PublicKey;
  userYes: PublicKey;
  userNo: PublicKey;
  amount: bigint;
};

export type ResolutionOutcome = "yes" | "no" | "invalid";
export type PositionSide = "yes" | "no";

export function deriveConfigAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("config")],
    COOKIE_MARKETS_PROGRAM_ID,
  )[0];
}

export function deriveAmmAddresses(market: PublicKey) {
  return {
    pool: PublicKey.findProgramAddressSync([textEncoder.encode("amm_pool"), market.toBytes()], COOKIE_MARKETS_PROGRAM_ID)[0],
    poolYes: PublicKey.findProgramAddressSync([textEncoder.encode("amm_yes"), market.toBytes()], COOKIE_MARKETS_PROGRAM_ID)[0],
    poolNo: PublicKey.findProgramAddressSync([textEncoder.encode("amm_no"), market.toBytes()], COOKIE_MARKETS_PROGRAM_ID)[0],
  };
}

export function buildInitializeAmmInstruction(params: {
  market: PublicKey; collateralMint: PublicKey; yesMint: PublicKey; noMint: PublicKey; vault: PublicKey;
  creator: PublicKey; creatorCollateral: PublicKey; creatorYes: PublicKey; creatorNo: PublicKey;
  liquidity: bigint; yesProbabilityBps: number;
}) {
  if (params.liquidity <= BigInt(0) || !Number.isInteger(params.yesProbabilityBps) || params.yesProbabilityBps <= 0 || params.yesProbabilityBps >= 10_000) throw new RangeError("Invalid AMM initialization values.");
  const { pool, poolYes, poolNo } = deriveAmmAddresses(params.market);
  return instruction("initialize_amm", concatBytes(encodeUnsigned64(params.liquidity), encodeUnsigned16(params.yesProbabilityBps)), [
    { pubkey: params.market, isWritable: true, isSigner: false }, { pubkey: pool, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false }, { pubkey: params.yesMint, isWritable: true, isSigner: false }, { pubkey: params.noMint, isWritable: true, isSigner: false },
    { pubkey: params.vault, isWritable: true, isSigner: false }, { pubkey: poolYes, isWritable: true, isSigner: false }, { pubkey: poolNo, isWritable: true, isSigner: false },
    { pubkey: params.creatorCollateral, isWritable: true, isSigner: false }, { pubkey: params.creatorYes, isWritable: true, isSigner: false }, { pubkey: params.creatorNo, isWritable: true, isSigner: false },
    { pubkey: params.creator, isWritable: true, isSigner: true }, { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
  ]);
}

export function buildBuyFromAmmInstruction(params: {
  market: PublicKey; creator: PublicKey; collateralMint: PublicKey; yesMint: PublicKey; noMint: PublicKey; vault: PublicKey;
  creatorCollateral: PublicKey; buyerCollateral: PublicKey; buyerYes: PublicKey; buyerNo: PublicKey; buyer: PublicKey;
  side: PositionSide; sharesOut: bigint; maximumTotalInput: bigint;
}) {
  if (params.sharesOut <= BigInt(0) || params.maximumTotalInput <= BigInt(0)) throw new RangeError("AMM purchase values must be positive.");
  const { pool, poolYes, poolNo } = deriveAmmAddresses(params.market);
  return instruction("buy_from_amm", concatBytes(Uint8Array.of(params.side === "yes" ? 0 : 1), encodeUnsigned64(params.sharesOut), encodeUnsigned64(params.maximumTotalInput)), [
    { pubkey: params.market, isWritable: true, isSigner: false }, { pubkey: pool, isWritable: true, isSigner: false }, { pubkey: params.creator, isWritable: false, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false }, { pubkey: params.yesMint, isWritable: true, isSigner: false }, { pubkey: params.noMint, isWritable: true, isSigner: false }, { pubkey: params.vault, isWritable: true, isSigner: false },
    { pubkey: poolYes, isWritable: true, isSigner: false }, { pubkey: poolNo, isWritable: true, isSigner: false }, { pubkey: params.creatorCollateral, isWritable: true, isSigner: false },
    { pubkey: params.buyerCollateral, isWritable: true, isSigner: false }, { pubkey: params.buyerYes, isWritable: true, isSigner: false }, { pubkey: params.buyerNo, isWritable: true, isSigner: false },
    { pubkey: params.buyer, isWritable: false, isSigner: true }, { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ]);
}

export function buildClaimAmmSettlementInstruction(params: {
  market: PublicKey;
  collateralMint: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  creatorCollateral: PublicKey;
  creator: PublicKey;
}) {
  const { pool, poolYes, poolNo } = deriveAmmAddresses(params.market);
  return instruction("claim_amm_settlement", new Uint8Array(), [
    { pubkey: params.market, isWritable: true, isSigner: false },
    { pubkey: pool, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false },
    { pubkey: params.yesMint, isWritable: true, isSigner: false },
    { pubkey: params.noMint, isWritable: true, isSigner: false },
    { pubkey: params.vault, isWritable: true, isSigner: false },
    { pubkey: poolYes, isWritable: true, isSigner: false },
    { pubkey: poolNo, isWritable: true, isSigner: false },
    { pubkey: params.creatorCollateral, isWritable: true, isSigner: false },
    { pubkey: params.creator, isWritable: false, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ]);
}

export function deriveAskAddresses(market: PublicKey, maker: PublicKey, nonce: bigint) {
  const [order, bump] = PublicKey.findProgramAddressSync(
    [textEncoder.encode("ask"), market.toBytes(), maker.toBytes(), encodeUnsigned64(nonce)],
    COOKIE_MARKETS_PROGRAM_ID,
  );
  const [escrow, escrowBump] = PublicKey.findProgramAddressSync(
    [textEncoder.encode("ask_escrow"), order.toBytes()], COOKIE_MARKETS_PROGRAM_ID,
  );
  return { order, escrow, bump, escrowBump };
}

export async function buildPlaceAskInstruction(params: {
  creator: PublicKey; marketNonce: bigint; maker: PublicKey; nonce: bigint;
  collateralMint: PublicKey; makerShares: PublicKey; side: PositionSide;
  shares: bigint; price: bigint; expiresAt: bigint;
}) {
  if (params.side !== "yes" && params.side !== "no") throw new RangeError("Choose an order side.");
  if (params.shares <= BigInt(0) || params.price <= BigInt(0) || params.price > BigInt(1_000_000)) {
    throw new RangeError("Order shares and price are invalid.");
  }
  if (params.expiresAt <= BigInt(0)) throw new RangeError("Order expiry must be positive.");
  const addresses = deriveMarketAddresses(params.creator, params.marketNonce);
  const { order, escrow } = deriveAskAddresses(addresses.market, params.maker, params.nonce);
  const shareMint = params.side === "yes" ? addresses.yesMint : addresses.noMint;
  return instruction("place_ask", concatBytes(
    encodeUnsigned64(params.nonce), Uint8Array.of(params.side === "yes" ? 0 : 1),
    encodeUnsigned64(params.shares), encodeUnsigned64(params.price), encodeSigned64(params.expiresAt),
  ), [
    { pubkey: deriveConfigAddress(), isWritable: false, isSigner: false },
    { pubkey: addresses.market, isWritable: false, isSigner: false },
    { pubkey: order, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false },
    { pubkey: shareMint, isWritable: false, isSigner: false },
    { pubkey: escrow, isWritable: true, isSigner: false },
    { pubkey: params.makerShares, isWritable: true, isSigner: false },
    { pubkey: params.maker, isWritable: true, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
  ]);
}

export function deriveBidAddresses(market: PublicKey, maker: PublicKey, nonce: bigint) {
  const [order, bump] = PublicKey.findProgramAddressSync(
    [textEncoder.encode("bid"), market.toBytes(), maker.toBytes(), encodeUnsigned64(nonce)],
    COOKIE_MARKETS_PROGRAM_ID,
  );
  const [escrow, escrowBump] = PublicKey.findProgramAddressSync(
    [textEncoder.encode("bid_escrow"), order.toBytes()], COOKIE_MARKETS_PROGRAM_ID,
  );
  return { order, escrow, bump, escrowBump };
}

export async function buildPlaceBidInstruction(params: {
  creator: PublicKey; marketNonce: bigint; maker: PublicKey; nonce: bigint;
  collateralMint: PublicKey; makerCollateral: PublicKey; side: PositionSide;
  shares: bigint; price: bigint; expiresAt: bigint;
}) {
  if (params.side !== "yes" && params.side !== "no") throw new RangeError("Choose an order side.");
  if (params.shares <= BigInt(0) || params.price <= BigInt(0) || params.price > BigInt(1_000_000)) {
    throw new RangeError("Order shares and price are invalid.");
  }
  if (params.expiresAt <= BigInt(0)) throw new RangeError("Order expiry must be positive.");
  const addresses = deriveMarketAddresses(params.creator, params.marketNonce);
  const { order, escrow } = deriveBidAddresses(addresses.market, params.maker, params.nonce);
  return instruction("place_bid", concatBytes(
    encodeUnsigned64(params.nonce), Uint8Array.of(params.side === "yes" ? 0 : 1),
    encodeUnsigned64(params.shares), encodeUnsigned64(params.price), encodeSigned64(params.expiresAt),
  ), [
    { pubkey: deriveConfigAddress(), isWritable: false, isSigner: false },
    { pubkey: addresses.market, isWritable: false, isSigner: false },
    { pubkey: order, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false },
    { pubkey: params.side === "yes" ? addresses.yesMint : addresses.noMint, isWritable: false, isSigner: false },
    { pubkey: escrow, isWritable: true, isSigner: false },
    { pubkey: params.makerCollateral, isWritable: true, isSigner: false },
    { pubkey: params.maker, isWritable: true, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
  ]);
}

type BidIdentity = { market: PublicKey; maker: PublicKey; nonce: bigint; collateralMint: PublicKey };

export async function buildFillBidInstruction(params: BidIdentity & {
  shareMint: PublicKey; taker: PublicKey; takerShares: PublicKey;
  makerShares: PublicKey; takerCollateral: PublicKey; feeCollateral: PublicKey;
  shares: bigint; minimumProceeds: bigint;
}) {
  if (params.maker.equals(params.taker)) throw new Error("Maker cannot fill their own order.");
  if (params.shares <= BigInt(0)) throw new RangeError("Fill shares must be positive.");
  const { order, escrow } = deriveBidAddresses(params.market, params.maker, params.nonce);
  return instruction("fill_bid", concatBytes(encodeUnsigned64(params.shares), encodeUnsigned64(params.minimumProceeds)), [
    { pubkey: params.market, isWritable: false, isSigner: false },
    { pubkey: order, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false },
    { pubkey: params.shareMint, isWritable: false, isSigner: false },
    { pubkey: escrow, isWritable: true, isSigner: false },
    { pubkey: params.takerShares, isWritable: true, isSigner: false },
    { pubkey: params.makerShares, isWritable: true, isSigner: false },
    { pubkey: params.takerCollateral, isWritable: true, isSigner: false },
    { pubkey: params.feeCollateral, isWritable: true, isSigner: false },
    { pubkey: params.taker, isWritable: false, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ]);
}

export async function buildCancelBidInstruction(params: BidIdentity & { makerCollateral: PublicKey }) {
  const { order, escrow } = deriveBidAddresses(params.market, params.maker, params.nonce);
  return instruction("cancel_bid", new Uint8Array(), [
    { pubkey: order, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false },
    { pubkey: escrow, isWritable: true, isSigner: false },
    { pubkey: params.makerCollateral, isWritable: true, isSigner: false },
    { pubkey: params.maker, isWritable: false, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ]);
}

type AskIdentity = { market: PublicKey; maker: PublicKey; nonce: bigint; shareMint: PublicKey };

export async function buildFillAskInstruction(params: AskIdentity & {
  collateralMint: PublicKey; taker: PublicKey; takerCollateral: PublicKey;
  makerCollateral: PublicKey; feeCollateral: PublicKey; takerShares: PublicKey;
  shares: bigint; maximumDebit: bigint;
}) {
  if (params.maker.equals(params.taker)) throw new Error("Maker cannot fill their own order.");
  if (params.shares <= BigInt(0) || params.maximumDebit <= BigInt(0)) throw new RangeError("Fill shares and debit limit must be positive.");
  const { order, escrow } = deriveAskAddresses(params.market, params.maker, params.nonce);
  return instruction("fill_ask", concatBytes(encodeUnsigned64(params.shares), encodeUnsigned64(params.maximumDebit)), [
    { pubkey: params.market, isWritable: false, isSigner: false },
    { pubkey: order, isWritable: true, isSigner: false },
    { pubkey: params.collateralMint, isWritable: false, isSigner: false },
    { pubkey: params.shareMint, isWritable: false, isSigner: false },
    { pubkey: escrow, isWritable: true, isSigner: false },
    { pubkey: params.takerCollateral, isWritable: true, isSigner: false },
    { pubkey: params.makerCollateral, isWritable: true, isSigner: false },
    { pubkey: params.feeCollateral, isWritable: true, isSigner: false },
    { pubkey: params.takerShares, isWritable: true, isSigner: false },
    { pubkey: params.taker, isWritable: false, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ]);
}

export async function buildCancelAskInstruction(params: AskIdentity & { makerShares: PublicKey }) {
  const { order, escrow } = deriveAskAddresses(params.market, params.maker, params.nonce);
  return instruction("cancel_ask", new Uint8Array(), [
    { pubkey: order, isWritable: true, isSigner: false },
    { pubkey: params.shareMint, isWritable: false, isSigner: false },
    { pubkey: escrow, isWritable: true, isSigner: false },
    { pubkey: params.makerShares, isWritable: true, isSigner: false },
    { pubkey: params.maker, isWritable: false, isSigner: true },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
  ]);
}

export async function buildInitializeProtocolInstruction(params: {
  admin: PublicKey;
  feeRecipient: PublicKey;
  resolver: PublicKey;
  collateralMint: PublicKey;
  feeBps: number;
  challengePeriod: bigint;
}): Promise<TransactionInstruction> {
  if (!Number.isInteger(params.feeBps) || params.feeBps < 0 || params.feeBps > 1_000) {
    throw new RangeError("feeBps must be an integer between 0 and 1000");
  }
  if (params.challengePeriod <= BigInt(0)) {
    throw new RangeError("challengePeriod must be positive");
  }

  return instruction(
    "initialize_protocol",
    concatBytes(
      params.feeRecipient.toBytes(),
      params.resolver.toBytes(),
      encodeUnsigned16(params.feeBps),
      encodeSigned64(params.challengePeriod),
    ),
    [
      { pubkey: deriveConfigAddress(), isSigner: false, isWritable: true },
      { pubkey: params.collateralMint, isSigner: false, isWritable: false },
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  );
}

export function deriveMarketAddresses(
  creator: PublicKey,
  marketNonce: bigint,
): MarketAddresses {
  const nonce = encodeUnsigned64(marketNonce);
  const market = PublicKey.findProgramAddressSync(
    [textEncoder.encode("market"), creator.toBytes(), nonce],
    COOKIE_MARKETS_PROGRAM_ID,
  )[0];

  return {
    market,
    yesMint: deriveChildAddress("yes_mint", market),
    noMint: deriveChildAddress("no_mint", market),
    vault: deriveChildAddress("vault", market),
    resolution: deriveChildAddress("resolution", market),
  };
}

export async function buildCreateMarketInstruction(
  params: CreateMarketInstructionParams,
): Promise<TransactionInstruction> {
  assertHash(params.questionHash, "questionHash");
  assertHash(params.rulesHash, "rulesHash");
  if (params.closesAt <= BigInt(0) || params.resolveAfter < params.closesAt) {
    throw new RangeError("Market schedule is invalid");
  }

  const config = deriveConfigAddress();
  const addresses = deriveMarketAddresses(params.creator, params.marketNonce);
  const data = concatBytes(
    await instructionDiscriminator("create_market"),
    encodeUnsigned64(params.marketNonce),
    params.questionHash,
    params.rulesHash,
    encodeSigned64(params.closesAt),
    encodeSigned64(params.resolveAfter),
  );

  return new TransactionInstruction({
    programId: COOKIE_MARKETS_PROGRAM_ID,
    data: Buffer.from(data),
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: addresses.market, isSigner: false, isWritable: true },
      { pubkey: params.collateralMint, isSigner: false, isWritable: false },
      { pubkey: addresses.yesMint, isSigner: false, isWritable: true },
      { pubkey: addresses.noMint, isSigner: false, isWritable: true },
      { pubkey: addresses.vault, isSigner: false, isWritable: true },
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export async function buildOpenMarketInstruction(
  creator: PublicKey,
  marketNonce: bigint,
): Promise<TransactionInstruction> {
  const { market } = deriveMarketAddresses(creator, marketNonce);
  return instructionWithoutArgs("open_market", [
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: creator, isSigner: true, isWritable: false },
  ]);
}

export async function buildLockMarketInstruction(
  creator: PublicKey,
  marketNonce: bigint,
): Promise<TransactionInstruction> {
  const { market } = deriveMarketAddresses(creator, marketNonce);
  return instructionWithoutArgs("lock_market", [
    { pubkey: market, isSigner: false, isWritable: true },
  ]);
}

export async function buildSplitCollateralInstruction(
  params: PositionInstructionParams,
): Promise<TransactionInstruction> {
  return buildPositionInstruction("split_collateral", params);
}

export async function buildMergePositionsInstruction(
  params: PositionInstructionParams,
): Promise<TransactionInstruction> {
  return buildPositionInstruction("merge_positions", params);
}

export async function buildProposeResolutionInstruction(params: {
  creator: PublicKey;
  marketNonce: bigint;
  resolver: PublicKey;
  outcome: ResolutionOutcome;
  evidenceHash: Uint8Array;
}): Promise<TransactionInstruction> {
  assertHash(params.evidenceHash, "evidenceHash");
  const { market, resolution } = deriveMarketAddresses(
    params.creator,
    params.marketNonce,
  );

  return instruction(
    "propose_resolution",
    concatBytes(encodeOutcome(params.outcome), params.evidenceHash),
    [
      { pubkey: deriveConfigAddress(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: resolution, isSigner: false, isWritable: true },
      { pubkey: params.resolver, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  );
}

export async function buildChallengeResolutionInstruction(params: {
  creator: PublicKey;
  marketNonce: bigint;
  challenger: PublicKey;
}): Promise<TransactionInstruction> {
  const { market, resolution } = deriveMarketAddresses(
    params.creator,
    params.marketNonce,
  );
  return instructionWithoutArgs("challenge_resolution", [
    { pubkey: market, isSigner: false, isWritable: false },
    { pubkey: resolution, isSigner: false, isWritable: true },
    { pubkey: params.challenger, isSigner: true, isWritable: false },
  ]);
}

export async function buildResolveChallengeInstruction(params: {
  creator: PublicKey;
  marketNonce: bigint;
  resolver: PublicKey;
  outcome: ResolutionOutcome;
  evidenceHash: Uint8Array;
}): Promise<TransactionInstruction> {
  assertHash(params.evidenceHash, "evidenceHash");
  const { market, resolution } = deriveMarketAddresses(
    params.creator,
    params.marketNonce,
  );
  return instruction(
    "resolve_challenge",
    concatBytes(encodeOutcome(params.outcome), params.evidenceHash),
    [
      { pubkey: deriveConfigAddress(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: resolution, isSigner: false, isWritable: true },
      { pubkey: params.resolver, isSigner: true, isWritable: false },
    ],
  );
}

export async function buildFinalizeResolutionInstruction(
  creator: PublicKey,
  marketNonce: bigint,
): Promise<TransactionInstruction> {
  const { market, resolution } = deriveMarketAddresses(creator, marketNonce);
  return instructionWithoutArgs("finalize_resolution", [
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: resolution, isSigner: false, isWritable: false },
  ]);
}

export async function buildRedeemInstruction(
  params: PositionInstructionParams & { side: PositionSide },
): Promise<TransactionInstruction> {
  if (params.side !== "yes" && params.side !== "no") {
    throw new RangeError("Position side must be yes or no");
  }
  return buildPositionInstruction(
    "redeem",
    params,
    Uint8Array.of(params.side === "yes" ? 0 : 1),
  );
}

async function instructionWithoutArgs(
  name: string,
  keys: AccountMeta[],
): Promise<TransactionInstruction> {
  return instruction(name, new Uint8Array(), keys);
}

async function instruction(
  name: string,
  args: Uint8Array,
  keys: AccountMeta[],
): Promise<TransactionInstruction> {
  return new TransactionInstruction({
    programId: COOKIE_MARKETS_PROGRAM_ID,
    data: Buffer.from(
      concatBytes(await instructionDiscriminator(name), args),
    ),
    keys,
  });
}

async function buildPositionInstruction(
  name: "split_collateral" | "merge_positions" | "redeem",
  params: PositionInstructionParams,
  prefix = new Uint8Array(),
): Promise<TransactionInstruction> {
  if (params.amount <= BigInt(0)) {
    throw new RangeError("Position amount must be positive");
  }
  const { market, yesMint, noMint, vault } = deriveMarketAddresses(
    params.creator,
    params.marketNonce,
  );
  return instruction(name, concatBytes(prefix, encodeUnsigned64(params.amount)), [
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: params.collateralMint, isSigner: false, isWritable: false },
    { pubkey: yesMint, isSigner: false, isWritable: true },
    { pubkey: noMint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: params.userCollateral, isSigner: false, isWritable: true },
    { pubkey: params.userYes, isSigner: false, isWritable: true },
    { pubkey: params.userNo, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

async function instructionDiscriminator(name: string): Promise<Uint8Array> {
  const input = textEncoder.encode(`global:${name}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(digest).slice(0, 8);
}

function deriveChildAddress(seed: string, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(seed), market.toBytes()],
    COOKIE_MARKETS_PROGRAM_ID,
  )[0];
}

function encodeUnsigned64(value: bigint): Uint8Array {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) {
    throw new RangeError("Value must fit in an unsigned 64-bit integer");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function encodeUnsigned16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function encodeSigned64(value: bigint): Uint8Array {
  if (
    value < BigInt("-9223372036854775808") ||
    value > BigInt("9223372036854775807")
  ) {
    throw new RangeError("Value must fit in a signed 64-bit integer");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function assertHash(hash: Uint8Array, name: string): void {
  if (hash.length !== 32 || hash.every((byte) => byte === 0)) {
    throw new RangeError(`${name} must contain exactly 32 bytes and must not be empty`);
  }
}

function encodeOutcome(outcome: ResolutionOutcome): Uint8Array {
  const value = { yes: 1, no: 2, invalid: 3 }[outcome];
  if (value === undefined) throw new RangeError("Resolution outcome must be yes, no, or invalid");
  return Uint8Array.of(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
