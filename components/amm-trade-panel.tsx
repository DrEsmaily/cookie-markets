"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { submitPreparedTransaction } from "@/lib/nightly-transaction";
import { formatTokenAmount } from "@/lib/token-amounts";
import { parseTokenAmount } from "@/lib/token-amounts";
import { quoteWholeShares } from "@/lib/amm-pool";
import { readApiResponse } from "@/lib/api-response";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { buildBuyFromAmmInstruction } from "@/lib/cookie-markets-program";
import { buildCreateAssociatedTokenInstruction, buildSyncNativeInstruction, deriveAssociatedTokenAddress, NATIVE_MINT } from "@/lib/token-instructions";

type PoolState = {
  creator: string;
  collateralMint: string;
  yesMint: string;
  noMint: string;
  vault: string;
  status: string;
  outcome: string;
  decimals: number;
  liquidity: string;
  yesReserve: string;
  noReserve: string;
  yesPercent: number;
  noPercent: number;
  maximumTrade: string;
  liquidityProviderFeeBps: number;
  ownerFeeBps: number;
  ownerFeeRecipient: string;
  totalCreatorFees: string;
  creatorClaimable: string;
  settlementClaimed: boolean;
  closesAt: string;
};

type Prepared = { unsignedTransaction: string; feePayer: string; blockhash: string; lastValidBlockHeight: number; quote?: { sharesOut: string; fee: string } };
type WalletPosition = { yes: { amountBaseUnits: string }; no: { amountBaseUnits: string }; refund?: { yesShares: string; yesCost: string; noShares: string; noCost: string; refunded: boolean } };

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
    const data = await readApiResponse<PoolState & { error?: string }>(response, "The live pool returned an unreadable response. Please retry.");
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
    const data = await readApiResponse<{ position?: WalletPosition }>(response, "Your wallet position could not be read.");
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
    try { return quoteWholeShares(side, parseTokenAmount(amount, pool.decimals), BigInt(pool.liquidity), BigInt(pool.yesReserve), BigInt(pool.noReserve), pool.liquidityProviderFeeBps, pool.ownerFeeBps); }
    catch { return undefined; }
  }, [amount, pool, side]);

  async function execute(action: "buy" | "claimCreator" | "claimYes" | "claimNo") {
    setBusy(true);
    setMessage(action === "buy" ? "Checking the latest pool price…" : "Checking your settlement…");
    try {
      if (!pool) throw new Error("The latest pool state is not available yet.");
      const address = wallet ?? await connect();
      const claimingPosition = action === "claimYes" || action === "claimNo";
      const claimSide = action === "claimYes" ? "yes" : "no";
      const claimAmount = claimSide === "yes" ? yesHeld : noHeld;
      const prepared = action === "buy"
        ? await prepareBuyTransaction(pool, market, address, side, amount)
        : await prepareServerTransaction(claimingPosition ? "/api/positions/prepare" : "/api/amm", claimingPosition
          ? { action: "redeem", market, user: address, side: claimSide, amount: display(claimAmount.toString(), pool.decimals) }
          : { action, market, user: address, side, amount });
      setMessage("Simulation passed. Approve once in Nightly.");
      const signature = await submitPreparedTransaction(prepared);
      setMessage(claimingPosition
        ? `Claim confirmed: ${display(claimAmount.toString(), pool.decimals)} COOK. Your wallet may show a slightly larger native-balance increase when Nightly also returns temporary token-account rent.`
        : `Confirmed on Cookie Chain: ${signature.slice(0, 8)}…`);
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
  const trading = pool.status === "open" && Number(pool.closesAt) * 1_000 > Date.now();
  const creatorCanClaim = wallet === pool.creator && pool.status === "resolved" && !pool.settlementClaimed && BigInt(pool.creatorClaimable) > BigInt(0);
  const yesHeld = BigInt(position?.yes.amountBaseUnits ?? "0");
  const noHeld = BigInt(position?.no.amountBaseUnits ?? "0");
  const yesRefund = BigInt(position?.refund?.yesCost ?? "0");
  const noRefund = BigInt(position?.refund?.noCost ?? "0");
  const walletClaimable = pool.outcome === "yes" ? yesHeld : pool.outcome === "no" ? noHeld : pool.outcome === "invalid" ? (position?.refund ? yesRefund + noRefund : (yesHeld + noHeld) / BigInt(2)) : BigInt(0);
  const yesCanClaim = pool.status === "resolved" && yesHeld > BigInt(0) && (pool.outcome === "yes" || (pool.outcome === "invalid" && (!position?.refund || yesRefund > BigInt(0))));
  const noCanClaim = pool.status === "resolved" && noHeld > BigInt(0) && (pool.outcome === "no" || (pool.outcome === "invalid" && (!position?.refund || noRefund > BigInt(0))));
  const leadingSide = pool.status === "resolved" && pool.outcome !== "invalid" && pool.outcome !== "unresolved"
    ? pool.outcome
    : pool.yesPercent >= pool.noPercent ? "yes" : "no";

  return (
    <div className="amm-panel">
      <div className="amm-odds" aria-label="Current market odds">
        <button type="button" disabled={!trading} className={`yes ${side === "yes" && trading ? "selected" : ""} ${leadingSide === "yes" ? "leading" : "trailing"}`} onClick={() => setSide("yes")}><span>YES</span><strong>{pool.yesPercent.toFixed(1)}%</strong></button>
        <button type="button" disabled={!trading} className={`no ${side === "no" && trading ? "selected" : ""} ${leadingSide === "no" ? "leading" : "trailing"}`} onClick={() => setSide("no")}><span>NO</span><strong>{pool.noPercent.toFixed(1)}%</strong></button>
      </div>
      <div className="wallet-position"><span>Your YES <strong>{display(yesHeld.toString(), pool.decimals)}</strong></span><span>Your NO <strong>{display(noHeld.toString(), pool.decimals)}</strong></span><span>Claimable now <strong>{display(walletClaimable.toString(), pool.decimals)} COOK</strong></span></div>
      {trading ? <>
        <label className="amm-amount">Whole {side.toUpperCase()} shares<input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} placeholder="5" /></label>
        {quote ? <div className="trade-summary"><span>Base trade cost <strong>{display(quote.netInput.toString(), pool.decimals)} COOK</strong></span><span>Liquidity provider fee ({pool.liquidityProviderFeeBps / 100}%) <strong>{display(quote.liquidityProviderFee.toString(), pool.decimals)} COOK</strong></span><span>Platform fee ({pool.ownerFeeBps / 100}%) <strong>{display(quote.ownerFee.toString(), pool.decimals)} COOK</strong></span><span>Total fee <strong>{display(quote.totalFee.toString(), pool.decimals)} COOK</strong></span><span>Final total to pay <strong>{display(quote.grossInput.toString(), pool.decimals)} COOK</strong></span><span>Potential payout if {side.toUpperCase()} wins <strong>{amount} COOK</strong></span></div> : amount ? <p className="form-error">That whole-share amount exceeds this trade’s current limit.</p> : null}
        <button className="primary-action amm-buy" type="button" disabled={busy || !quote} onClick={() => void execute("buy")}>{busy ? "Checking…" : `Buy ${amount || "0"} ${side.toUpperCase()}`}</button>
        <p className="amm-note">One winning share claims 1 COOK. This market’s liquidity provider receives its LP fee after a valid result. Invalid markets refund the complete recorded payment, including deferred fees.</p>
      </> : pool.status === "resolved" ? <p className="amm-note">Trading is closed. Final outcome: <strong>{pool.outcome}</strong>. {pool.outcome === "invalid" ? position?.refund ? "The exact payment attributed to each position is refundable, including deferred fees." : "This is a legacy market; its original on-chain refund rule applies." : "Each winning share claims 1 COOK."}</p> : <p className="amm-note">Trading is closed. Resolution is in progress; funds remain safely locked until the result is final.</p>}
      {pool.outcome === "invalid" && position?.refund ? <div className="trade-summary"><span>Position held <strong>YES {display(yesHeld.toString(), pool.decimals)} · NO {display(noHeld.toString(), pool.decimals)}</strong></span><span>Amount originally attributable <strong>{display((yesRefund + noRefund).toString(), pool.decimals)} COOK</strong></span><span>Refundable amount <strong>{display(walletClaimable.toString(), pool.decimals)} COOK</strong></span><span>Final expected return <strong>{display(walletClaimable.toString(), pool.decimals)} COOK</strong></span></div> : null}
      {yesCanClaim ? <button className="primary-action" type="button" disabled={busy} onClick={() => void execute("claimYes")}>Claim {display((pool.outcome === "invalid" ? (position?.refund ? yesRefund : yesHeld / BigInt(2)) : yesHeld).toString(), pool.decimals)} COOK from YES</button> : null}
      {noCanClaim ? <button className="primary-action" type="button" disabled={busy} onClick={() => void execute("claimNo")}>Claim {display((pool.outcome === "invalid" ? (position?.refund ? noRefund : noHeld / BigInt(2)) : noHeld).toString(), pool.decimals)} COOK from NO</button> : null}
      {creatorCanClaim ? <button className="primary-action" type="button" disabled={busy} onClick={() => void execute("claimCreator")}>Claim {display(pool.creatorClaimable, pool.decimals)} COOK creator settlement</button> : null}
      <div className="amm-stats"><span>Pool liquidity <strong>{display(pool.liquidity, pool.decimals)} COOK</strong></span><span>Creator fees earned <strong>{display(pool.totalCreatorFees, pool.decimals)} COOK</strong></span></div>
      {message ? <p className="amm-message" role="status">{message}</p> : null}
    </div>
  );
}

async function prepareServerTransaction(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const prepared = await readApiResponse<Prepared & { error?: string }>(response, "The transaction service is temporarily unavailable. Please retry.");
  if (!response.ok) throw new Error(prepared.error ?? "The transaction could not be prepared.");
  return prepared;
}

async function prepareBuyTransaction(pool: PoolState, market: string, userAddress: string, side: "yes" | "no", amount: string): Promise<Prepared> {
  if (!/^\d+$/.test(amount) || amount === "0") throw new Error("Enter a whole number of shares.");
  const user = new PublicKey(userAddress);
  const marketAddress = new PublicKey(market);
  const creator = new PublicKey(pool.creator);
  const collateralMint = new PublicKey(pool.collateralMint);
  const yesMint = new PublicKey(pool.yesMint);
  const noMint = new PublicKey(pool.noMint);
  const vault = new PublicKey(pool.vault);
  const sharesOut = parseTokenAmount(amount, pool.decimals);
  const quote = quoteWholeShares(side, sharesOut, BigInt(pool.liquidity), BigInt(pool.yesReserve), BigInt(pool.noReserve), pool.liquidityProviderFeeBps, pool.ownerFeeBps);
  const userCollateral = deriveAssociatedTokenAddress(collateralMint, user);
  const userYes = deriveAssociatedTokenAddress(yesMint, user);
  const userNo = deriveAssociatedTokenAddress(noMint, user);
  const latest = await cookieChainConnection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: user, recentBlockhash: latest.blockhash }).add(
    buildCreateAssociatedTokenInstruction(user, collateralMint),
    buildCreateAssociatedTokenInstruction(user, yesMint),
    buildCreateAssociatedTokenInstruction(user, noMint),
  );
  if (collateralMint.equals(NATIVE_MINT)) transaction.add(
    SystemProgram.transfer({ fromPubkey: user, toPubkey: userCollateral, lamports: quote.grossInput }),
    buildSyncNativeInstruction(userCollateral),
  );
  transaction.add(await buildBuyFromAmmInstruction({
    market: marketAddress, creator, collateralMint, yesMint, noMint, vault,
    buyerCollateral: userCollateral, buyerYes: userYes, buyerNo: userNo,
    buyer: user, side, sharesOut, maximumTotalInput: quote.maximumTotalInput,
  }));
  const simulation = await cookieChainConnection.simulateTransaction(transaction);
  if (simulation.value.err) throw new Error("Transaction simulation failed. Nothing was signed or sent.");
  return {
    unsignedTransaction: toBase64(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
    feePayer: userAddress,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    quote: { sharesOut: sharesOut.toString(), fee: quote.fee.toString() },
  };
}

function toBase64(value: Uint8Array) {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
}
