"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { submitPreparedTransaction } from "@/lib/nightly-transaction";
import { formatTokenAmount } from "@/lib/token-amounts";
import { parseTokenAmount } from "@/lib/token-amounts";
import { quoteWholeShares } from "@/lib/amm-pool";

type PoolState = {
  creator: string;
  status: string;
  outcome: string;
  decimals: number;
  liquidity: string;
  yesReserve: string;
  noReserve: string;
  yesPercent: number;
  noPercent: number;
  maximumTrade: string;
  totalCreatorFees: string;
  creatorClaimable: string;
  settlementClaimed: boolean;
};

type Prepared = { unsignedTransaction: string; feePayer: string; blockhash: string; lastValidBlockHeight: number; quote?: { sharesOut: string; fee: string } };
type WalletPosition = { yes: { amountBaseUnits: string }; no: { amountBaseUnits: string } };

function display(amount: string, decimals: number) {
  return formatTokenAmount(BigInt(amount), decimals);
}

export function AmmTradePanel({ market }: { market: string }) {
  const [pool, setPool] = useState<PoolState>();
  const [wallet, setWallet] = useState<string>();
  const [position, setPosition] = useState<WalletPosition>();
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

  const refreshPosition = useCallback(async (address: string) => {
    const response = await fetch(`/api/protocol?position=${encodeURIComponent(market)}&user=${encodeURIComponent(address)}`, { cache: "no-store" });
    const data = await response.json() as { position?: WalletPosition };
    if (response.ok && data.position) setPosition(data.position);
  }, [market]);

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Pool is unavailable."));
    void connect().then((address) => refreshPosition(address)).catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 8_000);
    return () => window.clearInterval(timer);
  }, [connect, refresh, refreshPosition]);

  const quote = useMemo(() => {
    if (!pool || !/^\d+$/.test(amount) || amount === "0") return undefined;
    try { return quoteWholeShares(side, parseTokenAmount(amount, pool.decimals), BigInt(pool.liquidity), BigInt(pool.yesReserve), BigInt(pool.noReserve)); }
    catch { return undefined; }
  }, [amount, pool, side]);

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
      await refreshPosition(address);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Transaction cancelled.");
    } finally {
      setBusy(false);
    }
  }

  if (!pool) return <div className="amm-panel"><p role="status">{message}</p></div>;
  const trading = pool.status === "open";
  const creatorCanClaim = wallet === pool.creator && pool.status === "resolved" && !pool.settlementClaimed && BigInt(pool.creatorClaimable) > BigInt(0);
  const yesHeld = BigInt(position?.yes.amountBaseUnits ?? "0");
  const noHeld = BigInt(position?.no.amountBaseUnits ?? "0");
  const walletClaimable = pool.outcome === "yes" ? yesHeld : pool.outcome === "no" ? noHeld : pool.outcome === "invalid" ? (yesHeld + noHeld) / BigInt(2) : BigInt(0);

  return (
    <div className="amm-panel">
      <div className="amm-odds" aria-label="Current market odds">
        <button type="button" className={side === "yes" ? "selected yes" : "yes"} onClick={() => setSide("yes")}><span>YES</span><strong>{pool.yesPercent.toFixed(1)}%</strong></button>
        <button type="button" className={side === "no" ? "selected no" : "no"} onClick={() => setSide("no")}><span>NO</span><strong>{pool.noPercent.toFixed(1)}%</strong></button>
      </div>
      <div className="wallet-position"><span>Your YES <strong>{display(yesHeld.toString(), pool.decimals)}</strong></span><span>Your NO <strong>{display(noHeld.toString(), pool.decimals)}</strong></span><span>Claimable now <strong>{display(walletClaimable.toString(), pool.decimals)} COOK</strong></span></div>
      {trading ? <>
        <label className="amm-amount">Whole {side.toUpperCase()} shares<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} placeholder="5" /></label>
        {quote ? <div className="trade-summary"><span>Share cost <strong>{display(quote.netInput.toString(), pool.decimals)} COOK</strong></span><span>Creator fee <strong>{display(quote.fee.toString(), pool.decimals)} COOK</strong></span><span>Total payment <strong>{display(quote.grossInput.toString(), pool.decimals)} COOK</strong></span><span>If {side.toUpperCase()} wins <strong>{amount} COOK</strong></span></div> : amount ? <p className="form-error">That whole-share amount exceeds this trade’s current limit.</p> : null}
        <button className="primary-action amm-buy" type="button" disabled={busy || !quote} onClick={() => void execute("buy")}>{busy ? "Checking…" : `Buy ${amount || "0"} ${side.toUpperCase()}`}</button>
        <p className="amm-note">One winning share claims 1 COOK. The displayed total includes the 1% creator fee. New-market fees remain locked until settlement.</p>
      </> : <p className="amm-note">Trading is closed. Final outcome: <strong>{pool.outcome}</strong>.</p>}
      {creatorCanClaim ? <button className="primary-action" type="button" disabled={busy} onClick={() => void execute("claimCreator")}>Claim {display(pool.creatorClaimable, pool.decimals)} COOK creator settlement</button> : null}
      <div className="amm-stats"><span>Pool liquidity <strong>{display(pool.liquidity, pool.decimals)} COOK</strong></span><span>Creator fees earned <strong>{display(pool.totalCreatorFees, pool.decimals)} COOK</strong></span></div>
      {message ? <p className="amm-message" role="status">{message}</p> : null}
    </div>
  );
}
