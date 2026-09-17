import {
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

export function deriveConfigAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("config")],
    COOKIE_MARKETS_PROGRAM_ID,
  )[0];
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

async function instructionWithoutArgs(
  name: string,
  keys: ConstructorParameters<typeof TransactionInstruction>[0]["keys"],
): Promise<TransactionInstruction> {
  return new TransactionInstruction({
    programId: COOKIE_MARKETS_PROGRAM_ID,
    data: Buffer.from(await instructionDiscriminator(name)),
    keys,
  });
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
