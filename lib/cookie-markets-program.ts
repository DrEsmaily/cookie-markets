import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export const COOKIE_MARKETS_PROGRAM_ID = new PublicKey(
  "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
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

export async function buildInitializeProtocolInstruction(params: {
  admin: PublicKey;
  feeRecipient: PublicKey;
  resolver: PublicKey;
  feeBps: number;
  challengePeriod: bigint;
}): Promise<TransactionInstruction> {
  if (!Number.isInteger(params.feeBps) || params.feeBps < 0 || params.feeBps > 1_000) {
    throw new RangeError("feeBps must be an integer between 0 and 1000");
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
  if (hash.length !== 32) {
    throw new RangeError(`${name} must contain exactly 32 bytes`);
  }
}

function encodeOutcome(outcome: ResolutionOutcome): Uint8Array {
  const value = { yes: 1, no: 2, invalid: 3 }[outcome];
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
