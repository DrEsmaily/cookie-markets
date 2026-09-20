"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { formatTokenAmount } from "@/lib/token-amounts";

export type NightlyAccount = { address: string; chains?: readonly string[] };
type WalletActivity = { signature: string; slot: number; blockTime: number | null; status: "confirmed" | "failed"; amountBaseUnits: string };
type PortfolioPosition = { market: string; question: string; status: string; outcome: string; yes: string; no: string; creatorLiquidity: string; claimable: string };
type NightlyProvider = {
  solana?: {
    genesisHash?: string;
    features?: {
      "standard:connect"?: { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly NightlyAccount[] }> };
      "standard:disconnect"?: { disconnect: () => Promise<void> };
      "standard:signTransaction"?: { signTransaction: (input: { account: NightlyAccount; transaction: Uint8Array; chain?: `${string}:${string}`; options?: { preflightCommitment?: "confirmed" } }) => Promise<readonly { signedTransaction: Uint8Array }[]> };
      "standard:signAndSendTransaction"?: { signAndSendTransaction: (input: { account: NightlyAccount; transaction: Uint8Array; chain: `${string}:${string}`; options?: { commitment?: "confirmed"; preflightCommitment?: "confirmed"; maxRetries?: number } }) => Promise<readonly { signature: Uint8Array }[]> };
      "solana:signTransaction"?: { signTransaction: (input: { account: NightlyAccount; transaction: Uint8Array; chain?: `${string}:${string}`; options?: { preflightCommitment?: "confirmed" } }) => Promise<readonly { signedTransaction: Uint8Array }[]> };
      "solana:signAndSendTransaction"?: { signAndSendTransaction: (input: { account: NightlyAccount; transaction: Uint8Array; chain: `${string}:${string}`; options?: { commitment?: "confirmed"; preflightCommitment?: "confirmed"; maxRetries?: number } }) => Promise<readonly { signature: Uint8Array }[]> };
    };
  };
};

declare global {
  interface Window {
    nightly?: NightlyProvider;
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatActivityTime(blockTime: number | null) {
  if (!blockTime) return "time unavailable";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(blockTime * 1_000);
}

export function WalletButton() {
  const [address, setAddress] = useState<string>();
  const [balance, setBalance] = useState<number>();
  const [activity, setActivity] = useState<WalletActivity[]>([]);
  const [portfolio, setPortfolio] = useState<{ decimals: number; positions: PortfolioPosition[] }>();
  const [message, setMessage] = useState<string>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const loadBalance = useCallback(async (walletAddress: string) => {
    const response = await fetch(`/api/balance/${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { amount: number };
    setBalance(data.amount);
  }, []);

  const loadActivity = useCallback(async (walletAddress: string) => {
    const response = await fetch(`/api/activity/${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { activity: WalletActivity[] };
    setActivity(data.activity);
  }, []);

  const loadPortfolio = useCallback(async (walletAddress: string) => {
    const response = await fetch(`/api/portfolio/${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
    if (!response.ok) return;
    setPortfolio(await response.json() as { decimals: number; positions: PortfolioPosition[] });
  }, []);

  const connect = useCallback(async (silent = false) => {
    const connectFeature = window.nightly?.solana?.features?.["standard:connect"];
    if (!connectFeature) {
      if (!silent) setMessage("Install Nightly to connect a Cookie Chain wallet.");
      return;
    }

    if (!silent) setIsConnecting(true);
    setMessage(undefined);
    try {
      const { accounts } = await connectFeature.connect({ silent });
      const account = accounts[0];
      if (!account) {
        if (!silent) setMessage("No account was shared by Nightly.");
        return;
      }
      setAddress(account.address);
      await Promise.all([loadBalance(account.address), loadActivity(account.address), loadPortfolio(account.address)]);
      const activeGenesisHash = window.nightly?.solana?.genesisHash;
      if (activeGenesisHash && activeGenesisHash !== COOKIE_CHAIN.genesisHash) {
        setMessage("Nightly is connected, but not to Cookie Chain. Select the Cookie Chain custom network before trading.");
      }
    } catch {
      if (!silent) setMessage("Wallet connection was cancelled or unavailable.");
    } finally {
      if (!silent) setIsConnecting(false);
    }
  }, [loadActivity, loadBalance, loadPortfolio]);

  useEffect(() => {
    const silentConnect = window.setTimeout(() => void connect(true), 250);
    return () => window.clearTimeout(silentConnect);
  }, [connect]);

  useEffect(() => {
    if (!address) return;
    const refresh = window.setInterval(() => void Promise.all([loadBalance(address), loadPortfolio(address)]), 15_000);
    return () => window.clearInterval(refresh);
  }, [address, loadBalance, loadPortfolio]);

  async function disconnect() {
    await window.nightly?.solana?.features?.["standard:disconnect"]?.disconnect();
    setAddress(undefined);
    setBalance(undefined);
    setActivity([]);
    setPortfolio(undefined);
    setIsOpen(false);
    setMessage(undefined);
  }

  return (
    <div className="wallet-control">
      <button className="wallet-button" type="button" onClick={() => address ? setIsOpen((current) => !current) : void connect(false)} disabled={isConnecting} aria-expanded={address ? isOpen : undefined}>
        {address ? shortAddress(address) : isConnecting ? "Connecting…" : "Connect Nightly"}
      </button>
      {address ? <button className="disconnect-button" type="button" onClick={() => void disconnect()} aria-label="Disconnect Nightly" title="Disconnect Nightly">×</button> : null}
      {address && isOpen ? <div className="wallet-panel">
        <div><span>Connected address</span><a href={`${COOKIE_CHAIN.explorerUrl}/address/${address}`} target="_blank" rel="noreferrer"><strong>{shortAddress(address)} ↗</strong></a></div>
        <div><span>Native balance</span><strong>{balance?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"} COOK</strong></div>
        <div><span>Creator liquidity locked</span><strong>{portfolio ? formatTokenAmount(portfolio.positions.reduce((total, item) => total + BigInt(item.status === "resolved" ? "0" : item.creatorLiquidity), BigInt(0)), portfolio.decimals) : "—"} COOK</strong></div>
        <div><span>Claimable now</span><strong>{portfolio ? formatTokenAmount(portfolio.positions.reduce((total, item) => total + BigInt(item.claimable), BigInt(0)), portfolio.decimals) : "—"} COOK</strong></div>
        <p>Your positions</p>
        {portfolio?.positions.length ? <ul className="portfolio-list">{portfolio.positions.map((position) => <li key={position.market}><Link href={`/markets/${position.market}`}><strong>{position.question}</strong><small>YES {formatTokenAmount(BigInt(position.yes), portfolio.decimals)} · NO {formatTokenAmount(BigInt(position.no), portfolio.decimals)} · claimable {formatTokenAmount(BigInt(position.claimable), portfolio.decimals)} COOK</small></Link></li>)}</ul> : <small>No active or claimable positions.</small>}
        <p>Latest activity</p>
        {activity.length ? <ul className="activity-list">{activity.slice(0, 3).map((item) => { const amount = BigInt(item.amountBaseUnits); return <li key={item.signature}><a href={`${COOKIE_CHAIN.explorerUrl}/tx/${item.signature}`} target="_blank" rel="noreferrer"><strong className={amount >= BigInt(0) ? "amount-positive" : "amount-negative"}>{amount >= BigInt(0) ? "+" : "−"}{formatTokenAmount(amount < BigInt(0) ? -amount : amount, 9)} COOK</strong><small>{formatActivityTime(item.blockTime)} UTC</small></a></li>; })}</ul> : <small>No activity since the refreshed launch.</small>}
      </div> : null}
      {message ? <p className="wallet-message">{message}</p> : null}
    </div>
  );
}
