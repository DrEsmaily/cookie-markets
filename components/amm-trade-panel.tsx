"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { submitPreparedTransaction } from "@/lib/nightly-transaction";
import { formatTokenAmount } from "@/lib/token-amounts";

type PoolState = {
  creator: string;
  status: string;
  outcome: string;
  decimals: number;
  liquidity: string;
  yesPercent: number;
  noPercent: number;
  maximumTrade: string;
  totalCreatorFees: string;
  creatorClaimable: string;
  settlementClaimed: boolean;
};

type Prepared = { unsignedTransaction: string; feePayer: string; blockhash: string; lastValidBlockHeight: number; quote?: { sharesOut: string; fee: string } };

function display(amount: string, decimals: number) {
  return formatTokenAmount(BigInt(amount), decimals);
}

export function AmmTradePanel({ market }: { market: string }) {
  const [pool, setPool] = useState<PoolState>();
  const [wallet, setWallet] = useState<string>();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("Loading live pool…");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/amm?market=${encodeURIComponent(market)}`, { cache: "no-store" });
    const data = await response.json() as PoolState & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Pool is unavailable.");
    setPool(data);
    setMessage("");
  }, [market]);

  const connect = useCallback(async () => {
    const feature = window.nightly?.solana?.features?.["standard:connect"];
    if (!feature) throw new Error("Install Nightly and select Cookie Chain first.");
    const account = (await feature.connect()).accounts[0];
    if (!account) throw new Error("Nightly did not share an account.");
    setWallet(account.address);
    return account.address;
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Pool is unavailable."));
    void connect().catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 8_000);
    return () => window.clearInterval(timer);
  }, [connect, refresh]);

  const maximum = useMemo(() => pool ? display(pool.maximumTrade, pool.decimals) : "0", [pool]);

  async function execute(action: "buy" | "claimCreator") {
    setBusy(true);
    setMessage(action === "buy" ? "Checking the latest pool price…" : "Checking your settlement…");
    try {
      const address = wallet ?? await connect();
      const response = await fetch("/api/amm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, market, user: address, side, amount }),
      });
      const prepared = await response.json() as Prepared & { error?: string };
      if (!response.ok) throw new Error(prepared.error ?? "The transaction could not be prepared.");
      setMessage("Simulation passed. Approve once in Nightly.");
      const signature = await submitPreparedTransaction(prepared);
      setMessage(`Confirmed on Cookie Chain: ${signature.slice(0, 8)}…`);
      setAmount("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Transaction cancelled.");
    } finally {
      setBusy(false);
    }
  }

  if (!pool) return <div className="amm-panel"><p role="status">{message}</p></div>;
  const trading = pool.status === "open";
  const creatorCanClaim = wallet === pool.creator && pool.status === "resolved" && !pool.settlementClaimed && BigInt(pool.creatorClaimable) > BigInt(0);

  return (
    <div className="amm-panel">
      <div className="amm-odds" aria-label="Current market odds">
        <button type="button" className={side === "yes" ? "selected yes" : "yes"} onClick={() => setSide("yes")}><span>YES</span><strong>{pool.yesPercent.toFixed(1)}%</strong></button>
        <button type="button" className={side === "no" ? "selected no" : "no"} onClick={() => setSide("no")}><span>NO</span><strong>{pool.noPercent.toFixed(1)}%</strong></button>
      </div>
      {trading ? <>
        <label className="amm-amount">Amount in COOK<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`Maximum ${maximum}`} /></label>
        <div className="amm-limit"><span>Maximum this purchase</span><button type="button" onClick={() => setAmount(maximum)}>{maximum} COOK</button></div>
        <button className="primary-action amm-buy" type="button" disabled={busy || !amount} onClick={() => void execute("buy")}>{busy ? "Checking…" : `Buy ${side.toUpperCase()}`}</button>
        <p className="amm-note">Includes a 1% creator fee. The contract limits every purchase to 1% of current liquidity and protects it with maximum 1% slippage.</p>
      </> : <p className="amm-note">Trading is closed. Final outcome: <strong>{pool.outcome}</strong>.</p>}
      {creatorCanClaim ? <button className="primary-action" type="button" disabled={busy} onClick={() => void execute("claimCreator")}>Claim {display(pool.creatorClaimable, pool.decimals)} COOK creator settlement</button> : null}
      <div className="amm-stats"><span>Pool liquidity <strong>{display(pool.liquidity, pool.decimals)} COOK</strong></span><span>Creator fees earned <strong>{display(pool.totalCreatorFees, pool.decimals)} COOK</strong></span></div>
      {message ? <p className="amm-message" role="status">{message}</p> : null}
    </div>
  );
}
