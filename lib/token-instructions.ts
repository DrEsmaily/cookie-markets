import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./cookie-markets-program";

export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function deriveAssociatedTokenAddress(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) throw new Error("A wallet owner must be an on-curve public key.");
  return PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

export function buildCreateAssociatedTokenInstruction(owner: PublicKey, mint: PublicKey, payer = owner, allowOwnerOffCurve = false): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isWritable: true, isSigner: true },
      { pubkey: deriveAssociatedTokenAddress(mint, owner, allowOwnerOffCurve), isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: false, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    ],
  });
}

export function buildSyncNativeInstruction(account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data: Buffer.from([17]), keys: [{ pubkey: account, isWritable: true, isSigner: false }] });
}

export function buildInitializeTokenAccountInstruction(account: PublicKey, mint: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    data: Buffer.concat([Buffer.from([18]), owner.toBuffer()]),
    keys: [
      { pubkey: account, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
    ],
  });
}

export function buildTransferCheckedInstruction(source: PublicKey, mint: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
  const encodedAmount = Buffer.alloc(8);
  encodedAmount.writeBigUInt64LE(amount);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    data: Buffer.concat([Buffer.from([12]), encodedAmount, Buffer.from([decimals])]),
    keys: [
      { pubkey: source, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false },
      { pubkey: destination, isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: false, isSigner: true },
    ],
  });
}

export function buildCloseTokenAccountInstruction(account: PublicKey, destination: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    data: Buffer.from([9]),
    keys: [
      { pubkey: account, isWritable: true, isSigner: false },
      { pubkey: destination, isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: false, isSigner: true },
    ],
  });
}

export function buildBurnCheckedInstruction(account: PublicKey, mint: PublicKey, owner: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
  const encodedAmount = Buffer.alloc(8);
  encodedAmount.writeBigUInt64LE(amount);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    data: Buffer.concat([Buffer.from([15]), encodedAmount, Buffer.from([decimals])]),
    keys: [
      { pubkey: account, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: false, isSigner: true },
    ],
  });
}

export function buildUnwrapNativeInstruction(owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    data: Buffer.from([9]),
    keys: [
      { pubkey: deriveAssociatedTokenAddress(NATIVE_MINT, owner), isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: false, isSigner: true },
    ],
  });
}
