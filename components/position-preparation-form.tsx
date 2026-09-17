"use client";

import { FormEvent, useState } from "react";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";

type Preparation = { unsignedTransaction: string; amountBaseUnits: string; feeBaseUnits: string; lastValidBlockHeight: number; note: string };

export function PositionPreparationForm({ market }: { market: string }) {
  const [action, setAction] = useState("split");
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState("yes");
  const [wrapNative, setWrapNative] = useState(false);
  const [question, setQuestion] = useState("");
  const [resolutionSource, setResolutionSource] = useState("");
  const [resolutionRules, setResolutionRules] = useState("");
  const [preparation, setPreparation] = useState<Preparation>();
  const [error, setError] = useState<string>();
  const [isPreparing, setIsPreparing] = useState(false);

  function clearPreview() { setPreparation(undefined); setError(undefined); }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearPreview();
    setIsPreparing(true);
    try {
      const wallet = window.nightly?.solana;
      const connect = wallet?.features?.["standard:connect"];
      if (!wallet || !connect) throw new Error("Install Nightly and select Cookie Chain first.");
      if (wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Select Cookie Chain in Nightly. An unknown or different network cannot be used.");
      const { accounts } = await connect.connect();
      const account = accounts[0];
      if (!account) throw new Error("Nightly did not share an account.");
      const response = await fetch("/api/positions/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, user: account.address, action, amount, side: action === "redeem" ? side : undefined, wrapNative: action === "split" && wrapNative, question, resolutionSource, resolutionRules }),
      });
      const result = await response.json() as Preparation & { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? "Transaction preparation failed.");
      setPreparation(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not prepare the transaction.");
    } finally { setIsPreparing(false); }
  }

  return (
    <form className="draft-form" onSubmit={prepare} onChange={clearPreview}>
      <h2>Prepare a real protocol transaction</h2>
      <p>This simulates the actual contract. It does not sign or submit anything. Complete sets contain equal YES and NO shares; this is not a single-side purchase or a price quote.</p>
      <label className="form-field"><span>Operation</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="split">Deposit collateral for a YES + NO set</option><option value="merge">Return a YES + NO set for collateral</option><option value="redeem">Redeem finalized shares</option></select></label>
      <label className="form-field"><span>Amount in token units</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" required /></label>
      {action === "redeem" ? <label className="form-field"><span>Share side</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="yes">YES</option><option value="no">NO</option></select></label> : null}
      {action === "split" ? <>
        <label className="form-field"><span>Exact question</span><input value={question} onChange={(event) => setQuestion(event.target.value)} required /></label>
        <label className="form-field"><span>Exact resolution source</span><input value={resolutionSource} onChange={(event) => setResolutionSource(event.target.value)} required /></label>
        <label className="form-field"><span>Exact settlement rules</span><textarea value={resolutionRules} onChange={(event) => setResolutionRules(event.target.value)} rows={5} required /></label>
        <label><input type="checkbox" checked={wrapNative} onChange={(event) => setWrapNative(event.target.checked)} /> Wrap native COOK for this deposit (native-mint collateral only)</label>
        <p>Deposits are refused if these readable terms do not match the on-chain question and rules hashes.</p>
      </> : null}
      <button className="primary-action form-action" type="submit" disabled={isPreparing}>{isPreparing ? "Simulating…" : "Simulate unsigned transaction"}</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preparation ? <div className="draft-ready"><strong>Simulation passed. Nothing was sent.</strong><p>{preparation.note}</p><p>Amount: {preparation.amountBaseUnits} base units · estimated network fee: {preparation.feeBaseUnits} base units · expires after block {preparation.lastValidBlockHeight}. Prepare again before any future signing.</p><details><summary>Unsigned transaction</summary><textarea value={preparation.unsignedTransaction} readOnly rows={6} aria-label="Unsigned transaction data" /></details></div> : null}
    </form>
  );
}
