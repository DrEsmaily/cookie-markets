"use client";

import { FormEvent, useEffect, useState } from "react";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import type { MarketTerms } from "@/lib/market-terms";
import type { VerifiedAsk } from "@/lib/protocol-accounts";
import { submitPreparedTransaction } from "@/lib/nightly-transaction";

type Preparation = {
  unsignedTransaction: string; order: string; sharesBaseUnits: string; maximumDebitBaseUnits?: string; minimumProceedsBaseUnits?: string;
  feePayer: string; blockhash: string; feeBaseUnits: string; lastValidBlockHeight: number; note: string;
  quote?: { collateral: string; fee: string; buyerDebit: string };
};

export function OrderPreparationForm({ market, terms, tradingAllowed = true }: { market: string; terms?: MarketTerms; tradingAllowed?: boolean }) {
  const [action, setAction] = useState("fill");
  const [orderType, setOrderType] = useState<"ask" | "bid">("ask");
  const [order, setOrder] = useState("");
  const [asks, setAsks] = useState<VerifiedAsk[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [discoveryLoaded, setDiscoveryLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [maximumDebit, setMaximumDebit] = useState("");
  const [nonce, setNonce] = useState("");
  const [side, setSide] = useState("yes");
  const [price, setPrice] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [wrapNative, setWrapNative] = useState(false);
  const [question, setQuestion] = useState(terms?.question ?? "");
  const [resolutionSource, setResolutionSource] = useState(terms?.resolutionSource ?? "");
  const [resolutionRules, setResolutionRules] = useState(terms?.resolutionRules ?? "");
  const [preparation, setPreparation] = useState<Preparation>();
  const [error, setError] = useState<string>();
  const [isPreparing, setIsPreparing] = useState(false);
  const [signature, setSignature] = useState<string>();

  useEffect(() => {
    setAsks([]); setDiscoveryLoaded(false); setDiscoveryError(undefined); setOrder(""); setPreparation(undefined);
    setNonce(Date.now().toString());
    const controller = new AbortController();
    async function discover() {
      try {
        const response = await fetch(`/api/protocol?${orderType === "bid" ? "bids" : "asks"}=${encodeURIComponent(market)}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json() as { asks?: VerifiedAsk[]; bids?: VerifiedAsk[]; error?: string };
        const records = orderType === "bid" ? result.bids : result.asks;
        if (!response.ok || result.error || !records) throw new Error(result.error ?? "Verified order discovery is unavailable.");
        setAsks(records);
        setDiscoveryLoaded(true);
      } catch (failure) {
        if (!controller.signal.aborted) setDiscoveryError(failure instanceof Error ? failure.message : "Could not load orders.");
      }
    }
    void discover();
    return () => controller.abort();
  }, [market, orderType]);

  function clearPreview() { setPreparation(undefined); setError(undefined); setSignature(undefined); }

  async function submit() {
    if (!preparation) return;
    setIsPreparing(true); setError(undefined);
    try {
      setSignature(await submitPreparedTransaction(preparation));
      setPreparation(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not submit the trade."); }
    finally { setIsPreparing(false); }
  }

  const bestYes = orderType === "ask" ? asks.find((candidate) => candidate.side === "yes" && !candidate.cancelled) : undefined;
  const bestNo = orderType === "ask" ? asks.find((candidate) => candidate.side === "no" && !candidate.cancelled) : undefined;

  function chooseOffer(offer: VerifiedAsk | undefined) {
    if (!offer) return;
    setAction("fill");
    setOrder(offer.address);
    setSide(offer.side);
    clearPreview();
  }

  function offerLabel(label: string, offer: VerifiedAsk | undefined) {
    if (!offer) return `${label} · no offer`;
    return `${label} · ${(Number(offer.price) / 10_000).toFixed(1)}¢`;
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearPreview();
    setIsPreparing(true);
    try {
      if (action !== "cancel" && !tradingAllowed) throw new Error("Published terms verification failed. New trades are disabled.");
      const wallet = window.nightly?.solana;
      const connect = wallet?.features?.["standard:connect"];
      if (!wallet || !connect) throw new Error("Install Nightly and select Cookie Chain first.");
      if (wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Select Cookie Chain in Nightly before reviewing a trade.");
      const { accounts } = await connect.connect();
      if (!accounts[0]) throw new Error("Nightly did not share an account.");
      const response = await fetch("/api/orders/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, user: accounts[0].address, action, orderType, order, amount, maximumDebit, minimumProceeds: maximumDebit, nonce, side, price, expiresAt: action === "place" ? Math.floor(new Date(expiresAt).getTime() / 1000).toString() : undefined, wrapNative: (orderType === "ask" ? action === "fill" : action === "place") && wrapNative, question, resolutionSource, resolutionRules }),
      });
      const result = await response.json() as Preparation & { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? "Trade preparation failed.");
      if (wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Wallet network changed. Prepare again.");
      setPreparation(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not prepare trade."); }
    finally { setIsPreparing(false); }
  }

  return <form className="draft-form" onSubmit={prepare} onChange={clearPreview}>
    <h2>Trade YES / NO</h2>
    <p>Buy an available YES or NO offer, place your own buy or sell offer, or cancel your offer. Every completed action is submitted to Cookie Chain through Nightly.</p>
    <div className="outcome-buttons" aria-label="Available outcome offers">
      <button type="button" disabled={!bestYes || isPreparing} onClick={() => chooseOffer(bestYes)}>{offerLabel("Buy YES", bestYes)}</button>
      <button type="button" disabled={!bestNo || isPreparing} onClick={() => chooseOffer(bestNo)}>{offerLabel("Buy NO", bestNo)}</button>
    </div>
    {!bestYes && !bestNo && discoveryLoaded && orderType === "ask" ? <p className="form-error">No shares are for sale yet. The market creator must first deposit COOK to mint a YES + NO pair, then place a sell offer below.</p> : null}
    {discoveryError ? <p role="alert">{discoveryError} You can supply an order address; the backend verifies it again.</p> : discoveryLoaded ? <p>{asks.length} verified order records loaded. Filled, cancelled, or expired records cannot be bought. This snapshot may change; preparation reads the order again.</p> : <p>Loading verified seller orders…</p>}
    <fieldset disabled={isPreparing}>
      <label className="form-field"><span>Order book side</span><select value={orderType} onChange={(event) => { setOrderType(event.target.value as "ask" | "bid"); setMaximumDebit(""); setWrapNative(false); }}><option value="ask">Seller offers (asks)</option><option value="bid">Buyer offers (bids)</option></select></label>
      <label className="form-field"><span>Operation</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="fill" disabled={!tradingAllowed}>{orderType === "bid" ? "Sell shares into a funded buyer offer" : "Buy shares from a seller offer"}</option><option value="place" disabled={!tradingAllowed}>{orderType === "bid" ? "Place a funded buy offer" : "Place an escrowed sell offer"}</option><option value="cancel">Cancel my offer</option></select></label>
      {action !== "place" ? <>
        {asks.length ? <label className="form-field"><span>Verified orders, sorted by price</span><select value={asks.some((ask) => ask.address === order) ? order : ""} onChange={(event) => setOrder(event.target.value)}><option value="">Choose an order or paste an address below</option>{asks.map((ask) => <option key={ask.address} value={ask.address}>{ask.side.toUpperCase()} · price {ask.price}/1000000 · {ask.remainingShares} share base units · {ask.cancelled ? "cancelled" : "expiry " + ask.expiresAt} · {ask.address}</option>)}</select></label> : null}
        <label className="form-field"><span>Order address</span><input value={order} onChange={(event) => setOrder(event.target.value)} required /></label>
      </> : null}
      {action !== "cancel" ? <label className="form-field"><span>Share amount in token units</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required /></label> : null}
      {action === "fill" ? <>
        <label className="form-field"><span>{orderType === "bid" ? "Minimum seller payment in collateral units" : "Maximum collateral debit, including trading fees"}</span><input value={maximumDebit} onChange={(event) => setMaximumDebit(event.target.value)} inputMode="decimal" required /></label>
      </> : null}
      {(orderType === "ask" && action === "fill") || (orderType === "bid" && action === "place") ? <label><input type="checkbox" checked={wrapNative} onChange={(event) => setWrapNative(event.target.checked)} /> Explicitly wrap native COOK to fund this purchase (native collateral only)</label> : null}
      {action === "place" ? <>
        <label className="form-field"><span>New order nonce (unsigned integer, never reused)</span><input value={nonce} onChange={(event) => setNonce(event.target.value)} inputMode="numeric" required /></label>
        <label className="form-field"><span>Share side</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="yes">YES</option><option value="no">NO</option></select></label>
        <label className="form-field"><span>Collateral price per share (greater than 0, at most 1)</span><input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" required /></label>
        <label className="form-field"><span>Order expiry in your local time, no later than market close</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /></label>
      </> : null}
      {action !== "cancel" ? <>
        <label className="form-field"><span>Exact question</span><input value={question} onChange={(event) => setQuestion(event.target.value)} required /></label>
        <label className="form-field"><span>Exact resolution source</span><input value={resolutionSource} onChange={(event) => setResolutionSource(event.target.value)} required /></label>
        <label className="form-field"><span>Exact settlement rules</span><textarea value={resolutionRules} onChange={(event) => setResolutionRules(event.target.value)} rows={4} required /></label>
      </> : null}
      <button className="primary-action form-action" type="submit" disabled={action !== "cancel" && !tradingAllowed}>{isPreparing ? "Checking transaction…" : "Review unsigned trade"}</button>
    </fieldset>
    {preparation?.minimumProceedsBaseUnits ? <p>Minimum seller payment: {preparation.minimumProceedsBaseUnits} collateral base units. The buyer escrow pays the trading fee separately.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {preparation ? <div className="draft-ready"><strong>Simulation passed. Ready for Nightly.</strong><p>Wallet: {preparation.feePayer} · Order: {preparation.order}</p><p>Shares: {preparation.sharesBaseUnits} base units · Network fee: {preparation.feeBaseUnits} base units · Block expiry: {preparation.lastValidBlockHeight}</p>{preparation.quote ? <p>Seller payment: {preparation.quote.collateral} · Trading fee: {preparation.quote.fee} · Total quoted debit: {preparation.quote.buyerDebit} · Maximum debit: {preparation.maximumDebitBaseUnits} collateral base units</p> : null}<button type="button" className="primary-action" disabled={isPreparing} onClick={() => void submit()}>{isPreparing ? "Waiting for Nightly…" : "Approve real trade in Nightly"}</button><details><summary>Unsigned trade transaction</summary><textarea value={preparation.unsignedTransaction} readOnly rows={6} aria-label="Unsigned trade transaction data" /></details></div> : null}
    {signature ? <p className="draft-ready"><strong>Trade confirmed on Cookie Chain.</strong> <a href={`${COOKIE_CHAIN.explorerUrl}/tx/${signature}`} target="_blank" rel="noreferrer">View transaction ↗</a></p> : null}
  </form>;
}
