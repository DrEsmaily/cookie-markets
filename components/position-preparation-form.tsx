"use client";

import { FormEvent, useState } from "react";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import type { MarketTerms } from "@/lib/market-terms";
import { formatTokenAmount } from "@/lib/token-amounts";
import { submitPreparedTransaction } from "@/lib/nightly-transaction";
import { readApiResponse } from "@/lib/api-response";

type Preparation = { unsignedTransaction: string; feePayer: string; blockhash: string; amountBaseUnits: string; feeBaseUnits: string; lastValidBlockHeight: number; note: string };

export function PositionPreparationForm({ market, terms, depositsAllowed = true }: { market: string; terms?: MarketTerms; depositsAllowed?: boolean }) {
  const [action, setAction] = useState(depositsAllowed ? "split" : "merge");
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState("yes");
  const [question, setQuestion] = useState(terms?.question ?? "");
  const [resolutionSource, setResolutionSource] = useState(terms?.resolutionSource ?? "");
  const [resolutionRules, setResolutionRules] = useState(terms?.resolutionRules ?? "");
  const [preparation, setPreparation] = useState<Preparation>();
  const [error, setError] = useState<string>();
  const [isPreparing, setIsPreparing] = useState(false);
  const [balances, setBalances] = useState<{ user: string; collateral: string; yes: string; no: string; checkedAt: string }>();
  const [isReading, setIsReading] = useState(false);
  const [signature, setSignature] = useState<string>();

  async function refreshBalances() {
    setBalances(undefined); setError(undefined); setIsReading(true);
    try {
      const wallet = window.nightly?.solana;
      if (wallet?.genesisHash && wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Select Cookie Chain in Nightly first.");
      const connected = await wallet?.features?.["standard:connect"]?.connect();
      const user = connected?.accounts[0]?.address;
      if (!user) throw new Error("Nightly did not share an account.");
      const response = await fetch(`/api/protocol?position=${encodeURIComponent(market)}&user=${encodeURIComponent(user)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const result = await readApiResponse<{ deployed?: boolean; collateralDecimals: number; position?: { user: string; market: string; collateral: { amountBaseUnits: string }; yes: { amountBaseUnits: string }; no: { amountBaseUnits: string } }; error?: string }>(response, "Position balances returned an unreadable response.");
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
      const result = await readApiResponse<{ error?: string }>(response, "Terms publication returned an unreadable response.");
      if (!response.ok) throw new Error(result.error ?? "Terms publication failed.");
      window.location.reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not publish readable terms."); }
    finally { setIsPreparing(false); }
  }

  function clearPreview() { setPreparation(undefined); setError(undefined); setSignature(undefined); }

  async function submit() {
    if (!preparation) return;
    setIsPreparing(true); setError(undefined);
    try {
      setSignature(await submitPreparedTransaction(preparation));
      setPreparation(undefined);
      await refreshBalances();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not submit the transaction."); }
    finally { setIsPreparing(false); }
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearPreview();
    setIsPreparing(true);
    try {
      if (action === "split" && !depositsAllowed) throw new Error("Published terms verification failed. Deposits are disabled.");
      const wallet = window.nightly?.solana;
      const connect = wallet?.features?.["standard:connect"];
      if (!wallet || !connect) throw new Error("Install Nightly and select Cookie Chain first.");
      if (wallet.genesisHash && wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Select Cookie Chain in Nightly. An unknown or different network cannot be used.");
      const { accounts } = await connect.connect();
      const account = accounts[0];
      if (!account) throw new Error("Nightly did not share an account.");
      const response = await fetch("/api/positions/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, user: account.address, action, amount, side: action === "redeem" ? side : undefined, wrapNative: action === "split", question, resolutionSource, resolutionRules }),
      });
      const result = await readApiResponse<Preparation & { error?: string }>(response, "Transaction preparation returned an unreadable response.");
      if (!response.ok || result.error) throw new Error(result.error ?? "Transaction preparation failed.");
      setPreparation(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not prepare the transaction.");
    } finally { setIsPreparing(false); }
  }

  return (
    <form className="draft-form" onSubmit={prepare} onChange={clearPreview}>
      <h2>Manage YES / NO shares</h2>
      <button className="secondary-action" type="button" disabled={isReading || isPreparing} onClick={() => void refreshBalances()}>{isReading ? "Reading holdings…" : "Refresh my on-chain holdings"}</button>
      {balances ? <div className="draft-ready"><strong>Holdings snapshot · {balances.checkedAt}</strong><p>Wallet: {balances.user}</p><p>Collateral: {balances.collateral} · YES: {balances.yes} · NO: {balances.no} token units</p><p>Associated token accounts only; native COOK, other token accounts and escrowed orders are excluded. Refresh after changing wallets. This is not a payout quote.</p></div> : null}
      <p>Deposit COOK to create equal YES and NO shares, merge an equal pair back into COOK, or redeem winning shares after settlement.</p>
      <label className="form-field"><span>Action</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="split" disabled={!depositsAllowed}>Create YES + NO shares with COOK</option><option value="merge">Return a YES + NO pair for COOK</option><option value="redeem">Claim winnings after settlement</option></select></label>
      <label className="form-field"><span>Amount in token units</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" required /></label>
      {action === "redeem" ? <label className="form-field"><span>Share side</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="yes">YES</option><option value="no">NO</option></select></label> : null}
      {action === "split" && !terms ? <details><summary>Market verification details</summary><label className="form-field"><span>Exact question</span><input value={question} onChange={(event) => setQuestion(event.target.value)} required /></label><label className="form-field"><span>Exact resolution source</span><input value={resolutionSource} onChange={(event) => setResolutionSource(event.target.value)} required /></label><label className="form-field"><span>Exact settlement rules</span><textarea value={resolutionRules} onChange={(event) => setResolutionRules(event.target.value)} rows={5} required /></label><button className="secondary-action" type="button" disabled={isPreparing || !question || !resolutionSource || !resolutionRules} onClick={() => void publishTerms()}>Verify and publish terms</button></details> : null}
      <button className="primary-action form-action" type="submit" disabled={isPreparing || (action === "split" && !depositsAllowed)}>{isPreparing ? "Checking…" : action === "split" ? "Review COOK deposit" : "Review transaction"}</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preparation ? <div className="draft-ready"><strong>Simulation passed. Ready for Nightly.</strong><p>{preparation.note}</p><p>Amount: {preparation.amountBaseUnits} base units · estimated network fee: {preparation.feeBaseUnits} base units · expires after block {preparation.lastValidBlockHeight}.</p><button type="button" className="primary-action" disabled={isPreparing} onClick={() => void submit()}>{isPreparing ? "Waiting for Nightly…" : "Approve real transaction in Nightly"}</button><details><summary>Unsigned transaction</summary><textarea value={preparation.unsignedTransaction} readOnly rows={6} aria-label="Unsigned transaction data" /></details></div> : null}
      {signature ? <p className="draft-ready"><strong>Confirmed on Cookie Chain.</strong> <a href={`${COOKIE_CHAIN.explorerUrl}/tx/${signature}`} target="_blank" rel="noreferrer">View transaction ↗</a></p> : null}
    </form>
  );
}
