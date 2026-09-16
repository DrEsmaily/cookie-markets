"use client";

import { useCallback, useEffect, useState } from "react";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";

type NightlyAccount = { address: string };
type NightlyProvider = {
  solana?: {
    genesisHash?: string;
    features?: {
      "standard:connect"?: { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly NightlyAccount[] }> };
      "standard:disconnect"?: { disconnect: () => Promise<void> };
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

export function WalletButton() {
  const [address, setAddress] = useState<string>();
  const [balance, setBalance] = useState<number>();
  const [message, setMessage] = useState<string>();
  const [isConnecting, setIsConnecting] = useState(false);

  const loadBalance = useCallback(async (walletAddress: string) => {
    const response = await fetch(`/api/balance/${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { amount: number };
    setBalance(data.amount);
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
      await loadBalance(account.address);
      const activeGenesisHash = window.nightly?.solana?.genesisHash;
      if (activeGenesisHash && activeGenesisHash !== COOKIE_CHAIN.genesisHash) {
        setMessage("Nightly is connected, but not to Cookie Chain. Select the Cookie Chain custom network before trading.");
      }
    } catch {
      if (!silent) setMessage("Wallet connection was cancelled or unavailable.");
    } finally {
      if (!silent) setIsConnecting(false);
    }
  }, [loadBalance]);

  useEffect(() => {
    const silentConnect = window.setTimeout(() => void connect(true), 250);
    return () => window.clearTimeout(silentConnect);
  }, [connect]);

  useEffect(() => {
    if (!address) return;
    const refresh = window.setInterval(() => void loadBalance(address), 30_000);
    return () => window.clearInterval(refresh);
  }, [address, loadBalance]);

  async function disconnect() {
    await window.nightly?.solana?.features?.["standard:disconnect"]?.disconnect();
    setAddress(undefined);
    setBalance(undefined);
    setMessage(undefined);
  }

  return (
    <div className="wallet-control">
      {address && balance !== undefined ? <span className="wallet-balance">{balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} COOK</span> : null}
      <button className="wallet-button" type="button" onClick={() => void connect(false)} disabled={isConnecting}>
        {address ? shortAddress(address) : isConnecting ? "Connecting…" : "Connect Nightly"}
      </button>
      {address ? <button className="disconnect-button" type="button" onClick={() => void disconnect()} aria-label="Disconnect Nightly" title="Disconnect Nightly">×</button> : null}
      {message ? <p className="wallet-message">{message}</p> : null}
    </div>
  );
}
