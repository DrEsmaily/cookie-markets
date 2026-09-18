"use client";

import { FormEvent, useState } from "react";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import type { MarketTerms } from "@/lib/market-terms";
import { formatTokenAmount } from "@/lib/token-amounts";

type Preparation = { unsignedTransaction: string; amountBaseUnits: string; feeBaseUnits: string; lastValidBlockHeight: number; note: string };

export function PositionPreparationForm({ market, terms, depositsAllowed = true }: { market: string; terms?: MarketTerms; depositsAllowed?: boolean }) {
  const [action, setAction] = useState(depositsAllowed ? "split" : "merge");
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState("yes");
  const [wrapNative, setWrapNative] = useState(false);
  const [question, setQuestion] = useState(terms?.question ?? "");
  const [resolutionSource, setResolutionSource] = useState(terms?.resolutionSource ?? "");
  const [resolutionRules, setResolutionRules] = useState(terms?.resolutionRules ?? "");
  const [preparation, setPreparation] = useState<Preparation>();
  const [error, setError] = useState<string>();
  const [isPreparing, setIsPreparing] = useState(false);
  const [balances, setBalances] = useState<{ user: string; collateral: string; yes: string; no: string; checkedAt: string }>();
  const [isReading, setIsReading] = useState(false);

  async function refreshBalances() {
    setBalances(undefined); setError(undefined); setIsReading(true);
    try {
      const wallet = window.nightly?.solana;
      if (wallet?.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Select Cookie Chain in Nightly first.");
      const connected = await wallet.features?.["standard:connect"]?.connect();
      const user = connected?.accounts[0]?.address;
      if (!user) throw new Error("Nightly did not share an account.");
      const response = await fetch(`/api/protocol?position=${encodeURIComponent(market)}&user=${encodeURIComponent(user)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok || !result.deployed || !result.position) throw new Error(result.error ?? "Protocol position balances are unavailable.");
      if (result.position.user !== user || result.position.market !== market) throw new Error("Position response does not match the requested wallet and market.");
      setBalances({ user, collateral: formatTokenAmount(BigInt(result.position.collateral.amountBaseUnits), result.collateralDecimals), yes: formatTokenAmount(BigInt(result.position.yes.amountBaseUnits), result.collateralDecimals), no: formatTokenAmount(BigInt(result.position.no.amountBaseUnits), result.collateralDecimals), checkedAt: new Date().toLocaleTimeString() });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not read position balances."); }
    finally { setIsReading(false); }
  }

  async function publishTerms() {
    clearPreview(); setIsPreparing(true);
    try {
      const response = await fetch("/api/protocol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, question, resolutionSource, resolutionRules }), signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Terms publication failed.");
      window.location.reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not publish readable terms."); }
    finally { setIsPreparing(false); }
  }

  function clearPreview() { setPreparation(undefined); setError(undefined); }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearPreview();
    setIsPreparing(true);
    try {
      if (action === "split" && !depositsAllowed) throw new Error("Published terms verification failed. Deposits are disabled.");
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
      <button className="secondary-action" type="button" disabled={isReading || isPreparing} onClick={() => void refreshBalances()}>{isReading ? "Reading holdings…" : "Refresh my on-chain holdings"}</button>
      {balances ? <div className="draft-ready"><strong>Holdings snapshot · {balances.checkedAt}</strong><p>Wallet: {balances.user}</p><p>Collateral: {balances.collateral} · YES: {balances.yes} · NO: {balances.no} token units</p><p>Associated token accounts only; native COOK, other token accounts and escrowed orders are excluded. Refresh after changing wallets. This is not a payout quote.</p></div> : null}
      <p>This simulates the actual contract. It does not sign or submit anything. Complete sets contain equal YES and NO shares; this is not a single-side purchase or a price quote.</p>
      <label className="form-field"><span>Operation</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="split" disabled={!depositsAllowed}>Deposit collateral for a YES + NO set</option><option value="merge">Return a YES + NO set for collateral</option><option value="redeem">Redeem finalized shares</option></select></label>
      <label className="form-field"><span>Amount in token units</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" required /></label>
      {action === "redeem" ? <label className="form-field"><span>Share side</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="yes">YES</option><option value="no">NO</option></select></label> : null}
      {action === "split" ? <>
        <label className="form-field"><span>Exact question</span><input value={question} onChange={(event) => setQuestion(event.target.value)} required /></label>
        <label className="form-field"><span>Exact resolution source</span><input value={resolutionSource} onChange={(event) => setResolutionSource(event.target.value)} required /></label>
        <label className="form-field"><span>Exact settlement rules</span><textarea value={resolutionRules} onChange={(event) => setResolutionRules(event.target.value)} rows={5} required /></label>
        <label><input type="checkbox" checked={wrapNative} onChange={(event) => setWrapNative(event.target.checked)} /> Wrap native COOK for this deposit (native-mint collateral only)</label>
        <p>Deposits are refused if these readable terms do not match the on-chain question and rules hashes.</p>
        <button className="secondary-action" type="button" disabled={isPreparing || !question || !resolutionSource || !resolutionRules} onClick={() => void publishTerms()}>Publish these exact public terms</button>
        <p>Publication stores public text only after verifying its on-chain hashes. It requires operator-configured persistent storage, not a wallet signature.</p>
      </> : null}
      <button className="primary-action form-action" type="submit" disabled={isPreparing}>{isPreparing ? "Simulating…" : "Simulate unsigned transaction"}</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preparation ? <div className="draft-ready"><strong>Simulation passed. Nothing was sent.</strong><p>{preparation.note}</p><p>Amount: {preparation.amountBaseUnits} base units · estimated network fee: {preparation.feeBaseUnits} base units · expires after block {preparation.lastValidBlockHeight}. Prepare again before any future signing.</p><details><summary>Unsigned transaction</summary><textarea value={preparation.unsignedTransaction} readOnly rows={6} aria-label="Unsigned transaction data" /></details></div> : null}
    </form>
  );
}
