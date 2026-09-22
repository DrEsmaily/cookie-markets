import { PublicKey, Transaction } from "@solana/web3.js";
import { cookieChainConnection } from "./cookie-chain";
import { COOKIE_CHAIN } from "./cookie-chain-config";

export async function submitPreparedTransaction(input: {
  unsignedTransaction: string;
  feePayer: string;
  blockhash: string;
  lastValidBlockHeight: number;
}) {
  const wallet = window.nightly?.solana;
  const connect = wallet?.features?.["standard:connect"];
  if (!wallet || !connect) throw new Error("Install Nightly and select Cookie Chain first.");
  if (wallet.genesisHash && wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Select Cookie Chain in Nightly first.");
  const account = (await connect.connect()).accounts[0];
  if (!account || account.address !== input.feePayer) throw new Error("Reconnect the wallet that reviewed this transaction.");

  const transaction = Transaction.from(Uint8Array.from(atob(input.unsignedTransaction), (character) => character.charCodeAt(0)));
  if (!transaction.feePayer?.equals(new PublicKey(input.feePayer)) || transaction.recentBlockhash !== input.blockhash) {
    throw new Error("Prepared transaction details changed. Review it again.");
  }
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  const chain = account.chains?.find((value) => value.startsWith("solana:")) as `${string}:${string}` | undefined;
  const sendFeature = wallet.features?.["solana:signAndSendTransaction"] ?? wallet.features?.["standard:signAndSendTransaction"];
  const signFeature = wallet.features?.["solana:signTransaction"] ?? wallet.features?.["standard:signTransaction"];
  let signature: string;
  if (signFeature) {
    const result = await signFeature.signTransaction({ account, transaction: serialized, chain, options: { preflightCommitment: "confirmed" } });
    const signed = result[0]?.signedTransaction;
    if (!signed?.length) throw new Error("Nightly did not return a signed transaction.");
    signature = await cookieChainConnection.sendRawTransaction(signed, { preflightCommitment: "confirmed", maxRetries: 3, skipPreflight: false });
  } else if (sendFeature && chain) {
    const result = await sendFeature.signAndSendTransaction({ account, transaction: serialized, chain, options: { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 3 } });
    if (!result[0]?.signature?.length) throw new Error("Nightly did not return a transaction signature.");
    signature = base58Encode(result[0].signature);
  } else {
    throw new Error("This Nightly version cannot sign Cookie Chain transactions.");
  }
  const confirmation = await cookieChainConnection.confirmTransaction({ signature, blockhash: input.blockhash, lastValidBlockHeight: input.lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error("Cookie Chain rejected the signed transaction.");
  return signature;
}

function base58Encode(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let result = "";
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) result += "1";
  for (let index = digits.length - 1; index >= 0; index -= 1) result += alphabet[digits[index]];
  return result;
}
