import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./cookie-markets-program";

export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function deriveAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error("A wallet owner must be an on-curve public key.");
  return PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

export function buildCreateAssociatedTokenInstruction(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([1]),
    keys: [
      { pubkey: owner, isWritable: true, isSigner: true },
      { pubkey: deriveAssociatedTokenAddress(mint, owner), isWritable: true, isSigner: false },
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
