"use client";

import { useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { buildUpdateProtocolInstruction } from "@/lib/cookie-markets-program";
import { cookieChainConnection } from "@/lib/cookie-chain";

const KEEPER = "hNnAqtwMY5HzMsM6BJRJKzmoyNfMg4Q3fp7HFNdwZ7C";

type Protocol = { admin: string; feeRecipient: string; resolver: string; feeBps: number; challengePeriod: string };

export function ResolverSetup() {
  const [protocol, setProtocol] = useState<Protocol>();
  const [message, setMessage] = useState("Loading verified protocol configuration…");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/protocol", { cache: "no-store" });
    const result = await response.json() as Protocol & { error?: string };
    if (!response.ok || !result.admin) throw new Error(result.error ?? "Protocol configuration is unavailable.");
    setProtocol(result);
    setMessage(result.resolver === KEEPER && result.challengePeriod === "0" ? "Automatic immediate resolution is configured." : "One wallet approval is required to enable automatic immediate resolution.");
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Protocol configuration is unavailable.")); }, []);

  async function configure() {
    if (!protocol) return;
    setBusy(true);
    try {
      const wallet = window.nightly?.solana;
      const connect = wallet?.features?.["standard:connect"];
      if (!wallet || !connect) throw new Error("Install Nightly and select Cookie Chain first.");
      const account = (await connect.connect()).accounts[0];
      if (!account || account.address !== protocol.admin) throw new Error("Connect the protocol admin wallet.");
      const admin = new PublicKey(protocol.admin);
      const instruction = await buildUpdateProtocolInstruction({ admin, feeRecipient: new PublicKey(protocol.feeRecipient), resolver: new PublicKey(KEEPER), feeBps: protocol.feeBps, challengePeriod: BigInt(0) });
      const latest = await cookieChainConnection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: admin, recentBlockhash: latest.blockhash }).add(instruction);
      const simulation = await cookieChainConnection.simulateTransaction(transaction);
      if (simulation.value.err) throw new Error("Cookie Chain rejected the resolver configuration simulation. Confirm the program upgrade completed first.");
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const chain = account.chains?.find((value) => value.startsWith("solana:")) as `${string}:${string}` | undefined;
      const send = wallet.features?.["solana:signAndSendTransaction"] ?? wallet.features?.["standard:signAndSendTransaction"];
      const sign = wallet.features?.["solana:signTransaction"] ?? wallet.features?.["standard:signTransaction"];
      if (send && chain) {
        const result = await send.signAndSendTransaction({ account, transaction: serialized, chain, options: { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 3 } });
        if (!result[0]?.signature?.length) throw new Error("Nightly did not return a transaction signature.");
      } else if (sign) {
        const result = await sign.signTransaction({ account, transaction: serialized, chain, options: { preflightCommitment: "confirmed" } });
        if (!result[0]?.signedTransaction?.length) throw new Error("Nightly did not return a signed transaction.");
        await cookieChainConnection.sendRawTransaction(result[0].signedTransaction, { preflightCommitment: "confirmed", maxRetries: 3 });
      } else throw new Error("Nightly transaction signing is unavailable.");
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Resolver configuration failed."); }
    finally { setBusy(false); }
  }

  const configured = protocol?.resolver === KEEPER && protocol.challengePeriod === "0";
  return <section className="protocol-setup"><p className="eyebrow">AUTOMATIC SETTLEMENT</p><h1>Immediate market resolution</h1><p>The keeper checks the exact completed Coinbase minute, submits the result, and finalizes in one transaction. Missing or unverifiable evidence produces an INVALID refund instead of guessing.</p><p>Keeper: <strong>{KEEPER}</strong></p><p>Finalization delay: <strong>0 seconds</strong></p>{!configured ? <button className="primary-action" type="button" disabled={busy || !protocol} onClick={() => void configure()}>{busy ? "Waiting for Nightly…" : "Enable automatic resolution"}</button> : null}<p role="status">{message}</p></section>;
}
