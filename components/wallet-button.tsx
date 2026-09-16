"use client";

import { useState } from "react";

type NightlyAccount = { address: string };
type NightlyProvider = {
  solana?: {
    genesisHash?: string;
    features?: {
      "standard:connect"?: { connect: () => Promise<{ accounts: readonly NightlyAccount[] }> };
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
  const [message, setMessage] = useState<string>();
  const [isConnecting, setIsConnecting] = useState(false);

  async function connect() {
    const connectFeature = window.nightly?.solana?.features?.["standard:connect"];
    if (!connectFeature) {
      setMessage("Install Nightly to connect a Cookie Chain wallet.");
      return;
    }

    setIsConnecting(true);
    setMessage(undefined);
    try {
      const { accounts } = await connectFeature.connect();
      const account = accounts[0];
      if (!account) {
        setMessage("No account was shared by Nightly.");
        return;
      }
      setAddress(account.address);
    } catch {
      setMessage("Wallet connection was cancelled or unavailable.");
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="wallet-control">
      <button className="wallet-button" type="button" onClick={connect} disabled={isConnecting}>
        {address ? shortAddress(address) : isConnecting ? "Connecting…" : "Connect Nightly"}
      </button>
      {message ? <p className="wallet-message">{message}</p> : null}
    </div>
  );
}
