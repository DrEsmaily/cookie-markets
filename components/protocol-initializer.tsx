"use client";

import { useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { buildInitializeProtocolInstruction, deriveConfigAddress } from "@/lib/cookie-markets-program";
import { PROTOCOL_LIMITS } from "@/lib/protocol";

const AUTHORITY = "DQUuBvSGVAnqcXAJs2ZEcXtkXqMcMEX7JxqcZ2Yki86a";
const COLLATERAL_MINT = "So11111111111111111111111111111111111111112";

type Review = { fee: number; config: string; blockHeight: number };

async function waitForProtocol() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const protocol = await fetch("/api/protocol", { cache: "no-store" }).then((response) => response.json() as Promise<{ deployed: boolean }>);
    if (protocol.deployed) return;
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error("The transaction was sent, but verification is pending. Do not submit it again.");
}

export function ProtocolInitializer() {
  const [deployed, setDeployed] = useState<boolean>();
  const [review, setReview] = useState<Review>();
  const [message, setMessage] = useState<string>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void fetch("/api/protocol", { cache: "no-store" })
      .then(async (response) => response.json() as Promise<{ deployed: boolean }>)
      .then((result) => setDeployed(result.deployed))
      .catch(() => setMessage("Could not verify the protocol configuration."));
  }, []);

  async function buildTransaction() {
    const wallet = window.nightly?.solana;
    if (!wallet?.features?.["standard:connect"] || wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Connect Nightly to Cookie Chain first.");
    const { accounts } = await wallet.features["standard:connect"].connect();
    const account = accounts[0];
    if (!account || account.address !== AUTHORITY) throw new Error("Connect the designated CookieMarkets authority wallet.");
    const authority = new PublicKey(AUTHORITY);
    const latest = await cookieChainConnection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: authority, recentBlockhash: latest.blockhash }).add(
      await buildInitializeProtocolInstruction({ admin: authority, feeRecipient: authority, resolver: authority, collateralMint: new PublicKey(COLLATERAL_MINT), feeBps: PROTOCOL_LIMITS.tradingFeeBps, challengePeriod: BigInt(PROTOCOL_LIMITS.resolutionChallengeSeconds) }),
    );
    return { wallet, account, transaction, latest };
  }

  async function prepare() {
    setWorking(true); setMessage(undefined);
    try {
      const { transaction, latest } = await buildTransaction();
      const simulation = await cookieChainConnection.simulateTransaction(transaction);
      if (simulation.value.err) throw new Error("Cookie Chain rejected the initialization simulation.");
      const fee = await transaction.getEstimatedFee(cookieChainConnection);
      if (fee === null) throw new Error("Could not estimate the network fee.");
      setReview({ fee, config: deriveConfigAddress().toBase58(), blockHeight: latest.lastValidBlockHeight });
    } catch (error) { setReview(undefined); setMessage(error instanceof Error ? error.message : "Initialization review failed."); }
    finally { setWorking(false); }
  }

  async function initialize() {
    setWorking(true); setMessage(undefined);
    try {
      const { wallet, account, transaction } = await buildTransaction();
      const chain = account.chains?.find((value) => value.startsWith("solana:")) as `${string}:${string}` | undefined;
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const sendFeature = wallet.features?.["solana:signAndSendTransaction"] ?? wallet.features?.["standard:signAndSendTransaction"];
      const signFeature = wallet.features?.["solana:signTransaction"] ?? wallet.features?.["standard:signTransaction"];
      if (sendFeature && chain) {
        const result = await sendFeature.signAndSendTransaction({ account, transaction: serialized, chain, options: { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 3 } });
        if (!result[0]?.signature?.length) throw new Error("Nightly did not return a transaction signature.");
      } else if (signFeature) {
        const result = await signFeature.signTransaction({ account, transaction: serialized, chain, options: { preflightCommitment: "confirmed" } });
        const signed = result[0]?.signedTransaction;
        if (!signed?.length) throw new Error("Nightly did not return a signed transaction.");
        await cookieChainConnection.sendRawTransaction(signed, { preflightCommitment: "confirmed", maxRetries: 3, skipPreflight: false });
      } else {
        const available = Object.keys(wallet.features ?? {}).filter((name) => name.includes("sign")).join(", ");
        throw new Error(available ? `Nightly signing features are incompatible: ${available}` : "This Nightly version does not expose transaction signing. Update Nightly and reconnect.");
      }
      await waitForProtocol();
      setDeployed(true); setReview(undefined); setMessage("Protocol initialized and verified on Cookie Chain.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Initialization was cancelled or failed."); }
    finally { setWorking(false); }
  }

  if (deployed === undefined) return null;
  if (deployed) return message ? <section className="protocol-setup"><strong>{message}</strong></section> : null;
  return <section className="protocol-setup">
    <p className="eyebrow">ONE-TIME COOKIE CHAIN SETUP</p><h2>Initialize the live protocol</h2>
    <p>Your designated wallet becomes admin, fee recipient, and resolver. Collateral is real COOK, wrapped automatically for token-account compatibility; the trading fee is 1%, and challenged results wait 24 hours.</p>
    {!review ? <button className="primary-action" type="button" disabled={working} onClick={() => void prepare()}>{working ? "Checking…" : "Prepare initialization"}</button> : <div className="draft-ready">
      <strong>Simulation passed. Review before approving.</strong><p>Authority: {AUTHORITY}</p><p>Config: {review.config}</p><p>Maximum network fee estimate: {review.fee} base units</p><p>Prepared block expiry: {review.blockHeight}</p>
      <button className="primary-action" type="button" disabled={working} onClick={() => void initialize()}>{working ? "Waiting for Nightly…" : "Approve once in Nightly"}</button>
    </div>}
    {message ? <p role="alert">{message}</p> : null}
  </section>;
}
