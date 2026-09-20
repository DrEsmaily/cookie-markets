"use client";

import { useState } from "react";
import { formatMarketText } from "@/lib/market-lifecycle";

type Evidence = { serialized: string; evidenceHash: string; providerUrl: string; record: { decision: { outcome: "yes" | "no" | "invalid"; reason?: string }; publishedAt: string }; note: string };

export function PriceEvidenceReview({ market, settlesAt }: { market: string; settlesAt: string }) {
  const [asset, setAsset] = useState("BTC");
  const [targetUsd, setTargetUsd] = useState("");
  const [direction, setDirection] = useState<"above" | "under">("above");
  const [evidence, setEvidence] = useState<Evidence>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function collect() {
    setPending(true); setEvidence(undefined); setError(undefined);
    try {
      const response = await fetch("/api/protocol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "collect-price-evidence", market, asset, direction, targetUsd, settlesAt }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Evidence collection failed.");
      setEvidence(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Evidence collection failed."); }
    finally { setPending(false); }
  }

  function download() {
    if (!evidence) return;
    const url = URL.createObjectURL(new Blob([evidence.serialized], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `evidence-${evidence.evidenceHash}.json`; anchor.click();
    URL.revokeObjectURL(url);
  }

  return <section className="draft-form">
    <h2>Collect price settlement evidence</h2>
    <p>For Coinbase candle-template markets only. Enter the asset and threshold committed in this market’s rules. The server verifies them against the actual on-chain hashes before fetching the exact preceding closed minute. Missing data never causes source substitution.</p>
    <p>Settlement deadline: {formatMarketText(settlesAt)}. Collection is available after the completed settlement minute.</p>
    <fieldset disabled={pending}>
      <label className="form-field"><span>Asset</span><select value={asset} onChange={(event) => { setAsset(event.target.value); setEvidence(undefined); }}><option value="BTC">BTC / USD</option><option value="ETH">ETH / USD</option></select></label>
      <label className="form-field"><span>Direction</span><select value={direction} onChange={(event) => { setDirection(event.target.value as "above" | "under"); setEvidence(undefined); }}><option value="above">Above</option><option value="under">Under</option></select></label>
      <label className="form-field"><span>Exact USD threshold</span><input inputMode="decimal" value={targetUsd} onChange={(event) => { setTargetUsd(event.target.value); setEvidence(undefined); }} /></label>
      <button className="secondary-action" type="button" disabled={!targetUsd} onClick={() => void collect()}>{pending ? "Collecting evidence…" : "Collect and review evidence"}</button>
    </fieldset>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {evidence ? <div className="draft-ready"><strong>Candidate outcome: {evidence.record.decision.outcome.toUpperCase()}</strong><p>{evidence.record.decision.reason}</p><p>{evidence.note}</p><p>Collected: {formatMarketText(evidence.record.publishedAt)} · SHA-256: {evidence.evidenceHash}</p><p>Provider request: {evidence.providerUrl}</p><button type="button" onClick={download}>Download exact evidence JSON</button><details><summary>Original response and evidence record</summary><textarea readOnly rows={8} value={evidence.serialized} aria-label="Price evidence JSON" /></details><p>This does not propose or finalize a result. Publish the evidence durably and have the named resolver independently verify it before requesting any settlement signature.</p></div> : null}
  </section>;
}
